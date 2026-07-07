# Chalk Talk — Architecture

How the whole system fits together, for a future collaborator (or future you). Written to be read top to bottom; every layer names the functions/files that implement it so you can find things.

## Big picture

Chalk Talk is **one HTML file + one Cloudflare Worker + one Supabase database**, with Anthropic and OpenAI as the AI engines. You open `index.html` in a browser, type a topic, and hit Generate. The page assembles a prompt (your guideline summaries + retrieved PubMed abstracts + depth choice) and sends it to Claude: **Opus 4.8 writes a draft, then a second model peer-reviews and corrects it** before you see anything. GitHub Pages hosts the file for free; a small **Cloudflare Worker** sits in front of Anthropic to hold the API key, rate-limit abuse, and meter cost; **Supabase** handles sign-in, saving, quotas, and public sharing.

The four files that matter: `index.html` (all frontend + prompts + pipeline), `worker.js` (proxy + free-tier + RAG endpoints), `supabase/migration_v1.sql` + `migration_v3_free_tier.sql` (tables + RLS), and `rag/ingest_pubmed.mjs` (how the citation corpus is built).

## 1. Stack & hosting

- **Frontend:** a single file, `index.html` (~9,700 lines). Everything is inline — UI, prompts, the topic taxonomy, guideline summaries, the baked-in sample talks. Only external libraries: the Supabase JS SDK and html2canvas (for "Save as image"). No framework, no build step.
- **Hosting:** GitHub Pages, deploy-from-branch/root. Live at `https://tangjennii-wq.github.io/chalk-talk/`.
- **Reaching the backend:** chosen per request in `callAPI()`. Three routes — (1) **Free tier** (signed in, no own key) → the Worker at `https://chalk-talk-proxy.chalktalk.workers.dev` on the owner's key; (2) **Demo proxy** (`PROXY_CONFIG`, currently disabled) → also the Worker; (3) **BYOK** ("use my own key") → straight to `api.anthropic.com`.

## 2. State & render model

There is one global state object, `S`, holding everything: current topic, the generated `talk`, loading flags, the signed-in `user`, open modals, free-tier counts.

The UI is **rebuild-from-state**: `render()` reads `S`, decides the view, sets `root.innerHTML` to freshly generated HTML, then a matching `bind*()` function re-attaches event handlers. The pattern everywhere is **event handler mutates `S` → calls `render()`**, which throws away the old DOM and paints new HTML. There is no virtual DOM — almost any change re-renders the whole view. (Practical consequence: handlers must be re-bound every render, and a background re-render can replace a button mid-interaction — which is why the refine send button uses a delegated document-level listener instead of a per-render `onclick`.) Modals render into a separate `#globalModals` node so switching views doesn't close an open dialog. The generation pipeline uses `S.streaming*` fields to repaint progressively as the talk streams in.

## 3. Generation pipeline (the core: `generate()`)

Everything below happens when you hit Generate.

1. **Gatekeeping.** If the free tier is on and you're signed out with no key → sign-in nudge. If you're on the free tier → consume 1 talk of quota up front (once per generation, not per API call).
2. **Assemble context** (this is where grounding happens, on the FIRST draft):
   - `getGuidelinesForTopic(topic)` maps your topic to specialties via a keyword map and pulls your telegraphic society-guideline summaries + landmark-trial names → the "GUIDELINE REFERENCE CONTEXT" block.
   - `retrieveRAG(topic)` calls the Worker's `/retrieve` endpoint for real PubMed abstracts → the RAG block (see §4).
   - `buildTrialExpansionContext()` adds detail if the topic names a curated landmark trial.
