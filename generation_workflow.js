// DURABLE GENERATION — the step logic, deliberately free of Cloudflare imports.
//
// WHY THIS FILE HAS NO `cloudflare:workers` IMPORT. The WorkflowEntrypoint subclass lives in
// worker_entry.js; everything that can be wrong lives here, where Node can execute it. A workflow whose
// logic can only run on Cloudflare is a workflow whose logic is only tested by deploying, and this
// project has spent a day learning what untested-but-asserted looks like.
//
// ── THE ONE THING THAT COULD COST REAL MONEY ─────────────────────────────────────────────────────────
// `step.do()` RETRIES BY DEFAULT. From Cloudflare's own docs, the default when no config is supplied:
//
//     retries: { limit: 5, delay: 10000, backoff: "exponential" }, timeout: "10 minutes"
//
// So a naive `step.do("draft", () => callAnthropic(...))` can call — and be billed for — a draft up to
// five times. Every paid step here therefore:
//
//   1. passes an EXPLICIT retry config rather than inheriting the default;
//   2. does a pre-flight check inside the same step, which the docs explicitly sanction ("unless you
//      need multiple calls to prove idempotency"), so a retry after a committed-but-unpersisted call
//      returns the earlier result instead of buying a second one;
//   3. throws NonRetryableError on anything that is not plainly transient.
//
// The docs do NOT specify whether `limit: N` means N attempts or 1 + N retries — the prose and the code
// comment on the same page disagree — and they never document `limit: 0`. So the retry count is treated
// as untrustworthy and the idempotency guard is what actually protects the user. (Verified against
// developers.cloudflare.com/workflows, 2026-07-29.)
//
// ── OTHER RULES THIS FILE OBEYS ──────────────────────────────────────────────────────────────────────
// * Step names are deterministic string literals — the name is the cache key, so a name built from a
//   timestamp or a counter would silently defeat replay and re-run a paid call.
// * No side effects outside a step. The engine may restart and re-run anything at the top level.
// * No reliance on in-memory state between steps; everything meaningful is a step return value.
// * `event.payload` is treated as immutable.

// Attempt markers are written BEFORE a paid call and cleared after it succeeds. If a step restarts and
// finds a marker with no result, the provider may already have been billed — see claimAttempt().
const MARKER_TTL_SECONDS = 3600;

/** Conservative retry policy for PAID steps. Explicit, never the 5x default. */
export const PAID_RETRY = { retries: { limit: 1, delay: "5 seconds", backoff: "constant" }, timeout: "10 minutes" };
/** Bookkeeping steps are cheap and safe to retry — they touch our own storage only. */
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
 * One paid model call, guarded.
 *
 * `deps.NonRetryableError` is injected so this module needs no Cloudflare import; worker_entry.js passes
 * the real class and the tests pass a stand-in.
 */
export async function paidModelStep(deps, { jobId, stepName, call }) {
  const { alreadyAttempted } = await claimAttempt(deps, jobId, stepName);
  if (alreadyAttempted) {
    // A previous attempt reached the provider and we have no result to show for it. Re-issuing would
    // risk a second charge for the same talk, so stop and surface it instead of quietly spending again.
    throw new deps.NonRetryableError(
      `${stepName}: a previous attempt already called the model for job ${jobId}; refusing to re-issue a ` +
      "paid request. The reservation will be refunded.",
      "DuplicatePaidAttempt",
    );
  }
  let out;
  try {
    out = await call();
  } catch (err) {
    // A transient upstream failure is worth the single configured retry; anything else is not. Retrying
    // a 400 five times buys nothing and delays the refund.
    if (!isTransient(err)) {
      await releaseAttempt(deps, jobId, stepName);   // never called successfully — safe to allow a retry later
      throw new deps.NonRetryableError(String(err && err.message || err), "PermanentModelFailure");
    }
    // Transient: clear the marker so the ONE configured retry is allowed to proceed.
    await releaseAttempt(deps, jobId, stepName);
    throw err;
  }
  await releaseAttempt(deps, jobId, stepName);
  return out;
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
      throw new deps.NonRetryableError("The model returned an empty draft.", "EmptyDraft");
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
