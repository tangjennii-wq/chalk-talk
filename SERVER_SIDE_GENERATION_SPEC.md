# Server-Side Generation — Architecture Spec

**Goal:** Make Chalk Talk generation survive mobile backgrounding, screen-off, app-switching, and unreliable network. Today, every generation requires the tab to stay foregrounded for 60-90 seconds straight; this spec moves the actual work onto Cloudflare's edge so the phone can do anything during generation.

**Status:** Spec — not yet built. Estimated build: **3-4 hours of focused work, two files (`worker.js` + `index.html`).** Recommend dedicated session.

---

## The problem

iOS Safari (and to a lesser extent Android Chrome) **pauses JavaScript execution** when the tab is backgrounded — to save battery. The in-flight `fetch()` dies. The user comes back to a "JSON parse error" or a perpetual spinner that never resolves.

Workarounds we've already tried:
- ✓ Clear error when stream interrupts ("Tap Generate again — keep the tab open")
- ✓ Visible warning during generation ("📱 Keep this tab open while generating")

The real fix is to move the long-running work off the device entirely.

---

## The solution

Cloudflare Workers run on Cloudflare's edge network. They keep running whether your phone is on or off. We split generation into **two short HTTP calls**:

1. **Submit** (~50ms): Frontend POSTs the request body. Worker stashes it, generates a job ID, kicks off the actual generation in the background via `ctx.waitUntil()`, and returns `{ jobId }` immediately.

2. **Poll** (~30ms every 3-5 seconds): Frontend asks "is job X done?" Worker responds with status (running / done / error) and result if done. Poll loops until done.

Each individual call is tiny — survives any backgrounding because the round-trip is sub-second. The heavy work happens server-side and continues regardless of the phone's state.

---

## Cloudflare components

### What we need

- **Cloudflare Workers Paid plan** ($5/month). Free plan caps `ctx.waitUntil()` at 30 seconds, which would kill mid-generation. Paid plan allows long-running background tasks up to 30 minutes.
- **Cloudflare Workers KV** for job storage. Free tier includes 100K reads + 1K writes/day — more than enough.
- **Existing Anthropic API key** (already configured as Worker secret) — no change.

### Total monthly cost: $5

---

## New Worker endpoints

### `POST /generate-async`

**Request body:** Same shape as the current single-fetch `/v1/messages` call. Contains everything the current generate() flow assembles: topic, depth, style, refineContext, glRef, ragChunks, etc. Bundled into a single payload object.

**Response (≤100ms):**
```json
{
  "jobId": "a3f9c2d1-...-uuid",
  "createdAt": "2026-06-09T22:30:00Z",
  "expiresAt": "2026-06-09T22:35:00Z"
}
```

**Worker logic:**
1. Validate the request (existing rate-limit check still applies — uses CF-Connecting-IP).
2. Generate a UUID `jobId`.
3. Store `{ status: "running", body, createdAt }` in KV at key `job:${jobId}` with 5-minute TTL.
4. Call `ctx.waitUntil(runGeneration(jobId, body, env))` to start the real work in the background.
5. Return the `jobId` immediately.

### `GET /generate-status/:jobId`

**Response (running):**
```json
{
  "status": "running",
  "elapsedSec": 23,
  "stage": "drafting",
  "streamingTitle": "Diabetic Ketoacidosis: Mgmt"
}
```

**Response (done):**
```json
{
  "status": "done",
  "talk": { ... full audited talk JSON ... },
  "modelUsed": "claude-opus-4-7",
  "stages": {
    "ragMs": 4800,
    "draftMs": 38000,
    "critiqueMs": 12000,
    "auditMs": 14000
  }
}
```

**Response (error):**
```json
{
  "status": "error",
  "error": "Anthropic overloaded — try again in a minute.",
  "code": "upstream_overloaded"
}
```

**Worker logic:**
1. Look up `job:${jobId}` in KV.
2. If not found → 404 (job expired or invalid).
3. Return the stored job object as JSON.

