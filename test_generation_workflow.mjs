// DURABLE GENERATION WORKFLOW — run: node test_generation_workflow.mjs
//
// Executes the real step logic from generation_workflow.js under Node, with a WorkflowStep stub that
// models the behaviours that actually bite:
//
//   * completed steps are CACHED by name and not re-executed on a later failure;
//   * a failing step is RETRIED according to the config it was given;
//   * NonRetryableError stops retries immediately.
//
// The reason the logic lives in a platform-free module is precisely so this can run at all. A workflow
// that can only be exercised by deploying is a workflow whose correctness is an assertion.
//
// THE RISK THIS SUITE EXISTS FOR: step.do() retries FIVE times by default with exponential backoff
// (Cloudflare's documented default when no config is passed). Wrapping a paid Anthropic call in a naive
// step.do would bill up to five drafts for one talk. Everything below is ultimately about that.
import { readFileSync } from "fs";
import {
  runGenerationWorkflow, paidModelStep, refundOnce, isTransient, PAID_RETRY, CHEAP_RETRY,
} from "./generation_workflow.js";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

class FakeNonRetryable extends Error {
  constructor(msg, name) { super(msg); this.name = name || "NonRetryableError"; this.__nonRetryable = true; }
}

// ── a WorkflowStep stub with the semantics that matter ───────────────────────
function makeStep() {
  const cache = new Map();           // step name -> result (the documented replay behaviour)
  const attempts = [];               // every invocation, for assertions
  const configs = new Map();         // name -> the config it was given
  const step = {
    async do(name, configOrFn, maybeFn) {
      const config = typeof configOrFn === "function" ? undefined : configOrFn;
      const fn = typeof configOrFn === "function" ? configOrFn : maybeFn;
      configs.set(name, config);
      if (cache.has(name)) return cache.get(name);          // cached: never re-executes
      const limit = (config && config.retries && config.retries.limit) || 1;
      let lastErr;
      for (let i = 0; i < Math.max(1, limit); i++) {
        attempts.push(name);
        try {
          const out = await fn();
          cache.set(name, out);
          return out;
        } catch (err) {
          lastErr = err;
          if (err && err.__nonRetryable) throw err;          // NonRetryableError halts retries
        }
      }
      throw lastErr;
    },
    async sleep() {},
  };
  return { step, attempts, configs, cache };
}

// ── a deps stub: in-memory KV plus counted model calls ───────────────────────
function makeDeps(overrides = {}) {
  const kv = new Map();
  const calls = { draft: 0, critique: 0, meter: 0, refund: 0 };
  const jobs = new Map();
  return {
    calls, kv, jobs,
    NonRetryableError: FakeNonRetryable,
    now: () => "2026-07-29T00:00:00.000Z",
    kvGet: async (k) => kv.get(k) ?? null,
    kvPut: async (k, v) => { kv.set(k, v); },
    kvDelete: async (k) => { kv.delete(k); },
    updateJob: async (jobId, patch) => { jobs.set(jobId, Object.assign({}, jobs.get(jobId) || {}, patch)); return true; },
    callDraft: async () => { calls.draft++; return { text: "DRAFT", modelUsed: "claude-opus-5", usage: {} }; },
    callCritique: async () => { calls.critique++; return { text: "CRIT", modelUsed: "claude-opus-5", usage: {} }; },
    meterSpend: async () => { calls.meter++; },
    refund: async () => { calls.refund++; },
    ...overrides,
  };
}

const PAYLOAD = { jobId: "j1", userEmail: "a@b.c", wantCritique: true };