3. **Depth hint.** `S.depth` sets Concise (~6-min, tighter caps) vs Detailed (full 10-min, deeper). This only changes prompt text + token caps, not which models run.
4. **System prompt.** `LECTURE_PROMPT` or `BOARDS_PROMPT` — long prompts defining the JSON schema, mechanism-first structure, mandatory citations, drug-name-spelling rules, and (boards) the UWorld/MKSAP vignette format with alphabetized answer choices.
5. **Draft call.** `callAPIWithFallback()` with `[Opus 4.8 → Sonnet 4 → Haiku 4.5]`. Opus always drafts; the others are used only if Opus is overloaded (HTTP 529). The response streams; partial JSON is parsed every ~450 chars so sections appear as they form.
6. **Critique / verification pass.** A *second* Claude call reviews the draft. **Lecture:** a guideline-aware checklist prompt (numeric audit → re-derive every threshold/dose; internal-consistency scan; grounding check against the injected context; completeness/required-field check) reviewed by **Sonnet (Haiku fallback)**. **Boards:** the fuller boards verification (re-derive the answer, verify stem style, alphabetized choices, Key Point) reviewed by **Opus → Sonnet → Haiku**. The same guideline+RAG context the draft saw is fed to the critique so it has ground truth. It returns `{"verdict":"clean"}` (keep draft) or a full corrected talk (replace).
7. **Citation pruning, two passes.** `pruneFakeReferences()` runs synchronously (drops references whose PMID wasn't retrieved and isn't in the body; marks fabricated inline PMIDs `[unverified]`), then the talk renders. A slower `verifyCitations()` pass runs in the background and shows a "✓ Citations verified" toast when done — read now, verify after.

One-liner: **Opus drafts; Sonnet (or Opus for boards) critiques; Haiku is the cheap fallback.**

## 4. RAG / guideline grounding

Two distinct mechanisms — don't confuse them:

- **Guideline summaries (built in).** The `GUIDELINES` object in `index.html` holds telegraphic, one-line-per-recommendation summaries of society guidelines plus landmark-trial names. Ships inside the file, no network call. Selected by keyword via `getGuidelinesForTopic()`.
- **PubMed RAG (retrieved live).** The `rag/` folder is the *ingestion* side: Node scripts (`ingest_pubmed.mjs`, `ingest_landmarks.mjs`, …) pull public-domain PubMed review abstracts, embed them with OpenAI `text-embedding-3-small`, and store them in Supabase `documents`/`document_chunks` (pgvector; schema in `migration_v2_rag.sql`). At generation time `retrieveRAG()` POSTs the topic to the Worker's `/retrieve`; the Worker embeds the query, calls the Postgres `match_chunks()` similarity search, and returns top abstracts. The frontend keeps only results above an absolute + relative similarity floor. Real PMIDs are what let the app cite verifiable sources instead of hallucinating them.

Both are injected into the **first** draft. RAG is not a second-pass step.

## 5. Refine (surgical patching, not regeneration)

The floating refine composer does **not** regenerate the talk:

- `weaveRevision(userMsg)` builds an indexed snapshot (every bullet tagged with a coordinate) and asks Sonnet for a **JSON patch** of surgical ops — `edit_section_bullets`, `delete_pearls`, `add_sections`, `edit_vmc`, etc. — targeting those coordinates. The prompt insists "surgical, not wholesale."
- `applyWeavePatch(talk, patch)` applies the patch deterministically in JS: edits in place, tombstones deletes, then compacts. Anything not explicitly named is preserved verbatim. It returns actual applied counts + warnings, so a bad index shows up in the confirmation.

Escape hatches: "rewrite"/"make it shorter" falls through to a full `generate()`. A refine costs 1 free-tier talk. Undo is supported. If a refine changes core content, the AI image is flagged stale (regenerate banner) and the Visual Memory Card is flagged stale unless the patch included an `edit_vmc` to keep it in sync.

## 6. Cloudflare Worker (`worker.js`)

A thin, security-focused proxy:

- **`POST /v1/messages`** → Anthropic, with an **origin allowlist** (else 403), model allowlist, tool allowlist (only built-in `web_search`), max-tokens cap, and 5 MB body limit.
- **Per-IP rate limiting** via Cloudflare KV (`rl:<date>:<ip>`, default 10/day) — governs the legacy/demo path.
- **`POST /retrieve`** — the RAG endpoint (embeds query, calls `match_chunks`).
- **`POST /v1/images/generations`** — proxies OpenAI image generation.
- **Free-tier endpoints** — `/v1/free-tier/status`, `/consume`, `/admin/bonus`.
- **`GET /share/:token`** — public share lookup (no origin check; public viewers have no Origin header).

