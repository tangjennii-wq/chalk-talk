-- TWO-STAGE HNSW RETRIEVAL + the anon statement_timeout that made it urgent.
--
-- ── WHAT BROKE, IN PRODUCTION ────────────────────────────────────────────────────────────────────────
-- A live talk generated with zero retrieved evidence. /retrieve had returned 502:
--
--     {"code":"57014", "message":"canceling statement due to statement timeout"}
--
-- match_chunks orders by ranked_score — similarity PLUS four authority boosts — and filters on
-- `(1 - (embedding <=> q)) >= min_similarity`. Both are computed expressions over a join, so
-- chunks_embedding_hnsw can NEVER serve either. Every retrieval sequentially scanned all 2,833 chunks,
-- computing a 1536-dimension cosine distance per row:
--
--     match_chunks       : Buffers shared hit=52913  (~413MB)   Execution 249ms warm
--
-- Warm in cache that fits inside anon's 3s statement_timeout. Cold it does not, which is why retrieval
-- failed intermittently rather than consistently — the worst way for it to fail, because it looks like
-- flakiness rather than architecture. The HNSW index has been present and unused the whole time.
--
-- ── THE TIMEOUT, AND A TRAP ──────────────────────────────────────────────────────────────────────────
-- Preference was to raise the timeout for the retrieval RPC ONLY, not globally. Postgres does not allow
-- it. A function-level `SET statement_timeout` does not extend an already-running statement, because the
-- timer is armed at statement start. Measured rather than assumed:
--
--     create function _probe() ... set statement_timeout = '5s' as $$ select pg_sleep(1) $$;
--     set local statement_timeout = '300ms';  select _probe();
--     -> ERROR 57014: canceling statement due to statement timeout
--
-- So it is role-level or nothing. anon serves only retrieval in this project, which makes the blast
-- radius acceptable:
--
--     alter role anon set statement_timeout = '10s';     -- was 3s
--
-- REVERT with: alter role anon set statement_timeout = '3s';
-- Lower it again once two-stage retrieval is calibrated and enabled; it is a crutch, not a fix.
--
-- ── STAGE 1 MUST BE INDEX-ELIGIBLE, AND ef_search IS NOT OPTIONAL ────────────────────────────────────
-- The candidate query carries no join and no computed filter, and its ORDER BY is exactly the operator
-- the index was built with. Verified rather than hoped:
--
--     Index Scan using chunks_embedding_hnsw   Buffers shared hit=684   Execution 2.1ms
--
-- But that plan returned THIRTY-FIVE rows for `limit 200`. hnsw.ef_search defaults to 40 and caps how
-- many candidates the index will consider, so a pool of 200 quietly yields ~40 and a pool of 500 yields
-- the same ~40. A calibration comparing 50/100/200/500 would have compared four labels for one pool and
-- concluded, correctly and uselessly, that pool size does not matter. Hence plpgsql and a dynamic
-- SET LOCAL: a SQL function cannot SET, and a function-level SET cannot follow a parameter. The function
-- is VOLATILE because STABLE forbids SET at all.
--
-- After the fix, pools are real (survivors after the journal_rank filter):
--     asked  50 -> 44      asked 100 -> 90      asked 200 -> 199     asked 500 -> 499
--
-- ── THIS CHANGES RANKING POLICY. IT IS A FLAG, NOT A REPLACEMENT. ────────────────────────────────────
-- Candidates are chosen by RAW COSINE, so a heavily-boosted document with mediocre similarity can fall
-- outside the pool and never be re-ranked into the result. Overlap@8 against the full scan, 25 sampled
-- query vectors:
--
--     pool  50 -> mean 6.96 / 8   worst 4   identical on 14/25
--     pool 100 -> mean 7.40 / 8   worst 5   identical on 18/25
--     pool 200 -> mean 7.92 / 8   worst 7   identical on 23/25
--     pool 500 -> mean 8.00 / 8   worst 8   identical on 25/25
--
-- Lossless at 500 TODAY, on a 2,833-chunk corpus. That is a property of the corpus being smaller than
-- six pools, not a property of the algorithm, and it decays as the corpus grows. Default OFF until
-- physician-judged calibration says otherwise.
begin;

