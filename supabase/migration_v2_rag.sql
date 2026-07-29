-- =========================================================
-- Chalk Talk — Supabase migration v2: RAG corpus
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Idempotent: safe to re-run; uses IF NOT EXISTS / drop-and-recreate.
--
-- What this adds:
--   - pgvector extension for similarity search
--   - documents table (one row per source paper/guideline/drug label)
--   - document_chunks table (chunked + embedded text for retrieval)
--   - match_chunks() function with source-tier weighted ranking
--   - Permissive read RLS (corpus is public to all users; writes via service role only)
-- =========================================================

-- 1) pgvector extension (required)
create extension if not exists vector;

-- =========================================================
-- 2) documents (one row per source paper / guideline / drug label)
-- =========================================================
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),

  -- Source identification
  source text not null check (source in (
    'pubmed',      -- PubMed abstract (public domain)
    'pmc',         -- PMC Open Access full text (CC-licensed)
    'dailymed',    -- FDA drug labels (public domain)
    'uspstf',      -- USPSTF recommendations (public domain)
    'cdc',         -- CDC guidelines (public domain)
    'nih',         -- NIH/NHLBI/NCI guidelines (public domain)
    'nice',        -- NICE UK guidelines (UK Crown copyright, free reuse)
    'who',         -- WHO publications (CC-BY-IGO)
    'medlineplus', -- NLM MedlinePlus (public domain)
    'cite_only'    -- KDIGO/AHA/ACC/IDSA/etc. — citation metadata only, no full text
  )),

  -- License — informs what we can store/display
  license text not null check (license in (
    'public_domain',
    'cc-by',
    'cc-by-nc',
    'cc-by-igo',
    'crown_copyright',
    'cite_only'    -- we only store metadata, not full text
  )),

  -- EBM source tier — drives retrieval ranking
  -- 1 = highest (Cochrane, USPSTF, NICE, major society guidelines using GRADE)
  -- 2 = strong (other guidelines, systematic reviews)
  -- 3 = peer-reviewed reviews in good journals
  -- 4 = primary research, less rigorous syntheses
  source_tier smallint not null check (source_tier between 1 and 4),

  -- Bibliographic metadata
  title text not null,
  authors text,              -- comma-separated; null for non-paper sources
  journal text,
  year int,
  published_date date,
  publication_type text,     -- 'review', 'systematic_review', 'guideline', 'drug_label', 'meta_analysis', 'rct', 'other'

  -- External identifiers
  pmid text,                 -- PubMed ID (unique among non-null)
  pmcid text,                -- PMC ID
  doi text,
  url text,                  -- canonical URL

  -- Content
  abstract text,             -- always store abstract if available (public domain via PubMed)
  mesh_terms text[],         -- for filtering
  raw_metadata jsonb,        -- kitchen sink

  -- Bookkeeping
  ingested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists documents_pmid_unique
  on public.documents(pmid) where pmid is not null;
create unique index if not exists documents_pmcid_unique
  on public.documents(pmcid) where pmcid is not null;
create index if not exists documents_source_idx on public.documents(source);
create index if not exists documents_tier_idx on public.documents(source_tier);
create index if not exists documents_pubtype_idx on public.documents(publication_type);
create index if not exists documents_year_idx on public.documents(year);

comment on table public.documents is 'RAG corpus: one row per source document. License field constrains what content we can store; cite_only docs store metadata only.';

-- =========================================================
-- 3) document_chunks (embeddings live here)
-- =========================================================
create table if not exists public.document_chunks (
  id bigserial primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index int not null,
  section text,              -- 'abstract', 'introduction', 'methods', 'results', 'discussion', 'guideline_body', etc.
  text text not null,
  tokens int,                -- approximate token count for the chunk

  -- Embedding: 1536 dim assumes OpenAI text-embedding-3-small.
  -- If you switch to a different model, you'll need to migrate (or add a new column for the new model).
  embedding vector(1536),

  created_at timestamptz not null default now(),

  unique (document_id, chunk_index)
);

create index if not exists chunks_document_idx on public.document_chunks(document_id);

-- HNSW index for fast cosine similarity search.
-- HNSW chosen over IVFFlat because:
--   - Better recall as corpus grows
--   - No need to rebuild as data is added incrementally
--   - Slightly slower to build but worth it for a growing corpus
create index if not exists chunks_embedding_hnsw
  on public.document_chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

comment on table public.document_chunks is 'Chunked text with embeddings for similarity retrieval. Embeddings are 1536-dim (OpenAI text-embedding-3-small).';

