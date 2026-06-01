# Chalk Talk RAG v2 — Per-User Guideline Upload Spec

> Goal: let an individual clinician upload their own legitimately-obtained copy of a copyrighted guideline (KDIGO 2024 CKD, IDSA pneumonia 2019, ADA Standards of Care, AHA/ACC HF, etc.) and have RAG retrieve over it **only for that user**, with no shared persistence, no cross-user retrieval, and no public surfacing.
>
> Posture: fair use for personal research and education by the uploader. The user is responsible for having legitimate access to the document they upload (institutional subscription, society membership, personally purchased). Chalk Talk acts as a personal RAG cache, not a redistribution platform.

---

## Threat model & guardrails

| Risk | Mitigation |
|---|---|
| Cross-user retrieval (User A's KDIGO chunks surfaced to User B) | Row-level security on `user_documents` + `user_document_chunks` keyed on `auth.uid()`; RPC `match_user_chunks` filters by `user_id = auth.uid()` |
| Public exposure via the corpus-wide `/retrieve` endpoint | Worker has TWO retrieve endpoints: `/retrieve` (public-domain corpus, unchanged) and `/retrieve_user` (requires user JWT, hits user-scoped table only) |
| User uploads then deletes account → orphaned copyrighted content | Cascade delete on `auth.users` → `user_documents` → `user_document_chunks` |
| Re-sharing via the generated chalk talk text | The directive prompt explicitly tells Claude that user-scoped sources are private; talks built from them get a "Generated from your private library" footer rather than a public PMID badge |
| Bulk scraping via a user account | Per-user upload cap (50 PDFs / 200 MB total in v2); rate-limit upload endpoint |
| Liability that we're hosting copyrighted text | TOS update: user warrants they have legitimate access; uploads are stored encrypted at rest; user can delete at any time; we never serve full text to anyone but the uploading user |

---

## Schema (additive — does not touch existing `documents` / `document_chunks`)

```sql
-- ============================================================
-- Migration v3: per-user uploads
-- Additive only. Existing public corpus untouched.
-- ============================================================

create table if not exists public.user_documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  source_label  text,                          -- "KDIGO 2024 CKD", "IDSA Pneumonia 2019"
  doc_type      text,                          -- "guideline" | "review" | "textbook_chapter" | "other"
  year          int,
  filename      text,                          -- original filename, display only
  byte_size     bigint,
  sha256        text,                          -- dedupe within a user's library
  uploaded_at   timestamptz not null default now(),
  meta          jsonb default '{}'::jsonb
);
create unique index if not exists user_documents_user_sha_unique
  on public.user_documents(user_id, sha256);

create table if not exists public.user_document_chunks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  document_id   uuid not null references public.user_documents(id) on delete cascade,
  chunk_index   int  not null,
  section       text,
  content       text not null,
  embedding     vector(1536) not null,
  meta          jsonb default '{}'::jsonb
);
create index if not exists user_document_chunks_embedding_idx
  on public.user_document_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists user_document_chunks_user_idx
  on public.user_document_chunks(user_id);

-- ---- RLS ----------------------------------------------------
alter table public.user_documents enable row level security;
alter table public.user_document_chunks enable row level security;

create policy "user reads own docs"
  on public.user_documents for select
  using (auth.uid() = user_id);

create policy "user inserts own docs"
  on public.user_documents for insert
  with check (auth.uid() = user_id);

create policy "user deletes own docs"
  on public.user_documents for delete
  using (auth.uid() = user_id);

create policy "user reads own chunks"
  on public.user_document_chunks for select
  using (auth.uid() = user_id);

create policy "user inserts own chunks"
  on public.user_document_chunks for insert
  with check (auth.uid() = user_id);

create policy "user deletes own chunks"
  on public.user_document_chunks for delete
  using (auth.uid() = user_id);

-- Service role bypasses RLS (used by ingest worker) — standard Supabase behavior.

-- ---- RPC: per-user vector match ----------------------------
create or replace function public.match_user_chunks(
  query_embedding vector(1536),
  match_count int default 8,
  p_user_id uuid default auth.uid()
)
returns table (
  chunk_id uuid,
  document_id uuid,
  title text,
  source_label text,
  doc_type text,
  year int,
  section text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    c.id,
    c.document_id,
    d.title,
    d.source_label,
    d.doc_type,
    d.year,
    c.section,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.user_document_chunks c
  join public.user_documents d on d.id = c.document_id
  where c.user_id = p_user_id        -- belt
    and d.user_id = p_user_id        -- and suspenders
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function public.match_user_chunks(vector, int, uuid) from public;
grant execute on function public.match_user_chunks(vector, int, uuid) to authenticated;
```

---

## Upload flow

1. **Browser** — user signs in (existing Supabase auth), clicks "My library → Upload guideline PDF".
2. **Browser** — POSTs PDF + form fields (`title`, `source_label`, `doc_type`, `year`) to worker `/upload_user_doc` with the user's JWT in `Authorization: Bearer <token>`.
3. **Worker `/upload_user_doc`** —
   a. Validates JWT, extracts `user_id`.
   b. Rejects if size > 20 MB or user already at 50-doc / 200 MB cap.
   c. Computes sha256; rejects if `(user_id, sha256)` already exists.
   d. Extracts text (pdf-parse / unpdf in worker, or offload to a Supabase Edge Function for heavier PDFs).
   e. Chunks: ~800 token chunks with ~150 token overlap, section-aware where headings are detectable.
   f. Embeds each chunk via OpenAI `text-embedding-3-small`.
   g. Inserts `user_documents` row + N `user_document_chunks` rows via service role (bypassing RLS for the insert, since the worker is acting on behalf of the authenticated user). Both rows carry the authenticated `user_id`.
   h. Returns `{ document_id, chunk_count }`.
4. **Browser** — shows the new doc in "My library" with delete button.

## Retrieval flow

When a signed-in user generates a chalk talk:

1. Browser hits `retrieveRAG(topic)` as today → public corpus.
2. Browser **additionally** hits `retrievePrivate(topic)` → worker `/retrieve_user` with JWT.
3. Worker validates JWT, embeds query, calls `match_user_chunks` RPC (which RLS-enforces `user_id = auth.uid()`).
4. Worker returns the user-scoped chunks tagged `is_private: true`.
5. `index.html` merges the two result sets. Private chunks render in the sources panel with a 🔒 lock badge and the label "From your library", **without** a PubMed link.
6. The directive prompt is extended:
   > Some sources below are tagged `[PRIVATE]`. Cite them inline as `[Private: KDIGO 2024 CKD §3.1]` instead of `PMID NNNNNNN`. Never expose the raw content outside the talk to any other user; treat as the uploader's personal study material.

## UI additions

- **My library** tab in the app, listing uploaded docs with size, upload date, chunk count, delete button.
- **Upload modal**: drag-drop PDF, prefilled title (from PDF metadata), required `source_label` text input, optional `year` and `doc_type` dropdown.
- **Sources panel**: lock badge + "From your library" pill for private hits; tier badges unchanged for public corpus hits.
- **TOS modal on first upload**: "I have legitimate access to this document. I will use it for personal research and education only. Chalk Talk does not redistribute uploaded content."

## What v2 explicitly does NOT do

- No sharing of user-uploaded chunks across users, even within an institution.
- No "team library" — that's v3 territory and requires a license review.
- No OCR for scanned PDFs in v2 (text-layer PDFs only; reject scanned ones with a clear message).
- No automatic re-ingest on guideline updates — user re-uploads.
- No surfacing of private chunks via the public `/retrieve` endpoint, ever.

## v2 launch checklist

- [ ] Apply migration_v3_user_uploads.sql
- [ ] Add `/upload_user_doc` and `/retrieve_user` to `worker.js` with JWT validation
- [ ] PDF text extraction + chunking implementation (pdf-parse in worker or Supabase Edge Function)
- [ ] Browser: "My library" UI + upload modal + TOS gate
- [ ] Browser: `retrievePrivate()` + merged sources panel with 🔒 badge
- [ ] Directive prompt extension for `[PRIVATE]` citation format
- [ ] TOS update + privacy policy section on per-user uploads
- [ ] Per-user usage cap enforcement (50 docs / 200 MB)
- [ ] Delete-cascade smoke test (delete user → all user_documents + user_document_chunks gone)
- [ ] Cross-user retrieval smoke test (User A uploads, User B searches same topic, must not see A's chunks)
