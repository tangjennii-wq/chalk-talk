# Chalk Talk — RAG corpus

Ingestion pipeline for the retrieval-augmented chalk talk generator.

**What lives here:**
- `ingest_pubmed.mjs` — pulls IM review-article abstracts from PubMed, embeds them, stores in Supabase

**What lives in `../supabase/`:**
- `migration_v2_rag.sql` — adds pgvector, `documents`, `document_chunks`, `match_chunks()` retrieval function

---

## Setup (one-time)

### 1. Apply the migration
Open Supabase dashboard → SQL Editor → New query → paste `supabase/migration_v2_rag.sql` → Run.

Verify in the dashboard that `documents` and `document_chunks` tables exist and the `vector` extension is enabled.

### 2. Get an OpenAI API key
- platform.openai.com → API keys → create new
- Add ~$10 credit (50k abstracts ≈ $0.30)
- Used for embeddings only (Claude still does generation)

### 3. (Optional) Get an NCBI E-utilities API key
- ncbi.nlm.nih.gov/account → API Key Management
- Bumps PubMed rate limit from 3/s to 10/s — ingestion runs ~3x faster

### 4. Get your Supabase service role key
- Supabase dashboard → Project Settings → API → `service_role` key
- **This bypasses RLS** — only use server-side, never in the browser
- The ingestion script uses this to write to the documents tables

---

## Running the ingestion

```bash
cd "/path/to/chalk talk"

export SUPABASE_URL=https://hrcvcjiefndvytlcbmpa.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=eyJ...          # service role, NOT anon
export OPENAI_API_KEY=sk-proj-...
export NCBI_API_KEY=...                          # optional

node rag/ingest_pubmed.mjs
```

The hello-world run ingests ~20 review articles on "acute kidney injury" to prove the loop end-to-end. Expand the `TOPICS` array in the script to scale to the full IM corpus.

---

## Why these design choices

**Why OpenAI text-embedding-3-small?**
Cheapest ($0.02/1M tokens), fastest, 1536-dim is the schema default. Locked into this for v1. We can swap to MedCPT or Voyage later by adding a new embedding column and re-embedding.

**Why public-domain only (PubMed first)?**
Zero copyright risk. PubMed abstracts are dedicated to public domain by NLM. Citation metadata isn't copyrightable. We get real PMIDs that solve the hallucination problem directly without any license review.

**Why reviews/meta-analyses only?**
Best signal-to-noise for chalk talk grounding. Reviews are pre-chewed syntheses — exactly the right shape for our generation task. Primary research articles dilute retrieval quality.

**Why source-tier ranking?**
Cochrane reviews and major society guidelines should outrank a random PubMed review even at equal semantic similarity. The `match_chunks()` function applies a small tier boost to surface higher-evidence sources first.

---

## What's next (not yet built)

- **Worker retrieval endpoint** — `worker.js` needs a `/retrieve` route that embeds the query and calls `match_chunks()`
- **Prompt + UI changes** — `index.html` needs to inject retrieved chunks into the Claude prompt and render real citations
- **Corpus expansion** — DailyMed (FDA drug labels), USPSTF/CDC/NIH guidelines, PMC OA full text
- **Citation-only registry** — KDIGO/AHA/ACC/IDSA metadata for cite-and-link without storing full text

---

## Sanity check after first run

In the Supabase SQL editor:
```sql
select count(*) from documents;          -- should be > 0
select count(*) from document_chunks;    -- should match (1 chunk per doc for now)
select source, source_tier, count(*) from documents group by 1, 2 order by 2, 1;
```