// ── 1 · the happy path, and the shape of it ──────────────────────────────────
{
  const { step, attempts, configs } = makeStep();
  const deps = makeDeps();
  const out = await runGenerationWorkflow({ step, payload: PAYLOAD, deps });
  ok(out.ok === true, "the workflow completes");
  ok(deps.calls.draft === 1 && deps.calls.critique === 1, "the model is called exactly once per phase");
  ok(deps.jobs.get("j1").status === "done", "the job record ends `done`");
  ok(deps.jobs.get("j1").result.draftText === "DRAFT", "…carrying the draft");

  // Separate steps are the whole point: a critique failure must not re-buy the draft.
  ok(attempts.filter(a => a === "draft").length === 1, "draft ran once");
  ok(["draft", "critique", "meter", "finalize"].every(n => configs.has(n)),
     "every phase is its own durable step, so each is separately resumable");
}

// ── 2 · NO PAID STEP MAY INHERIT THE 5x DEFAULT ──────────────────────────────
// The single most expensive mistake available here. Asserted on the config the step actually received.
{
  const { step, configs } = makeStep();
  await runGenerationWorkflow({ step, payload: PAYLOAD, deps: makeDeps() });
  for (const paid of ["draft", "critique"]) {
    const c = configs.get(paid);
    ok(!!c && !!c.retries, `${paid} passes an EXPLICIT retry config — never Cloudflare's 5x default`);
    ok(c.retries.limit <= 2, `…with limit ${c.retries.limit}, not 5`);
  }
  ok(PAID_RETRY.retries.limit <= 2, "PAID_RETRY is conservative by construction");
  ok(CHEAP_RETRY.retries.limit >= PAID_RETRY.retries.limit,
     "…while bookkeeping steps, which touch only our own storage, may retry more freely");
}

// ── 3 · A RETRY MUST NOT BUY A SECOND DRAFT ──────────────────────────────────
// The scenario: the provider call succeeds but the step dies before persisting. The engine retries. If
// nothing guarded it, the user is billed twice for one talk.
{
  const deps = makeDeps({
    callDraft: async function () {
      this.calls.draft++;
      throw new Error("network blip after the model already responded");
    },
  });
  deps.calls = { draft: 0, critique: 0, meter: 0, refund: 0 };
  let threw = null;
  try {
    await paidModelStep(deps, { jobId: "j2", stepName: "draft", call: () => deps.callDraft() });
  } catch (e) { threw = e; }
  ok(!!threw, "a transient failure propagates so the ONE configured retry can happen");

  // Now simulate the dangerous case: the marker survived because the call reached the provider.
  await deps.kvPut("attempt:j3:draft", JSON.stringify({ at: "x" }), 60);
  let second = null;
  try {
    await paidModelStep(deps, { jobId: "j3", stepName: "draft", call: async () => { deps.calls.draft++; return { text: "X" }; } });
  } catch (e) { second = e; }
  ok(second && second.__nonRetryable,
     "a re-entry that finds an existing attempt marker REFUSES rather than re-issuing a paid call");
  ok(second && second.name === "DuplicatePaidAttempt", "…and names the reason");
  ok(deps.calls.draft === 1, "…so the model was never called a second time for that job");
}

// ── 4 · permanent failures are not retried ───────────────────────────────────
// Retrying a 400 five times buys nothing and delays the user's refund.
{
  ok(isTransient(new Error("529 overloaded")), "529 is transient");
  ok(isTransient(new Error("fetch failed")), "a network error is transient");
  ok(!isTransient(new Error("400 invalid_request: bad model")), "a 400 is NOT transient");

  const deps = makeDeps({ callDraft: async () => { throw new Error("400 invalid_request"); } });
  let e = null;
  try { await paidModelStep(deps, { jobId: "j4", stepName: "draft", call: () => deps.callDraft() }); }
  catch (err) { e = err; }
  ok(e && e.__nonRetryable, "a permanent model failure raises NonRetryableError");
  ok(e && e.name === "PermanentModelFailure", "…named so the instance status explains itself");
  ok((await deps.kvGet("attempt:j4:draft")) === null,
     "…and the attempt marker is released, since no paid call ever completed");
}

