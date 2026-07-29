-- score_candidate_chunks — EXACT rerank scoring for a known candidate set.
--
-- ── WHY IT SCORES A CANDIDATE SET RATHER THAN THE TABLE (Codex, 2026-07-28) ───────────────────────────
-- Stage 1 reranking first tried to reuse match_chunks with match_count 300 and min_similarity 0, on the
-- assumption that this would return "a score for every union member". It does not. match_chunks ranks
-- the WHOLE TABLE and returns the global top N, so a facet-discovered candidate outside the bare topic's
-- global top 300 came back absent, was scored null, and ranked LAST. That is exactly backwards for the
-- case the rerank exists to serve: a niche treatment paper only a facet query could surface is precisely
-- the chunk that sits outside a global top-N. This function scores ONLY the supplied ids, so every
-- candidate gets a real number — one database call, zero embedding calls, using the stored embedding
-- that was ingested rather than a re-embedded or truncated copy.
--
-- ── WHY IT RETURNS ranked_score AND NOT JUST similarity (Codex, 2026-07-29) ───────────────────────────
-- THE DEFECT THIS VERSION FIXES. The first version returned raw cosine only, and the Worker sorted on it.
-- But production's ordering key is match_chunks.ranked_score, which is NOT similarity:
--
--   ranked_score = similarity
--                + (4 - source_tier) * tier_boost_weight
--                + landmark_boost      when is_landmark_trial
--                + elite_journal_boost when journal_rank = 1
--                + least(rcr_weight * ln(1 + rcr), 0.10)  when rcr > 1
--
-- So sorting the union by raw cosine did not "rerank" it. It reranked it AND silently repealed four
-- authority boosts at the same time. In the four-arm experiment that made the arms non-comparable:
-- baseline and metadata kept the deployed authority policy, rerank and both discarded it, and any
-- measured difference would have been the sum of two changes reported under the name of one. The
-- experiment would have produced a number, and the number would have meant something other than its
-- label — which is the specific failure this project keeps having.
--
-- THE FIX IS "CHANGE ONE THING". This function now applies the IDENTICAL formula with IDENTICAL default
-- weights, substituting bare-topic similarity for facet similarity. That is the only difference between
-- an arm and its baseline: which query supplies the semantic term. Everything downstream is held constant.
--
-- It returns BOTH columns. `similarity` is the raw bare-topic cosine, reported for diagnostics and kept
-- out of the ordering; `ranked_score` is what the Worker sorts on.
--
-- THE DEFAULTS ARE NOT COPIES, THEY ARE A CONTRACT. They must equal canonical_match_chunks.sql exactly.
-- test_ranking_formula.mjs parses both files and fails if they diverge, because a silent divergence here
-- reintroduces the confound while every flag still reports success.
--
-- NO journal_rank FILTER HERE, deliberately. Candidates reached this function by surviving match_chunks,
-- which already applied `journal_rank <= max_journal_rank`. Re-filtering could only drop rows already in
-- the union, producing nulls the Worker would have to interpret. This scores; it does not select.
--
-- ── TYPES MUST MATCH document_chunks.id, WHICH IS bigserial (Codex, 2026-07-28) ───────────────────────
-- The first draft declared uuid[] and returned uuid, copied from documents.id without checking.
-- document_chunks.id is bigserial and match_chunks already returns chunk_id bigint. It would have failed
-- at CREATION — `c.id = any(candidate_chunk_ids)` raises `operator does not exist: bigint = uuid` — not
-- silently at runtime. The dangerous path was narrower: ignore the failed migration, deploy the Worker
-- anyway, and every rerank request falls back with rerank_applied:false, a feature that looks live and
-- does nothing. The JS stub used string ids, so no unit test could have caught it; test_schema_types.mjs
-- asserts it against the schema directly.

-- ONE TRANSACTION, for the same reason as canonical_match_chunks.sql: psql autocommits each statement
-- unless told otherwise, and ON_ERROR_STOP=1 stops without undoing. Unwrapped, a failure between the
-- DROP and the CREATE leaves the database with no score_candidate_chunks, and every rerank request then
-- falls back — reporting rerank_applied:false, which is at least honest, but for no reason anyone would
-- be able to see. Proven on a live database that a failure inside a transaction leaves the prior
-- function intact, while the same DROP unwrapped removes it for good. (2026-07-29)
begin;

-- DROP FIRST: the return TABLE gained a column, and `create or replace` cannot change a function's
-- return type. Safe — nothing calls this unless a request sets rerank:true, and no shipped front end does.
drop function if exists public.score_candidate_chunks(vector(1536), bigint[]);
drop function if exists public.score_candidate_chunks(vector(1536), bigint[], double precision, double precision, double precision, double precision);

