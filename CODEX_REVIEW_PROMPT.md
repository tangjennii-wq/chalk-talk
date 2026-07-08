# Codex review prompt — Chalk Talk

Paste everything below the line into Codex, run from the repo root (`~/Developer/chalk-talk`).

---

You are reviewing a single-file web app (`index.html`, vanilla JS, no build step) plus a Cloudflare
Worker (`worker.js`) and its `wrangler.toml`. I want an **adversarial bug hunt**, not a style review.
Do **not** rewrite or "improve" anything.

Report in three sections:
1. **Bugs** — real defects, each as `file:line — problem — one-line fix`, ordered by severity.
2. **Cannot verify / deployment & schema assumptions** — anything whose correctness depends on deployed
   state you can't see locally (Supabase RPCs/columns, KV bindings, secrets, live provider API shapes).
   List the assumption and how to confirm it.
3. **Confidence** — for each high-risk area (async generation, quota, provider dispatch, uploads), say
   which code paths you actually traced. If clean, say what you traced to conclude that.

## How to scope the review

Intended base commit for this session's work is `a93c75f`. **First run
`git --no-pager log --oneline a93c75f..HEAD` and confirm the range is this session's work (background
generation, multi-provider, free tier, uploads, reorder, proofread). If unrelated commits landed since,
ask me for the correct base before reviewing.** Then:

```
git --no-pager diff a93c75f..HEAD -- index.html worker.js wrangler.toml
git --no-pager diff --name-only a93c75f..HEAD -- supabase/   # if migrations changed, diff those too
```

Read the whole diff before judging any hunk — features share functions (`generate()`, `callAPI()`,
`render()`).

## What changed this session (intent — check behavior against it)

1. **Multi-provider generation** — `callAPI()` dispatches Claude (free-tier via Worker, or BYOK direct),
   ChatGPT (`gpt-5`, BYOK via Worker `/v1/openai/chat`, OpenAI blocks browser CORS), Gemini
   (`gemini-3.1-pro-preview`, BYOK, browser-direct). Free tier is Claude-only; BYOK/ChatGPT/Gemini
   NEVER consume free-tier quota. Claude's model-fallback chain fires only on overload (529/5xx), never
   4xx; non-Claude providers never enter that chain.
2. **Uploaded references reach every provider** — `buildReferenceParts()` builds Anthropic-style
   `text` + `document`(pdf) + `image` parts. For ChatGPT/Gemini these are converted:
   `_toGeminiParts()` → Gemini `inlineData{mimeType,data}`; `_toOpenAIContent()` → OpenAI `image_url`
   (data URL) for images and `file{filename,file_data}` for PDFs. Plain-text content stays a string.
   The bug being guarded against: `_contentToText()` used to strip document/image parts so non-Claude
   models got filename-only.
