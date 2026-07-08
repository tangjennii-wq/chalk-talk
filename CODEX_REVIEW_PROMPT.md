# Codex review prompt — Chalk Talk

Paste everything below the line into Codex, run from the repo root (`~/Developer/chalk-talk`).

---

You are reviewing a single-file web app (`index.html`, vanilla JS, no build step) plus a Cloudflare
Worker (`worker.js`) and its `wrangler.toml`. I want an **adversarial bug hunt**, not a style review.
Do **not** rewrite or "improve" anything.

Report findings in three sections:
1. **Bugs** — real defects, each as `file:line — problem — one-line fix`, ordered by severity.
2. **Cannot verify / deployment & schema assumptions** — anything whose correctness depends on
   deployed state you can't see from local files (Supabase RPCs/columns, KV bindings, secrets, the
   live Worker version). List the assumption and how to confirm it.
3. **Confidence** — for each high-risk area (async generation, quota, provider dispatch), say which
   code paths you actually traced and any untested assumptions. If an area is clean, don't just say
   "clean" — say what you traced to conclude that.

## How to scope the review

The intended base commit for this session's changes is `a93c75f`. **First run
`git --no-pager log --oneline a93c75f..HEAD` and sanity-check that the range is this session's work
(background generation, multi-provider, free tier, reorder, proofread). If unrelated commits have
landed since, ask me for the correct base commit before reviewing.** Then:

```
git --no-pager diff a93c75f..HEAD -- index.html worker.js wrangler.toml
git --no-pager diff --name-only a93c75f..HEAD -- supabase/   # then, if migrations changed:
git --no-pager diff a93c75f..HEAD -- supabase/migrations/ supabase/*.sql
```
If no SQL changed, note that DB schema is out of scope (verify against deployed state — see the
Cannot-verify section).

Read the full diff before judging any single hunk — several features touch the same functions
(`generate()`, `callAPI()`, `render()`).

## What changed this session (intent, so you can check behavior against it)

1. **Free-tier charge-after** — quota (10 talks / 5 images) is consumed only AFTER a generation/refine
   succeeds, exactly once. A cancelled/failed/superseded gen must never burn a credit.
2. **Multi-provider generation** — a dispatcher in `callAPI()` routes to Claude (free-tier via Worker,
   or BYOK direct), ChatGPT (`gpt-5`, BYOK, routed through the Worker `/v1/openai/chat` because OpenAI
   blocks browser CORS), or Gemini (BYOK, browser-direct). Free tier is Claude-only; quota must be
   gated to Claude and never charged for BYOK/ChatGPT/Gemini.