### `POST /generate-cancel/:jobId`

**Response:**
```json
{ "status": "cancelled" }
```

**Worker logic:** Sets `cancelled: true` flag on the job. The background `runGeneration` checks this flag at each step boundary and bails if set. Best-effort — in-flight Anthropic calls aren't cancellable from the Worker.

---

## KV schema

**Key:** `job:${jobId}` (UUID v4 string)
**TTL:** 5 minutes from creation

**Value shape (JSON):**
```typescript
{
  status: "running" | "done" | "error" | "cancelled",
  body: { ... original request body ... },
  result?: {
    talk: { ... },
    modelUsed: string,
    stages: { ragMs, draftMs, critiqueMs, auditMs }
  },
  error?: { code: string, message: string },
  createdAt: ISO8601 string,
  updatedAt: ISO8601 string,
  cancelled?: boolean,
  // Streaming metadata so polling can show progress
  stage?: "rag" | "drafting" | "critique" | "audit",
  streamingTitle?: string,
  streamingChars?: number,
  elapsedSec?: number
}
```

KV writes are eventually consistent — usually 100-500ms to propagate globally. Within the same edge POP (which Cloudflare prefers to keep), reads are immediate. Polling cadence of 3-5s is well within this.

---

## The runGeneration function

This is the server-side equivalent of the current frontend `generate()`. Lives in `worker.js`:

```typescript
async function runGeneration(jobId, body, env) {
  const updateJob = async (patch) => {
    const current = JSON.parse(await env.JOBS_KV.get(`job:${jobId}`) || "{}");
    if (current.cancelled) return false; // bail
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await env.JOBS_KV.put(`job:${jobId}`, JSON.stringify(next), { expirationTtl: 300 });
    return true;
  };

  try {
    // Step 1: RAG retrieval
    await updateJob({ stage: "rag" });
    const ragResult = await retrieveRAGFromBody(body, env);

    // Step 2: Draft
    await updateJob({ stage: "drafting" });
    const draftResult = await callAnthropicWithFallback(buildDraftPrompt(body, ragResult), env, {
      onStreamChunk: (chunk, fullText) => {
        // throttled KV update for streaming title + char count
        // (in-flight updates — let polling pick them up)
      }
    });

    // Step 3: Critique
    await updateJob({ stage: "critique" });
    let finalTalk = JSON.parse(fixJSON(draftResult.txt));
    finalTalk = await runCritique(finalTalk, body, env);

    // Step 4: Citation audit
    await updateJob({ stage: "audit" });
    finalTalk = pruneFakeReferences(finalTalk);
    finalTalk = await verifyCitations(finalTalk, env);

    // Step 5: Done
    await updateJob({
      status: "done",
      result: { talk: finalTalk, modelUsed: draftResult.modelUsed, stages: { ...timings } }
    });
  } catch (err) {
    await updateJob({
      status: "error",
      error: { code: errorCode(err), message: err.message }
    });
  }
}
```

All the existing JS logic (`fixJSON`, `pruneFakeReferences`, `verifyCitations`, etc.) needs to be ported into `worker.js`. Most of it is pure functions of the talk JSON — straightforward translation. The RAG retrieval already lives in the Worker. The Anthropic call is just a `fetch`. Net code move: ~500 lines from `index.html` into `worker.js`.

---

## Frontend changes

### Replace single-fetch `generate()`

Current:
```js
async function generate() {
  // ...build body...
  const result = await callAPIWithFallback(sys, content, maxTok, models, opts);
  S.talk = JSON.parse(fixJSON(result.txt));
  // ...render...
}
```