**Free-tier enforcement:** a free-tier request carries the user's Supabase token in `X-Supabase-Auth`. The Worker verifies the user, checks the **system-wide monthly spend cap** ($250 default — if hit, returns 503 "free tier paused"), forwards to Anthropic on the owner's key, and **meters real cost** asynchronously into `spend_ledger`. Quota is NOT consumed here — it's consumed once per generation via `/consume`, because one generation = draft + critique + retries = several `/v1/messages` calls.

## 7. Auth & data — Supabase

**Auth:** magic-link email (`signInWithOtp`) + Google OAuth (`signInWithOAuth`). `onAuthStateChange` keeps `S.user` in sync and loads profile + free-tier status on sign-in (deduped so it doesn't fire the load three times).

**Tables:**
- `profiles` — extends `auth.users` (name, role, specialty, institution); auto-created by a signup trigger.
- `talks` — the saved talk (`talk_json` jsonb) with `style`, `depth`, `is_public`, `is_featured`, `share_token`, and attribution columns (`source_id`, `source_curator_name`).
- `favorites` — starred sample slugs.
- `free_tier_usage`, `spend_ledger` — per-user quota counters + the system-wide monthly spend tally, with SQL helpers `free_tier_remaining`, `free_tier_consume` (atomic/race-safe), `ledger_add`, `free_tier_grant_bonus`.
- `documents` / `document_chunks` — the RAG corpus.

**RLS (Row-Level Security)** enforces privacy in the database, not app code. On `talks`: read your own rows, OR read any row where `is_public = true`. Quota tables are read-only to users (so the badge can show remaining) and writable only by the Worker's service-role key (bypasses RLS). The anon key is safe to ship precisely because RLS gates everything.

## 8. Free tier & BYOK

`FREE_TIER_CONFIG.enabled = true`. Routing decided by `freeTierActive()`: free tier applies only when the config is on, you're signed in with a Supabase token, you have no own key, and haven't flipped BYOK. Free users get **10 talks + 5 images** on the owner's key through the Worker.

- **Consume:** frontend calls `/consume` once per generation; SQL `free_tier_consume` atomically decrements only if quota remains (else the upsell modal).
- **Cost ceiling:** each free call meters cost into `spend_ledger`; crossing $250/month pauses the tier for everyone (fall back to BYOK).
- **BYOK:** your own key routes `callAPI()` straight to Anthropic — no Worker, no quota, no metering. The app is "fail-open": only a genuine `quota_exceeded`/`free_tier_paused` blocks you.

## 9. Sharing / showcase

Publishing is a flag flip; the safety scrub happens in Postgres triggers:

- **Publish** (`cloudSetPublic`) sets `is_public = true`. Trigger `scrub_on_publish` strips `refine_context` (may contain copyrighted paste-ins) before the row goes public and ensures a `share_token`. (Note: AI-generated images are intentionally kept on published talks.)
- **Feature** (`cloudSetFeatured`) sets `is_featured = true`; a trigger forces `is_public = true` too. The Showcase view queries `WHERE user_id = curator AND is_public AND is_featured`.
- **Public read** via RLS: the Worker's `GET /share/:token` looks up by token with the anon key, strips PII, adds the author's display name, and edge-caches ~5 min; or the landing page loads featured talks directly. Viewers can "Save copy," and attribution stamps the original author.

## Known stale/dormant bits

- `PROXY_CONFIG.enabled` is `false` — the older "demo proxy" path is dormant; live routing is free-tier-via-Worker or BYOK.
- The `index.html` model constants and the `generate()` pipeline are authoritative for which models run (Opus draft, Sonnet/Opus critique).
