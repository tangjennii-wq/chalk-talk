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
-- checking. document_chunks.id is bigserial and match_chunks already returns chunk_id bigint, so the
-- function would have failed at execution — and because the Worker catches RPC errors and falls back,
-- reranking would have silently reverted to pooled facet order on EVERY request while reporting
-- rerank_applied false. A quiet permanent no-op. The JS stub used string ids, so no amount of unit
-- testing could have caught a database type mismatch; test_schema_types.mjs now asserts it directly.
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
language sql
stable
as $$
  select
    c.id as chunk_id,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  where c.id = any(candidate_chunk_ids)
    and c.embedding is not null;
$$;

comment on function public.score_candidate_chunks is
  'Raw cosine similarity against the stored embedding for a SPECIFIC set of chunk ids. Used by the '
  'stage-1 rerank so every facet-discovered candidate is scored exactly, rather than being looked up in '
  'a global top-N and silently missed. No tier boost — ranking on topic similarity alone is the point.';

grant execute on function public.score_candidate_chunks(vector(1536), bigint[]) to service_role;
grant execute on function public.score_candidate_chunks(vector(1536), bigint[]) to authenticated;
grant execute on function public.score_candidate_chunks(vector(1536), bigint[]) to anon;