-- =========================================================
-- 4) match_chunks() — tier-weighted similarity retrieval
-- =========================================================
-- Returns top-N chunks ranked by cosine similarity, boosted by source tier.
-- Tier boost: lower (better) source_tier gets a small additive bonus,
-- so a tier-1 guideline chunk beats a tier-4 primary research chunk
-- of equal raw similarity.
--
-- Args:
--   query_embedding   — the user/topic embedding (1536 dim)
--   match_count       — how many chunks to return (default 10)
--   min_similarity    — minimum raw cosine similarity (0-1, default 0.0)
--   max_age_years     — only return docs published within this many years (null = no limit)
--   allowed_sources   — array of source values to filter to (null = all)
--   tier_boost_weight — how much weight to give tier vs. raw similarity (default 0.05)
-- =========================================================

drop function if exists public.match_chunks(vector, int, float, int, text[], float);
-- ⚠ SUPERSEDED — DO NOT READ THIS TO LEARN HOW RANKING WORKS.
-- The live function has ten parameters and twenty-four return columns; this one has six and twenty. It
-- was altered in production and never committed, so this definition described a ranker that had not run
-- for some time. Kept only as the historical bootstrap.
--
-- The reference is supabase/migrations/canonical_match_chunks.sql, exported from the live catalog on
-- 2026-07-29. Applying THIS file to a fresh database gives you a different, quieter ranker: no landmark
-- boost, no elite-journal boost, no RCR term, and no journal_rank filter.
create or replace function public.match_chunks(
  query_embedding vector(1536),
  match_count int default 10,
  min_similarity float default 0.0,
  max_age_years int default null,
  allowed_sources text[] default null,
  tier_boost_weight float default 0.05
)
returns table (
  chunk_id bigint,
  document_id uuid,
  chunk_index int,
  section text,
  text text,
  tokens int,
  similarity float,
  ranked_score float,
  -- Document metadata flattened for one-shot retrieval
  source text,
  source_tier smallint,
  title text,
  authors text,
  journal text,
  year int,
  pmid text,
  pmcid text,
  doi text,
  url text,
  publication_type text,
  license text
)
language sql
stable
as $$
  select
    c.id as chunk_id,
    c.document_id,
    c.chunk_index,
    c.section,
    c.text,
    c.tokens,
    1 - (c.embedding <=> query_embedding) as similarity,
    -- Tier boost: tier 1 gets +0.15, tier 4 gets 0, with default weight 0.05
    (1 - (c.embedding <=> query_embedding))
      + ((4 - d.source_tier) * tier_boost_weight) as ranked_score,
    d.source,
    d.source_tier,
    d.title,
    d.authors,
    d.journal,
    d.year,
    d.pmid,
    d.pmcid,
    d.doi,
    d.url,
    d.publication_type,
    d.license
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.embedding is not null
    and (1 - (c.embedding <=> query_embedding)) >= min_similarity
    and (max_age_years is null or d.year is null or d.year >= extract(year from now())::int - max_age_years)
    and (allowed_sources is null or d.source = any(allowed_sources))
  order by ranked_score desc
  limit match_count;
$$;

comment on function public.match_chunks is 'Retrieve top-N chunks by cosine similarity, weighted by EBM source tier. Tier 1 (Cochrane/guidelines) beats tier 4 (primary research) at equal similarity.';

-- =========================================================
-- 5) Updated_at trigger for documents
-- =========================================================
drop trigger if exists documents_updated_at on public.documents;
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

-- =========================================================
-- 6) Row-Level Security
-- =========================================================
-- The corpus is shared public data. All users (signed in or anonymous)
-- can READ. Writes happen only via the service role key from the
-- ingestion script — no client-side writes ever.
-- =========================================================

alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;

drop policy if exists "documents_select_all" on public.documents;
create policy "documents_select_all" on public.documents
  for select to anon, authenticated using (true);

drop policy if exists "chunks_select_all" on public.document_chunks;
create policy "chunks_select_all" on public.document_chunks
  for select to anon, authenticated using (true);

-- No insert/update/delete policies → only service_role can write.

-- =========================================================
-- Sanity check
-- =========================================================
select 'Extension installed:' as msg;
select extname, extversion from pg_extension where extname = 'vector';

select 'Tables created:' as msg;
select tablename from pg_tables where schemaname = 'public' and tablename in ('documents','document_chunks');

select 'Functions created:' as msg;
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname = 'match_chunks';

select 'RLS enabled:' as msg;
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('documents','document_chunks');