// ── 5 · the draft survives a critique failure ────────────────────────────────
// This is the entire argument for Workflows over one long promise: partial progress is durable.
{
  const { step, attempts } = makeStep();
  const deps = makeDeps({ callCritique: async () => { throw new FakeNonRetryable("critique exploded"); } });
  let err = null;
  try { await runGenerationWorkflow({ step, payload: PAYLOAD, deps }); } catch (e) { err = e; }
  ok(!!err, "a critique failure fails the instance");
  ok(deps.calls.draft === 1, "…but the draft was bought exactly once");
  ok(attempts.filter(a => a === "draft").length === 1, "…and never re-executed");
}

// ── 6 · metering is idempotent and finalization is last ──────────────────────
{
  const { step } = makeStep();
  const deps = makeDeps();
  await runGenerationWorkflow({ step, payload: PAYLOAD, deps });
  ok(deps.calls.meter === 1, "spend is metered once");
  // Re-running the same workflow object replays from cache: no second charge, no second ledger write.
  await runGenerationWorkflow({ step, payload: PAYLOAD, deps });
  ok(deps.calls.draft === 1 && deps.calls.meter === 1,
     "replaying a completed workflow re-buys nothing — cached steps are not re-executed");
}

// ── 7 · refund exactly once, however many callers notice ─────────────────────
// Cancel and failure can both land here, and terminate() can race a step.
{
  const deps = makeDeps();
  const a = await refundOnce(deps, "j9", "cancelled");
  const b = await refundOnce(deps, "j9", "failed");
  ok(a.refunded === true, "the first caller refunds");
  ok(b.refunded === false, "…the second does not");
  ok(deps.calls.refund === 1, "…so the credit is returned exactly once");
}

// ── 8 · no critique requested → no critique bought ───────────────────────────
{
  const { step } = makeStep();
  const deps = makeDeps();
  await runGenerationWorkflow({ step, payload: { ...PAYLOAD, wantCritique: false }, deps });
  ok(deps.calls.critique === 0, "a talk without a review never calls the critic");
  ok(deps.jobs.get("j1").status === "done", "…and still finishes");
}

// ── 9 · an empty draft is a permanent failure, not a retry loop ──────────────
{
  const { step } = makeStep();
  const deps = makeDeps({ callDraft: async () => ({ text: "   ", modelUsed: "m", usage: {} }) });
  let err = null;
  try { await runGenerationWorkflow({ step, payload: PAYLOAD, deps }); } catch (e) { err = e; }
  ok(err && err.__nonRetryable, "an empty draft raises NonRetryableError rather than retrying");
  ok(err && err.name === "EmptyDraft", "…named EmptyDraft");
}

// ── 10 · THE DESIGN MUST NOT DEPEND ON UNDOCUMENTED BEHAVIOUR ────────────────
// Codex flagged that `retries: { limit: 0 }` is not confirmed by the docs and must not be assumed. It
// is not used anywhere here — `limit: 1` plus NonRetryableError plus the attempt marker is the whole
// mechanism, and none of it depends on how Cloudflare interprets a zero. Asserted rather than trusted,
// because "we don't use that" is the kind of claim that quietly stops being true.
{
  const src = readFileSync(new URL("./generation_workflow.js", import.meta.url), "utf8")
    .split("\n").map(l => l.replace(/^\s*(\/\/|\*).*$/, "")).join("\n");
  ok(!/limit:\s*0/.test(src), "no step is configured with the undocumented `limit: 0`");
  ok(/limit:\s*1/.test(src), "…paid steps use limit: 1, which the type signature plainly supports");
  ok(/NonRetryableError/.test(src), "…and NonRetryableError, the documented way to stop retries");
  // The attempt marker is what actually protects the user, independent of retry semantics.
  ok(/claimAttempt/.test(src) && /DuplicatePaidAttempt/.test(src),
     "…while the attempt marker holds even if `limit` means something other than we think");
}

console.log("\n" + (failures === 0 ? "✔ GENERATION WORKFLOW TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
