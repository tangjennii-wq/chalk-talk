// DURABLE GENERATION — the step logic, deliberately free of Cloudflare imports.
//
// WHY THIS FILE HAS NO `cloudflare:workers` IMPORT. The WorkflowEntrypoint subclass lives in
// worker_entry.js; everything that can be wrong lives here, where Node can execute it. A workflow whose
// logic can only run on Cloudflare is a workflow whose logic is only tested by deploying, and this
// project has spent a day learning what untested-but-asserted looks like.
//
// ── THE ONE THING THAT COULD COST REAL MONEY ─────────────────────────────────────────────────────────
// `step.do()` RETRIES BY DEFAULT: limit 5, exponential backoff, when no config is supplied. So a naive
// `step.do("draft", () => callAnthropic(...))` can be billed five times for one talk.
//
// A runtime probe against the real Cloudflare runtime (2026-07-30) settled what the docs did not, and
// two answers came back worse than the docs implied:
//
//   * `limit: N` means 1 + N RETRIES. `limit: 3` executed FOUR times. The `limit: 1` this file used to
//     carry therefore permitted TWO paid calls per step.
//   * `NonRetryableError` did NOT stop retries — six executions against `limit: 5`. It cannot be relied
//     on as a guard.
//
// What actually protects the user, in order:
//   1. `PAID_RETRY = { retries: { limit: 0 } }` — measured to execute the callback exactly once.
//   2. A durable RESULT CACHE, so an engine restart re-enters on the stored response rather than buying
//      a second one. Restarts are not retries and no retry setting prevents them.
//   3. The attempt marker, which REFUSES when a call was issued and no result was stored — the state
//      where we cannot know whether the provider billed us.
//
// NonRetryableError is still thrown, for the message it puts on the instance. It is not a guard.
//
// ── OTHER RULES THIS FILE OBEYS ──────────────────────────────────────────────────────────────────────
// * Step names are deterministic string literals — the name is the cache key, so a name built from a
//   timestamp or a counter would silently defeat replay and re-run a paid call.
// * No side effects outside a step. The engine may restart and re-run anything at the top level.
// * No reliance on in-memory state between steps; everything meaningful is a step return value.
// * `event.payload` is treated as immutable.

// TTL for the attempt marker AND the result cache. Long enough to outlive any plausible restart window,
// short enough that a stale entry cannot block a genuinely new generation of the same job id.
const MARKER_TTL_SECONDS = 3600;

// ── MEASURED, NOT ASSUMED (runtime probe, 2026-07-30) ────────────────────────────────────────────────
// A throwaway Worker on the real runtime answered the questions the docs left open, and two answers
// changed this file:
//
//   `limit: 3`  →  FOUR executions.  `limit` means 1 + N RETRIES, not N attempts.
//                  So the previous `limit: 1` permitted TWO paid calls per step. That is the exact
//                  double-charge this design exists to prevent, sitting in the constant meant to prevent it.
//
//   `limit: 0`  →  ACCEPTED, callback ran exactly ONCE.
//                  The docs never mention it; the runtime supports it. This is the only configuration
//                  that guarantees a paid call is issued at most once per step execution.
//
//   NonRetryableError → did NOT stop retries (ran 6 times against limit: 5).
//                  So it is NOT load-bearing here and must not be treated as a guard. Diagnosis in
//                  progress — the leading hypothesis is that passing a custom `name` (which this file
//                  used to do) defeats the runtime's detection. Until that is settled, the retry config
//                  and the durable marker do the work and NonRetryableError is only a label.
/** PAID steps: exactly one execution. Measured, not inferred. Never raise this. */
export const PAID_RETRY = { retries: { limit: 0, delay: 0 }, timeout: "10 minutes" };
/** Bookkeeping steps touch only our own storage, so retrying them is safe and desirable.
 *  NB with 1+N semantics this is four executions, which is fine for an idempotent ledger write. */
export const CHEAP_RETRY = { retries: { limit: 3, delay: "2 seconds", backoff: "linear" }, timeout: "1 minute" };

/**
 * Records that a paid call is ABOUT to happen, and reports whether one already did.
 *
 * The honest limitation: Anthropic has no "was this request already charged?" endpoint, so unlike the
 * payment-processor example in Cloudflare's docs we cannot ask the provider. The best available
 * substitute is a marker written immediately before the call. On a restart:
 *
 *   marker absent   → the call certainly has not been made. Proceed.
 *   marker present  → a call was started. It may or may not have been billed. REFUSE rather than
 *                     re-issue, and fail the instance so a human sees it.
 *
 * That trades a rare lost generation for never double-charging, which is the right direction: a lost
 * generation costs one retry, a double charge costs money and trust.
 */