drop function if exists public.match_chunks_hnsw(vector, integer, integer, double precision, integer, text[], double precision, double precision, double precision, smallint, double precision);

create function public.match_chunks_hnsw(
  query_embedding      vector,
  match_count          integer  default 10,
  candidate_pool       integer  default 200,
  min_similarity       double precision default 0.0,
  max_age_years        integer  default null,
  allowed_sources      text[]   default null,
  tier_boost_weight    double precision default 0.05,
  rcr_weight           double precision default 0.02,
  landmark_boost       double precision default 0.05,
  max_journal_rank     smallint default 2,
  elite_journal_boost  double precision default 0.06
)
returns table (
  chunk_id bigint, document_id uuid, chunk_index integer, section text, text text, tokens integer,
  similarity double precision, ranked_score double precision, source text, source_tier smallint,
  title text, authors text, journal text, year integer, pmid text, pmcid text, doi text, url text,
  publication_type text, license text, rcr double precision, citation_count integer,
  is_landmark_trial boolean, journal_rank smallint,
  survivors_after_filter integer, ef_search_used integer
)
language plpgsql
volatile
as $function$
declare
  v_pool int := greatest(coalesce(candidate_pool, 200), coalesce(match_count, 10));
  v_ef   int := least(greatest(v_pool, 40), 1000);   -- pgvector caps ef_search at 1000
begin
  execute format('set local hnsw.ef_search = %s', v_ef);

  return query
  with cand as (
    select c.id, c.document_id, c.chunk_index, c.section, c.text, c.tokens, c.embedding
    from public.document_chunks c
    order by c.embedding <=> query_embedding
    limit v_pool
  ),
  filtered as (
    select
      c.id as chunk_id, c.document_id, c.chunk_index, c.section, c.text, c.tokens,
      1 - (c.embedding <=> query_embedding) as similarity,
      (1 - (c.embedding <=> query_embedding))
        + ((4 - d.source_tier) * tier_boost_weight)
        + (case when d.is_landmark_trial then landmark_boost else 0 end)
        + (case when d.journal_rank = 1 then elite_journal_boost else 0 end)
        + least(case when d.rcr is not null and d.rcr > 1 then rcr_weight * ln(1 + d.rcr) else 0 end, 0.10)
        as ranked_score,
      d.source, d.source_tier, d.title, d.authors, d.journal, d.year,
      d.pmid, d.pmcid, d.doi, d.url, d.publication_type, d.license,
      d.rcr, d.citation_count, d.is_landmark_trial, d.journal_rank
    from cand c
    join public.documents d on d.id = c.document_id
    where (1 - (c.embedding <=> query_embedding)) >= min_similarity
      and (max_age_years is null or d.year is null
           or d.year >= extract(year from now())::int - max_age_years)
      and (allowed_sources is null or d.source = any(allowed_sources))
      and d.journal_rank <= max_journal_rank
  )
  select f.*, (select count(*)::int from filtered), v_ef
  from filtered f
  order by f.ranked_score desc
  limit match_count;
end;
$function$;

comment on function public.match_chunks_hnsw is
  'Two-stage retrieval: HNSW candidate pool, then match_chunks authority boosts applied WITHIN that '
  'pool. Ranking is NOT equivalent to match_chunks — candidates are chosen by raw cosine, so a boosted '
  'document outside the pool is unreachable. Sets hnsw.ef_search from candidate_pool, without which the '
  'index returns ~40 rows regardless of the pool requested. Default OFF pending calibration.';

revoke all on function public.match_chunks_hnsw(vector, integer, integer, double precision, integer, text[], double precision, double precision, double precision, smallint, double precision) from public;
grant execute on function public.match_chunks_hnsw(vector, integer, integer, double precision, integer, text[], double precision, double precision, double precision, smallint, double precision) to anon, authenticated, service_role;

commit;