New:
```js
async function generate() {
  // ...build body...
  const submitResp = await fetch(`${RAG_CONFIG.url}/generate-async`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  const { jobId } = await submitResp.json();
  S.activeJobId = jobId;

  // Poll for completion
  while (true) {
    await new Promise(r => setTimeout(r, 3000));
    if (S.genCancelled) break;
    const statusResp = await fetch(`${RAG_CONFIG.url}/generate-status/${jobId}`);
    const status = await statusResp.json();

    // Update streaming progress
    if (status.streamingTitle) S.streamingTitle = status.streamingTitle;
    if (status.streamingChars) S.streamingChars = status.streamingChars;
    if (status.stage) S.loadMsg = stageLabel(status.stage);
    render();

    if (status.status === "done") {
      S.talk = status.talk;
      render();
      break;
    }
    if (status.status === "error") {
      S.error = status.error.message;
      render();
      break;
    }
  }
}
```

### Critical advantages

- Each poll request is tiny (~30ms round-trip, ~200 byte response). Survives backgrounding because it completes in milliseconds.
- When the user backgrounds the tab, the *current* poll request may die — but the **next** poll on resume picks up the result.
- The Worker keeps doing the actual work regardless of what the phone does.

### `cancelGen()` becomes:
```js
async function cancelGen() {
  if (S.activeJobId) {
    fetch(`${RAG_CONFIG.url}/generate-cancel/${S.activeJobId}`, { method: "POST" });
  }
  S.genCancelled = true;
  // ...rest unchanged...
}
```

### `restartGen()` becomes:
Same — cancels current job, starts a new one. Old job's background work continues until the Worker checks `cancelled` flag and bails.

---

## Edge cases

### 1. User closes the browser entirely

The Worker keeps running. The result lands in KV. When user reopens the app:
- Frontend reads `S.activeJobId` from `localStorage` (persisted on each submit).
- If a job ID exists and is still in KV, resume polling.
- If the job is `done`, hydrate the talk and render.
- If the job expired (>5 min) or is missing, prompt user to regenerate.

### 2. KV expired before user came back

The job result is gone. User sees "Generation completed but results expired. Tap Generate to try again." Could extend TTL to 15 minutes for safety; cost is negligible (KV writes counted, not stored size).

### 3. User starts a second generation while the first is running

Two options:
- **(A)** Reject new submissions while a job is running. Toast: "Wait for current generation or tap Cancel."
- **(B)** Cancel the first job automatically, start the new one. Matches current restart-on-toggle behavior.

Recommend **B** to match existing UX.

### 4. Job is running, user toggles depth mid-flight

Current restart-on-toggle UX is preserved by cancelling the old job and POSTing a new one.

### 5. Worker crashes mid-generation

KV record stays in "running" status forever (until TTL). Frontend polling would keep seeing "running." Mitigation:
- Worker uses `try/catch` around the whole `runGeneration` body so it always writes either `done` or `error`.
- If polling sees "running" for > 5 minutes, frontend assumes the job is dead and gives up.

### 6. Two requests within 5 min hit prompt cache

`cache_control` works the same server-side as client-side. First generation primes the cache, subsequent ones are faster + cheaper. Net win on top of the backgrounding fix.

### 7. Rate limiting

Current per-IP rate limit (`incrementDailyCount`) still applies at submission time. Counting happens on submit, not completion.

### 8. Streaming progress lag

KV is eventually consistent — streaming title updates could lag the actual draft by 500-2000ms. Acceptable; the title is a nice-to-have, not a correctness thing.

---

## Migration strategy

### Phase 1: Build alongside existing flow (no risk)
- Add new endpoints to `worker.js`. Keep the existing `/v1/messages` endpoint untouched.
- Add new frontend code path behind a feature flag: `S.useAsyncGeneration` (default false).
- Test the new path manually with the flag flipped on. Existing users see no change.

### Phase 2: Soft launch
- Flip the flag default to true.
- Old path stays as fallback if the new path fails three times in a row.

### Phase 3: Cleanup (only after a week of stability)
- Remove the old `/v1/messages` endpoint.
- Remove the old frontend single-fetch path.