export async function claimAttempt(deps, jobId, stepName) {
  const key = `attempt:${jobId}:${stepName}`;
  const prior = await deps.kvGet(key);
  if (prior) return { alreadyAttempted: true, prior };
  await deps.kvPut(key, JSON.stringify({ at: deps.now() }), MARKER_TTL_SECONDS);
  return { alreadyAttempted: false, prior: null };
}

export async function releaseAttempt(deps, jobId, stepName) {
  await deps.kvDelete(`attempt:${jobId}:${stepName}`);
}

/**
 * One paid model call, at most once.
 *
 * `deps.NonRetryableError` is injected so this module needs no Cloudflare import.
 *
 * ── A HOLE THE PROBE MADE ME FIND (2026-07-30) ──────────────────────────────────────────────────────
 * The previous version released the attempt marker immediately after a successful call and returned.
 * But the engine persists a step's result AFTER the callback returns — and the docs are explicit that a
 * step "may have to restart, and it will start over from the beginning". So: call succeeds, marker
 * released, engine restarts before persisting, next execution sees no marker, and buys a second draft.
 *
 * A marker alone cannot fix that, because the safe state after a successful call is not "no attempt" —
 * it is "attempt made, and here is what it produced". So the result is CACHED, and the cache is checked
 * first. This is the same shape as the check-before-charge pattern in Cloudflare's own docs, with our
 * own storage standing in for a provider "was this charged?" endpoint that Anthropic does not offer.
 *
 * Write order is load-bearing:
 *   cache written BEFORE the marker is cleared  → a crash between them re-enters on the cache (correct)
 *   marker still set with no cache              → a call was issued and we cannot know if it billed, so
 *                                                 REFUSE rather than re-issue
 *
 * NonRetryableError is thrown for signalling only. The probe showed it did not stop retries, so it is
 * not relied upon; `PAID_RETRY.limit = 0` and this cache are what actually hold.
 */
export async function paidModelStep(deps, { jobId, stepName, call }) {
  const cacheKey = `result:${jobId}:${stepName}`;

  // 1 · Did a previous execution already complete this paid call? Then reuse it. No second charge.
  const cached = await deps.kvGet(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) { /* corrupt cache: fall through to the marker check */ }
  }

  // 2 · Did a previous execution ISSUE a call we have no result for? We cannot know whether it billed.
  const { alreadyAttempted } = await claimAttempt(deps, jobId, stepName);
  if (alreadyAttempted) {
    throw new deps.NonRetryableError(
      `${stepName}: a previous attempt already called the model for job ${jobId} and no result was ` +
      "stored, so it may already have been billed. Refusing to re-issue. The reservation is refunded.",
    );
  }

  let out;
  try {
    out = await call();
  } catch (err) {
    // Clear the marker ONLY when we know the call cannot have been billed — i.e. the provider answered
    // with a status. A network error or timeout may have been billed after the response was generated,
    // so the marker stays and a later execution refuses. Fail closed on ambiguity.
    if (definitelyNotBilled(err)) await releaseAttempt(deps, jobId, stepName);
    throw isTransient(err) ? err : new deps.NonRetryableError(String((err && err.message) || err));
  }

  // 3 · Cache BEFORE releasing, so no window exists where neither is set.
  try { await deps.kvPut(cacheKey, JSON.stringify(out), MARKER_TTL_SECONDS); } catch (_) {}
  await releaseAttempt(deps, jobId, stepName);
  return out;
}

/**
 * True only when the provider demonstrably answered without producing billable output.
 *
 * An HTTP status means a response came back. A network failure means we do not know what happened at the
 * other end, and "do not know" must be treated as "may have been billed".
 */
export function definitelyNotBilled(err) {
  const s = String((err && err.message) || err || "");
  return /\b(4\d\d|5\d\d)\b/.test(s) && !/timeout|timed out|aborted/i.test(s);
}

export function isTransient(err) {
  const s = String((err && err.message) || err || "");
  if (/\b(429|500|502|503|504|529)\b/.test(s)) return true;
  return /overloaded|timeout|timed out|network|ECONNRESET|fetch failed/i.test(s);
}