3. **Reference-upload robustness** — one shared `addUploadedFiles()` for both uploaders: validates type,
   3.5 MB/file + 8-file caps, per-file `FileReader.onerror`, dedupe, clear reject toast. (Fixed an old
   closure bug where multi-file uploads all took the last file's name/type.)
4. **Server-side background generation** — free-tier Claude gens submit `POST /generate-async` →
   `{jobId}`; the Worker runs draft+critique via `ctx.waitUntil` into `JOBS_KV`; the client polls
   `GET /generate-status/:id` and cancels `POST /generate-cancel/:id`. Goal: keeps generating when the
   tab is backgrounded / phone locked; a reload reconnects (`resumeAsyncJobIfAny`, localStorage key
   `ct_active_job`). **Must fall back to the synchronous path** when `JOBS_KV` is absent (503
   `async_unconfigured`) or submit fails.
5. **Quota accounting — READ CAREFULLY, this is the crux and it changed:**
   - SYNC path: the FRONTEND consumes 1 talk after render (charge-after), via `/v1/free-tier/consume`.
   - ASYNC path: the WORKER **RESERVES** 1 talk ATOMICALLY at SUBMIT (`handleGenerateAsync` calls
     `consumeQuota`/`free_tier_consume`, which decrements only if quota remains). This both enforces the
     quota and prevents parallel jobs from over-running it. If none remain → 403 `quota_exceeded`.
     `runGeneration` **REFUNDS** that reservation (`refundQuotaTalk` → `free_tier_grant_bonus` by email)
     if the job cancels or errors. So async is NOT consume-on-completion anymore.
   - The frontend therefore does NOT consume for async (`generate()` skips its consume when `_useAsync`;
     `resumeAsyncJobIfAny` never consumes). On a 403 the frontend shows the paywall, not a sync fallback.
   - The Worker meters $ spend into `spend_ledger` on both paths (the $250/mo cap).
   - **Invariant: every successful generation consumes exactly ONE talk; a failed/cancelled one consumes
     ZERO; parallel jobs can't exceed remaining quota.** Trace and state the consume/refund count for:
     (a) async success, user watching; (b) async success, tab closed, never reconnects; (c) async job
     errors; (d) cancel during draft vs during critique; (e) restart/genId-bump mid-poll; (f) reload
     mid-job then reconnect; (g) TWO async submits fired in parallel with quota=1; (h) sync generation.
     Also: is there any path where the reservation leaks (reserved but never consumed-for-real and never
     refunded), e.g. job KV write fails after reserve, or `ctx.waitUntil` never runs?
6. **Image save to library** — `saveCurrentVisualToLibrary()` pushes into `S.talk.savedVisuals` then
   persists (cloud `cloudUpdateTalk`, or the specific localStorage row, or save-as-new). On any
   persistence failure it ROLLS BACK the in-memory push so the UI can't falsely show "saved." Verify the
   rollback covers every failure branch and that success actually persists `savedVisuals` (and fires the
   `has_visuals` trigger).
7. **Errors** — `humanizeError()` maps leaky raw errors (JSON SyntaxError, "Failed to fetch", raw
   `API 400:` passthrough, stack noise) to plain guidance; applied across generate/resume/refine/image.

## Focus areas — check these hard

**A. Async generation + quota** (`worker.js`: `handleGenerateAsync`, `runGeneration`, `refundQuotaTalk`,
`consumeQuota`, `callAnthropicText`, `handleGenerateStatus`, `handleGenerateCancel`; `index.html`:
`asyncGenApplicable`, `submitAsyncGeneration`, `pollAsyncGeneration`, `resumeAsyncJobIfAny`, `cancelGen`,
and the async branch in `generate()`):
- **Quota invariant (§5): trace all eight scenarios; confirm exactly-once / zero-on-failure / no
  parallel over-run / no reservation leak.** This is the #1 thing to get right.
- Per-error submit handling: `async_unconfigured`/network/5xx → silent sync fallback;
  `free_tier_paused` → sync fallback (sync surfaces it); `quota_exceeded` (403) → paywall, NOT sync;
  never hang / never raw error.
- Refund correctness: is `refundQuotaTalk` called on EVERY non-success exit of `runGeneration`
  (both cancel checkpoints + the final cancel check + the catch)? Can it double-refund (refund + also
  the job later completing)? Is `free_tier_grant_bonus`'s `p_email`/`p_bonus_talks` signature right?
- Superseded invocation: the async poll is a `setTimeout` loop NOT killed by the abort signal. Trace what
  a superseded old `generate()` does to shared state (`S.loading`, `loadTimer`, `ct_active_job`,
  `render()`), including on the tick it gets `status:"done"`. Can't stomp the new gen or delete its key?
- `pollAsyncGeneration`: bounded by `maxPollMs`? no infinite loop on repeated 404/non-OK? transient
  network keeps polling?
- Worker: model allowlist + token cap on client-supplied `models`/`maxTok`; only ASSISTANT TEXT blocks
  concatenated (ignore `tool_use`/`input_json`/search-result); only allowlisted tools forwarded;
  cancelled job stops writing KV. Route path-slicing for `/generate-status/` `/generate-cancel/` (off-by-one).

**B. Provider dispatch + uploads** (`callAPI`, `_callOpenAIText`, `_callGeminiText`,
`_toOpenAIContent`, `_toGeminiParts`, `callAPIWithFallback`, `buildReferenceParts`):
- Do the converters produce valid request shapes? Gemini `inlineData` for pdf+image; OpenAI `image_url`
  data URL for images and `file`/`file_data` for PDFs; plain text stays a string. Any part dropped, or
  malformed data URL / missing mime? Does the Worker forward the OpenAI body unchanged (so the rich
  content array survives)? Is the OpenAI `file` PDF part actually accepted by the chat completions API
  for `gpt-5`, or will it 400? (Flag as cannot-verify if unsure.)
- Do ChatGPT/Gemini failures (auth, rate limit, timeout, malformed JSON) surface cleanly, never fall
  through to Claude, never consume quota? Do they get the same `fixJSON` parse-repair as Claude?
- Request-size: an uploaded PDF can push the OpenAI proxy body over the Worker's 2 MB cap for
  `/v1/openai/chat` while the async Claude path allows 5 MB — is that mismatch handled gracefully?

**C. Free tier / spend** (`freeTierActive`, `genUsesFreeTier`, `consumeFreeTier`, `/v1/free-tier/*`,
`estimateCostCents`, `ledger_add`, $250 cap): quota consumed for BYOK/ChatGPT/Gemini anywhere (must not
be)? Can a failed/cancelled/superseded gen still charge, or a successful one fail to charge? Direct-
endpoint bypass: can missing/invalid Supabase auth reach the owner's key on `/generate-async`,
`/v1/messages`, `/v1/openai/chat` (only intended public/demo paths should be keyless)?

**D. Image save** (`saveCurrentVisualToLibrary`): rollback on every failure branch; success persists and
survives reload; no false "★ saved". Also the `dgSaveImgBtn` handler wiring.

**E. `render()` churn + stale closures:** DOM rebuilt via `innerHTML`, so the risk is stale async
callbacks / global (`document`-level) handlers / `setInterval` pollers writing `S` or the DOM after the
view moved on (refine send, cancel, key modal, proofread toggle, async poll `onStage`, file-read toasts).

**F. General:** unhandled promise rejections; `await` in unbounded loops; `JSON.parse` on empty/garbage
model output without try/catch; `setInterval` leaked on early return; `localStorage` access unguarded
against private-mode exceptions; `fixJSON` handling of preamble/postscript + maxToken-truncated tails,
especially with uploads or web-search.

## Deliverables

The three sections at top (Bugs / Cannot-verify / Confidence). Call out loudly anything that
double-charges, charges zero on success, leaks a reservation, drops user content, or leaks/persists a
key. Skip style nits. Do not modify files — report only.

**End with a one-line verdict: SHIP or DO NOT SHIP, plus the top 3 ship-blockers** (or "no blockers").
