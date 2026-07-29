-- score_candidate_chunks — EXACT rerank scoring for a known candidate set.
--
-- WHY THIS EXISTS (Codex, 2026-07-28).
-- Stage 1 reranking first tried to reuse match_chunks with match_count 300 and min_similarity 0, on the
-- assumption that this would return "a score for every union member". It does not. match_chunks ranks
-- the WHOLE TABLE and returns the global top N — so a facet-discovered candidate that falls outside the
-- bare topic's global top 300 comes back absent, is scored null, and is ranked LAST.
--
-- That is exactly backwards for the case the rerank exists to serve: a niche, genuinely useful treatment
-- paper that only a facet query could surface is precisely the kind of chunk that sits outside the bare
-- topic's global top 300. The approximate lookup would bury it.
--
-- This function scores ONLY the supplied chunk ids, so every candidate gets a real number. It remains
-- one database call, zero embedding calls, and it uses the stored embedding — the same representation
-- that was ingested, never a re-embedded or truncated copy.
--
-- TYPES MUST MATCH document_chunks.id, WHICH IS bigserial (Codex, 2026-07-28).
-- The first draft of this file declared uuid[] and returned uuid, copied from documents.id without
-- checking. document_chunks.id is bigserial and match_chunks already returns chunk_id bigint.
--
-- WHERE IT WOULD HAVE FAILED, precisely (Codex corrected my first account of this): at CREATION, not
-- silently at runtime. `c.id = any(candidate_chunk_ids)` with a bigint column and a uuid[] parameter
-- raises `operator does not exist: bigint = uuid`, and a GRANT naming a signature no function has raises
-- its own error. So the migration would have failed loudly rather than installing something broken.
--
-- The dangerous path was narrower but real: ignore the failed migration, deploy the Worker anyway, and
-- every rerank request then falls back with rerank_applied:false — a feature that looks live and does
-- nothing. My first note claimed the silent no-op was the DEFAULT outcome; it was not.
--
-- Either way the JS stub used string ids, so no amount of unit testing could have caught a database type
-- mismatch; test_schema_types.mjs now asserts it directly.
--
-- No tier boost here, deliberately. The rerank ranks on topic similarity; a tier preference is a
-- separate, later decision and mixing them would make neither measurable.

create or replace function public.score_candidate_chunks(
  query_embedding vector(1536),
  candidate_chunk_ids bigint[]
)
returns table (
  chunk_id bigint,
  similarity float
)
language plpgsql
stable
as $$
begin
  -- BOUND THE INPUT. This function is callable with the ANON key (the Worker uses it), so an unbounded
  -- id array is a cheap way for anyone to make the database do arbitrary work. The Worker never sends
  -- more than a facet union — 5 facets x 24 = 120 before dedupe — so 500 is generous and still finite.
  -- (Codex, 2026-07-28)
  if candidate_chunk_ids is null or array_length(candidate_chunk_ids, 1) is null then
    return;                                   -- empty input, empty result; not an error
  end if;
  if array_length(candidate_chunk_ids, 1) > 500 then
    raise exception 'score_candidate_chunks: candidate_chunk_ids capped at 500, got %',
      array_length(candidate_chunk_ids, 1);
  end if;

  return query
    select
      c.id as chunk_id,
      1 - (c.embedding <=> query_embedding) as similarity
    from public.document_chunks c
    where c.id = any(candidate_chunk_ids)
      and c.embedding is not null;
end;
$$;

comment on function public.score_candidate_chunks is
  'Raw cosine similarity against the stored embedding for a SPECIFIC set of chunk ids. Used by the '
  'stage-1 rerank so every facet-discovered candidate is scored exactly, rather than being looked up in '
  'a global top-N and silently missed. No tier boost — ranking on topic similarity alone is the point.';

grant execute on function public.score_candidate_chunks(vector(1536), bigint[]) to service_role;
grant execute on function public.score_candidate_chunks(vector(1536), bigint[]) to authenticated;
grant execute on function public.score_candidate_chunks(vector(1536), bigint[]) to anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- APPLYING THIS, TO A SPECIFIC DATABASE
--
-- `supabase db push` applies to whatever project is currently linked, which is easy to get wrong and
-- impossible to notice afterwards. Name the target explicitly.
--
--   psql "$STAGING_DATABASE_URL" \
--     -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/add_score_candidate_chunks.sql
--
-- ON_ERROR_STOP=1 IS NOT OPTIONAL. Without it psql keeps going after a failed statement and exits 0, so
-- a migration that errored looks like one that succeeded — and the Worker then falls back on every
-- rerank request while reporting rerank_applied:false. That is the quiet failure this whole stage has
-- been trying not to have. (Codex, 2026-07-28)
--
-- THEN SMOKE-TEST THE FUNCTION, not its name. `\df+` only proves something with that signature exists;
-- it does not prove it runs, returns rows, or scores the ids you asked about.
--
--   -- 1. it exists with the right signature
--   psql "$STAGING_DATABASE_URL" -c "\df+ public.score_candidate_chunks"
--
--   -- 2. it RUNS and returns one row per requested id, for real ids from this database
--   psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
--     with ids as (
--       select array_agg(id) as a from (select id from public.document_chunks where embedding is not null limit 3) s
--     ),
--     probe as (
--       select embedding from public.document_chunks where embedding is not null limit 1
--     )
--     select count(*) as scored,
--            min(similarity) as min_sim,
--            max(similarity) as max_sim
--     from ids, probe, score_candidate_chunks(probe.embedding, ids.a);
--   SQL
--   -- EXPECT scored = 3, and max_sim = 1 (the probe chunk scores 1.0 against itself). A count of 0 means
--   -- the function installed but matches nothing — which \df+ would have called a success.
--
--   -- 3. the cap raises rather than silently truncating
--   psql "$STAGING_DATABASE_URL" -c \
--     "select count(*) from score_candidate_chunks(
--        (select embedding from public.document_chunks where embedding is not null limit 1),
--        (select array_agg(g) from generate_series(1, 501) g));"
--   -- EXPECT: ERROR ... candidate_chunk_ids capped at 500, got 501
--
-- Then point the Worker at that same database:
--   SUPABASE_URL=<staging-url> SUPABASE_ANON_KEY=<staging-anon> npx wrangler dev
--
-- Applying to PRODUCTION is defensible — nothing calls this unless a request sets rerank:true — but it
-- should be a decision, not a default that happens because `db push` used the linked project.