/**
 * The whole generation, expressed as durable steps.
 *
 * `step` is Cloudflare's WorkflowStep (or a stub). `deps` carries every side effect, so this function is
 * pure with respect to the platform and can be executed in a test.
 */
export async function runGenerationWorkflow({ step, payload, deps }) {
  const { jobId } = payload;
  // ── THE REQUEST BODY NEVER CROSSES A STEP BOUNDARY ───────────────────────────────────────────────
  // Two separate 1 MiB ceilings apply here: the Workflow event payload, and any single step's return
  // value. Chalk Talk accepts up to 5 MB (MAX_REQUEST_BYTES) because a talk can carry an uploaded
  // reference document. So the body is written to KV at submit and the payload carries only ids —
  // `deps.callDraft`/`callCritique` load it from inside the step that uses it. Passing the body through
  // the payload would have worked in testing and failed on exactly the large uploads it exists for.

  // ── 1 · DRAFT ──────────────────────────────────────────────────────────────
  // Deterministic name. Cached on success, so a later failure never re-buys it.
  const draft = await step.do("draft", PAID_RETRY, async () => {
    await deps.updateJob(jobId, { status: "running", stage: "drafting" });
    const d = await paidModelStep(deps, {
      jobId, stepName: "draft",
      call: () => deps.callDraft(jobId),
    });
    if (!d || !d.text || !String(d.text).trim()) {
      // An empty draft is a permanent failure of this attempt, not something a retry fixes.
      throw new deps.NonRetryableError("The model returned an empty draft.");
    }
    return { text: d.text, modelUsed: d.modelUsed, usage: d.usage || {}, webSearched: !!d.webSearched };
  });

  // ── 2 · CRITIQUE ───────────────────────────────────────────────────────────
  // Optional. Separate step so a critique failure never re-runs the draft — the entire reason this is
  // a Workflow rather than one long promise.
  let critique = { text: "", modelUsed: "", usage: null };
  if (payload.wantCritique) {
    critique = await step.do("critique", PAID_RETRY, async () => {
      await deps.updateJob(jobId, { stage: "critique" });
      const c = await paidModelStep(deps, {
        jobId, stepName: "critique",
        call: () => deps.callCritique(jobId, draft.text),
      });
      return { text: (c && c.text) || "", modelUsed: (c && c.modelUsed) || "", usage: (c && c.usage) || null };
    });
  }

  // ── 3 · METER ──────────────────────────────────────────────────────────────
  // Its own step, and idempotent at the ledger via a per-job key: a retry here must not bill twice, and
  // unlike the model calls this one we CAN make safely repeatable.
  await step.do("meter", CHEAP_RETRY, async () => {
    await deps.meterSpend({
      jobId,
      draftModel: draft.modelUsed, draftUsage: draft.usage,
      critModel: critique.modelUsed, critUsage: critique.usage,
    });
    return { metered: true };
  });

  // ── 4 · FINALIZE ───────────────────────────────────────────────────────────
  // Last, so a crash before it leaves the job resumable rather than falsely complete.
  await step.do("finalize", CHEAP_RETRY, async () => {
    await deps.updateJob(jobId, {
      status: "done",
      result: {
        draftText: draft.text,
        critText: critique.text,
        modelUsed: draft.modelUsed,
        critModelUsed: critique.modelUsed,
        webSearched: draft.webSearched,
      },
    });
    return { finalized: true };
  });

  return { ok: true, jobId };
}

/**
 * Refund exactly once, whatever calls it.
 *
 * Cancellation and failure can both land here, and terminate() can race a step, so this is written to be
 * called more than once. The claim is a KV compare-and-set-ish marker: whoever writes it first refunds.
 * KV is eventually consistent so this is best-effort, not a lock — but it turns "refund every time we
 * notice" into "refund approximately once", which is the difference that matters for a credit.
 */
export async function refundOnce(deps, jobId, reason) {
  const key = `refunded:${jobId}`;
  const already = await deps.kvGet(key);
  if (already) return { refunded: false, why: "already refunded" };
  await deps.kvPut(key, JSON.stringify({ at: deps.now(), reason }), MARKER_TTL_SECONDS);
  try {
    await deps.refund();
    return { refunded: true, reason };
  } catch (err) {
    // Leave the marker: a failed refund that we then retry forever is worse than one we surface.
    return { refunded: false, why: String(err && err.message || err) };
  }
}