This is critical — we don't want to break a working app on a midnight push. The flag lets us roll back instantly if anything breaks.

---

## Cost analysis

### Cloudflare Workers Paid: $5/month
Required for `ctx.waitUntil()` past 30 seconds. This is the only new fixed cost.

### KV usage
- Submit: 1 KV write per generation
- Poll: 1 KV read per poll, ~20 polls per generation = 20 reads
- Per generation: 1 write + 20 reads + 5-10 streaming writes = ~10 writes, ~25 reads
- Free tier: 100K reads + 1K writes/day
- Even at 50 generations/day, well within free tier

### Anthropic API
Unchanged. Same Anthropic spend per talk.

### Total marginal cost vs. today: $5/month flat

---

## Build phases (suggested order)

| Phase | Estimate | What | Risk |
|-------|----------|------|------|
| 1. Worker scaffolding | 30 min | Add empty `/generate-async`, `/generate-status/:jobId`, `/generate-cancel/:jobId` endpoints. KV binding setup. | Low — additive only |
| 2. Move RAG + Anthropic call to Worker | 60 min | Port the existing draft pipeline. Test with a simple request that just returns draft. | Medium — touches existing logic |
| 3. Port critique + citation audit | 45 min | Move the JS helpers (fixJSON, pruneFakeReferences, verifyCitations) into `worker.js`. | Medium — these are stateful and have edge cases |
| 4. Worker polish — streaming progress + cancel | 30 min | Wire streaming chunk callback to KV updates. Implement cancel flag check. | Low |
| 5. Frontend submit-and-poll | 45 min | Replace single-fetch with the new flow. Add `S.activeJobId`, `localStorage` persistence, polling loop. | Medium |
| 6. Feature flag + rollout | 30 min | Wire the flag, default-off, instructions to enable. | Low |
| **Total** | **3.5-4 hours** | | |

---

## Testing checklist (before flipping the flag on)

- [ ] Submit a Concise Lecture — completes correctly
- [ ] Submit a Detailed Lecture — completes correctly
- [ ] Submit a Boards question — completes correctly
- [ ] Submit with refine context — completes correctly
- [ ] Submit with cross-check web on — completes correctly
- [ ] Background the tab during generation — completes correctly when foregrounded
- [ ] Lock phone during generation — completes correctly when unlocked
- [ ] Toggle depth mid-generation — old job cancels, new job runs
- [ ] Tap cancel mid-generation — job stops, no result rendered
- [ ] Close browser entirely during gen — reopening shows completed talk
- [ ] Try when job has already expired — graceful error message
- [ ] Try with Worker offline — frontend falls back to old path (if flag-gated)
- [ ] Concurrent submissions from same user — second cancels first
- [ ] Verify TLS/CORS still works with new endpoints

---

## Files touched

- `worker.js` — new endpoints + ported logic (~500 lines added)
- `index.html` — replace `generate()` body, add polling helper, persist `activeJobId` (~150 lines changed)
- `wrangler.toml` — add KV namespace binding
- `supabase/migrations/` — no changes
- New file: nothing

---

## Pre-build checklist

Before starting the build session:

1. Confirm Cloudflare Workers Paid plan is active (or upgrade)
2. Create KV namespace via Cloudflare dashboard: `wrangler kv namespace create CHALK_TALK_JOBS`
3. Add `JOBS_KV` binding to `wrangler.toml`
4. Make sure local `wrangler dev` works for testing
5. Have a backup of current `index.html` and `worker.js` (git is enough)

---

## When NOT to build this

- If she's planning to stop using Chalk Talk on phone entirely
- If backgrounding turns out to not actually be the bottleneck (might just be slow generation)
- If we find a way to make all generations under 30 seconds (Cloudflare free tier limit)

Otherwise this is the right architectural fix and it'll feel like night and day on phone.

---

*Spec written 2026-06-09. Build pending — dedicated session recommended.*