create or replace function public.score_candidate_chunks(
  query_embedding vector(1536),
  candidate_chunk_ids bigint[],
  -- These four MUST match canonical_match_chunks.sql. See the contract note above.
  tier_boost_weight double precision default 0.05,
  rcr_weight double precision default 0.02,
  landmark_boost double precision default 0.05,
  elite_journal_boost double precision default 0.06
)
returns table (
  chunk_id bigint,
  similarity double precision,
  ranked_score double precision
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
      1 - (c.embedding <=> query_embedding) as similarity,
      -- IDENTICAL to canonical match_chunks.ranked_score, with bare-topic similarity substituted.
      (1 - (c.embedding <=> query_embedding))
        + ((4 - d.source_tier) * tier_boost_weight)
        + (case when d.is_landmark_trial then landmark_boost else 0 end)
        + (case when d.journal_rank = 1 then elite_journal_boost else 0 end)
        + least(case when d.rcr is not null and d.rcr > 1 then rcr_weight * ln(1 + d.rcr) else 0 end, 0.10)
        as ranked_score
    from public.document_chunks c
    join public.documents d on d.id = c.document_id
    where c.id = any(candidate_chunk_ids)
      and c.embedding is not null;
end;
$$;

comment on function public.score_candidate_chunks is
  'Scores a SPECIFIC set of chunk ids against a query embedding, returning raw cosine (similarity) and '
  'the production authority-weighted ranked_score. Used by the stage-1 rerank so every facet-discovered '
  'candidate is scored exactly rather than looked up in a global top-N and silently missed. ranked_score '
  'uses the IDENTICAL formula and weights as match_chunks, so reranking changes only which query supplies '
  'the semantic term — it does not also repeal the authority policy.';

grant execute on function public.score_candidate_chunks(vector(1536), bigint[], double precision, double precision, double precision, double precision) to service_role;
grant execute on function public.score_candidate_chunks(vector(1536), bigint[], double precision, double precision, double precision, double precision) to authenticated;
grant execute on function public.score_candidate_chunks(vector(1536), bigint[], double precision, double precision, double precision, double precision) to anon;

commit;


-- ─────────────────────────────────────────────────────────────────────────────
-- APPLYING THIS, TO A SPECIFIC DATABASE
--
-- `supabase db push` applies to whatever project is currently linked, which is easy to get wrong and
-- impossible to notice afterwards. Name the target explicitly.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
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
--   psql "$DATABASE_URL" -c "\df+ public.score_candidate_chunks"
--
--   -- 2. it RUNS, returns one row per requested id, and ranked_score >= similarity for every row
--   --    (every boost term is non-negative, so this must hold; if it does not, a sign is wrong)
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
--     with ids as (
--       select array_agg(id) as a from (select id from public.document_chunks where embedding is not null limit 3) s
--     ), probe as (
--       select embedding from public.document_chunks where embedding is not null limit 1
--     )
--     select count(*) as scored, max(similarity) as max_sim,
--            bool_and(ranked_score >= similarity - 1e-9) as boosts_non_negative
--     from ids, probe, score_candidate_chunks(probe.embedding, ids.a);
--   SQL
--   -- EXPECT scored = 3, max_sim = 1 (the probe scores 1.0 against itself), boosts_non_negative = t.
--   -- A count of 0 means the function installed but matches nothing — which \df+ would call a success.
--
--   -- 3. AGREEMENT WITH PRODUCTION. This is the test that matters after 2026-07-29: for a chunk that
--   --    match_chunks returns, feeding the SAME embedding to both must produce the SAME ranked_score.
--   --    If these disagree, the two ranking formulas have drifted and the rerank arm is measuring a
--   --    ranking-policy change rather than a rerank.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
--     with probe as (select embedding from public.document_chunks where embedding is not null limit 1),
--     m as (select chunk_id, ranked_score from probe, match_chunks(probe.embedding, 5)),
--     s as (select chunk_id, ranked_score from probe, score_candidate_chunks(
--             probe.embedding, (select array_agg(chunk_id) from m)))
--     select count(*) as compared,
--            bool_and(abs(m.ranked_score - s.ranked_score) < 1e-9) as formulas_agree
--     from m join s using (chunk_id);
--   SQL
--   -- EXPECT compared = 5, formulas_agree = t.
--
--   -- 4. the cap raises rather than silently truncating
--   psql "$DATABASE_URL" -c \
--     "select count(*) from score_candidate_chunks(
--        (select embedding from public.document_chunks where embedding is not null limit 1),
--        (select array_agg(g) from generate_series(1, 501) g));"
--   -- EXPECT: ERROR ... candidate_chunk_ids capped at 500, got 501
--
-- Then point the Worker at that same database:
--   npx wrangler dev
--
-- Applying to PRODUCTION is defensible — nothing calls this unless a request sets rerank:true — but it
-- should be a decision, not a default that happens because `db push` used the linked project.