3. **Key handling** — keys live in localStorage only. Invariants to verify:
   - Anthropic BYOK: browser → `api.anthropic.com` directly (or Worker on the owner's key for free tier).
   - OpenAI BYOK: the user's key is sent to **our Worker** via the `X-Provider-Key` header purely as a
     CORS relay to OpenAI — it must NOT be logged, stored, or persisted anywhere in the Worker, and must
     be forwarded only to OpenAI. Verify that exact invariant.
   - Gemini BYOK: browser → Google directly (key in the query param is inherent to Google's API).
   - No key ever logged, put in a URL we control, or sent to the wrong provider's endpoint.
4. **Server-side background generation (newest, highest-risk)** — free-tier Claude generations submit a
   job to the Worker (`POST /generate-async` → `{jobId}`), which runs draft+critique via
   `ctx.waitUntil` into `JOBS_KV` and is polled (`GET /generate-status/:id`) / cancellable
   (`POST /generate-cancel/:id`). Goal: the talk keeps generating when the tab is backgrounded / phone
   locked, and a page reload reconnects to the in-flight job. **Must transparently fall back to the
   synchronous path** whenever `JOBS_KV` is absent (Worker returns 503 `async_unconfigured`) or the
   submit fails for any reason (any status / network error).
5. **Quota accounting across sync vs async (trace this hard — it's the crux):**
   - SYNC path: the FRONTEND consumes 1 talk after the talk renders (charge-after).
   - ASYNC path: the WORKER consumes 1 talk SERVER-SIDE inside `runGeneration` on job success, because
     the job completes even if the user backgrounds/closes the tab and never reconnects. The frontend
     therefore SKIPS its client-side consume when the async path was used (`_useAsync`), and
     `resumeAsyncJobIfAny` does NOT consume either.
   - The Worker meters $ spend into `spend_ledger` on BOTH paths (authoritative for the $250/mo cap).
   - **Invariant to verify: every successful generation consumes exactly ONE talk — never zero
     (closed-tab async job), never two (worker + frontend both charging).** Trace: (a) async job
     succeeds while user never reconnects; (b) async job succeeds and user IS watching; (c) reload
     mid-job then reconnect; (d) restart (genId bump) during an async poll; (e) cancel during draft vs
     during critique. For each, state how many times quota is consumed.
   - **Also trace REFINE and IMAGE quota separately.** Refine consumes 1 *talk* (frontend, after the
     patch JSON parses); the 5-image pool is separate. Refine and image go through the SYNCHRONOUS path
     only — confirm the async talk-quota rules (server-side consume, `_useAsync` skip) do NOT leak into
     the refine or image paths, and that neither is charged on a failed/malformed result.
6. **Library drag-to-reorder** — pointer-events, within a specialty group, persisted to a `sort_order`
   column, drives both the library and the public showcase order.
7. **Apply-proofread refine mode** — a toggle; applies external (OpenEvidence) feedback as a
   changed-sections-only rewrite; must not silently drop large chunks of the talk; must not charge quota
   if the model returns unusable JSON.
8. **Misc**: How-it-works auto-expand first-visit-only + collapse on New talk; typed topic survives the
   sign-in redirect; cache-control meta; Google mobile sign-in fix; Print in the overflow menu;
   optional Outcomes/Prognosis lecture section.

## Focus areas — check these hard

**A. Async generation** (`worker.js`: `handleGenerateAsync`, `runGeneration`, `callAnthropicText`,
`handleGenerateStatus`, `handleGenerateCancel`; `index.html`: `asyncGenApplicable`,
`submitAsyncGeneration`, `pollAsyncGeneration`, `resumeAsyncJobIfAny`, `cancelGen`, and the async
branch inside `generate()`):
- Does EVERY async-submit failure (503 `async_unconfigured`, 503 `free_tier_paused`, 403
  `quota_exceeded`, 401, other 4xx/5xx, network throw) fall back to the sync path silently or surface
  the right modal — never hang, never a raw error?
- **Quota invariant (§5 above): trace all five scenarios and confirm exactly-once.**
- **Abuse / direct-endpoint bypass:** can a user with a valid Supabase token bypass quota by calling
  `/generate-async` or the sync `/v1/messages` endpoint directly (skipping the frontend consume)? What
  bounds the damage (per-user quota check at submit? the $250 cap? per-IP rate limit)? Is the async
  submit-time `free_tier_remaining` check sufficient, and is there a TOCTOU window if many jobs are
  submitted in parallel before any completes?
- **Superseded invocation:** the async poll is a `setTimeout` loop NOT killed by the abort signal. Trace
  what a superseded old `generate()` invocation does to shared state (`S.loading`, `loadTimer`, the
  `ct_active_job` localStorage key, `render()`), including on the tick it receives `status:"done"`.
  Confirm it can't stomp the new gen's spinner/timer or delete the new gen's reconnect key.
- `pollAsyncGeneration`: bounded by `maxPollMs`? No infinite loop on repeated 404 / non-OK? Does a
  transient network error keep polling (the point) rather than aborting?
- Worker `callAnthropicText`/`runGeneration`: model allowlist + token cap enforced on client-supplied
  `models`/`maxTok`? Are only **assistant text blocks** concatenated, while `tool_use` / `input_json` /
  web-search-result blocks are ignored (not spliced into the model text)? Are only allowlisted tool
  types forwarded? Does a job cancelled mid-run stop writing to KV and skip the quota consume?
- Route path-slicing for `/generate-status/` and `/generate-cancel/` — any off-by-one in `slice()`?
- `localStorage` job key (`ct_active_job`) cleaned up on success, cancel, error, expiry — and never
  cleaned up by a *superseded* invocation belonging to a different gen?

**B. Free tier / quota / spend** (`freeTierActive`, `genUsesFreeTier`, `consumeFreeTier`,
Worker `/v1/free-tier/*`, `estimateCostCents`, `ledger_add`, the $250 cap):
- Quota consumed for BYOK / ChatGPT / Gemini anywhere? Must not be.
- Charge-after: can a failed/cancelled/superseded gen still charge? Can a successful gen fail to charge?
- Spend cap crossing pauses the tier gracefully (fall back to BYOK), not a raw error?

**C. Provider dispatch** (`callAPI`, `_callOpenAIText`, `_callGeminiText`, `callAPIWithFallback`):
- Correct endpoint/headers per provider; Claude model-fallback chain fires only on overload (529/5xx),
  never on 4xx; non-Claude providers never enter the Claude chain.
- For ChatGPT/Gemini specifically: do failures (auth, rate limit, timeout, malformed JSON) surface
  cleanly to the user WITHOUT falling through to Claude and WITHOUT consuming free-tier quota? Do they
  have their own JSON-repair / error handling, or do they rely on shared code that assumes Claude?

**D. Reorder persistence:** `sort_order` actually written per card (not always 0); ordering survives
reload and drives showcase; scoped within a specialty group.

**E. `render()` churn + stale closures:** handlers are re-bound every render and a background re-render
can swap a button mid-interaction. The DOM is rebuilt via `innerHTML`, so duplicate DOM listeners are
less likely than **stale async callbacks / global handlers** acting after a render. Check: global
handlers (`document.body` / document-level listeners), `setInterval` pollers, and any async completion
callback for stale closures that write `S` or the DOM after the view moved on (esp. the refine send
button, cancel, key modal, proofread toggle, and the async poll's `onStage`).

**F. General:** unhandled promise rejections; `await` in loops that must stay bounded; `JSON.parse` on
possibly-empty/garbage model output without try/catch; `setInterval` timers leaked on an early return;
`localStorage` access not wrapped against quota/private-mode exceptions.

## Deliverables

The three sections at the top (Bugs / Cannot-verify / Confidence). Call out loudly anything that
double-charges, charges zero on a successful generation, drops user content, or leaks/persists a key.
Skip style nits. Do not modify files — report only.
