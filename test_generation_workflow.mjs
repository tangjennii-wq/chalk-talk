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
  runGenerationWorkflow, paidModelStep, refundOnce, isTransient, definitelyNotBilled,
  PAID_RETRY, CHEAP_RETRY,
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
      // MEASURED SEMANTICS, not the documented ones (runtime probe, 2026-07-30):
      //   limit: N  => 1 + N executions   (limit: 3 ran FOUR times)
      //   limit: 0  => exactly 1          (accepted by the runtime; undocumented)
      //   NonRetryableError does NOT halt retries — it ran 6 times against limit: 5.
      // The stub models what the platform DOES. Modelling the documented behaviour would have let a
      // double-charge pass here and fail in production, which is the whole reason the probe exists.
      const limit = (config && config.retries && typeof config.retries.limit === "number")
        ? config.retries.limit : 5;
      const executions = 1 + limit;
      let lastErr;
      for (let i = 0; i < executions; i++) {
        attempts.push(name);
        try {
          const out = await fn();
          cache.set(name, out);
          return out;
        } catch (err) {
          lastErr = err;
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
    // limit MUST be 0. The probe measured limit:N as 1+N executions, so limit:1 would permit TWO paid
    // calls — which is what this file previously allowed while claiming to be conservative.
    ok(c.retries.limit === 0,
       `…with limit EXACTLY 0 (got ${c.retries.limit}) — 1+N semantics make anything higher a second charge`);
  }
  ok(PAID_RETRY.retries.limit === 0, "PAID_RETRY.limit is 0 — measured to execute exactly once");
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
  // NO CUSTOM NAME is passed any more: the probe's leading hypothesis for why NonRetryableError failed
  // to stop retries is that a custom `name` defeats the runtime's detection. The message carries the
  // explanation instead.
  ok(second && /may already have been billed/.test(second.message),
     "…and the MESSAGE explains why, since a custom name may defeat NonRetryableError entirely");
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
  ok(e && /400/.test(e.message), "…carrying the upstream message, without a custom error name");
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
  ok(err && /empty draft/i.test(err.message), "…saying so in the message rather than a custom name");
}

// ── 10 · THE MEASURED FACTS ARE PINNED IN THE SOURCE ─────────────────────────
// Inverted 2026-07-30. This section previously asserted that `limit: 0` was NOT used, because the docs
// never mention it and Codex rightly said not to build on an unverified assumption. The runtime probe
// then measured it: `limit: 0` is accepted and executes exactly once, while `limit: 3` executes FOUR
// times. So the safe configuration is the one the docs do not describe, and the one they imply is safe
// (`limit: 1`) permits two paid calls. Assumption replaced with measurement.
{
  const src = readFileSync(new URL("./generation_workflow.js", import.meta.url), "utf8")
    .split("\n").map(l => l.replace(/^\s*(\/\/|\*).*$/, "")).join("\n");
  ok(/limit:\s*0/.test(src), "paid steps use limit: 0 — measured to execute exactly once");
  ok(!/limit:\s*1\b/.test(src.slice(src.indexOf("PAID_RETRY"), src.indexOf("CHEAP_RETRY"))),
     "…and PAID_RETRY never uses limit: 1, which 1+N semantics make a two-call config");

  // NonRetryableError is no longer load-bearing, and must not silently become so again.
  ok(!/NonRetryableError\([^)]*,\s*["']/.test(src),
     "no NonRetryableError is thrown with a custom name — the suspected cause of it not stopping retries");

  // The result cache is what actually makes a restart safe.
  ok(/result:\$\{jobId\}:\$\{stepName\}/.test(src), "a durable RESULT CACHE keyed by job and step exists");
  ok(src.indexOf("kvPut(cacheKey") < src.indexOf("releaseAttempt(deps, jobId, stepName);\n  return out;"),
     "…and it is written BEFORE the marker is released, leaving no window where neither is set");
}

// ── 11 · AN ENGINE RESTART MUST NOT RE-BUY A COMPLETED CALL ──────────────────
// The hole the probe made me find. A step's result is persisted AFTER the callback returns, and the docs
// say a step may restart and "start over from the beginning". The old code released the attempt marker
// immediately on success, so a restart in that window saw no marker and bought a second draft. No retry
// setting prevents this — a restart is not a retry.
{
  const deps = makeDeps();
  const first = await paidModelStep(deps, { jobId: "jr", stepName: "draft", call: () => deps.callDraft() });
  ok(deps.calls.draft === 1 && first.text === "DRAFT", "the first execution calls the model once");

  // Simulate the restart: same job, same step, fresh execution of the same callback.
  const second = await paidModelStep(deps, { jobId: "jr", stepName: "draft", call: () => deps.callDraft() });
  ok(deps.calls.draft === 1, "a RESTART re-enters on the cached result — the model is NOT called again");
  ok(second.text === "DRAFT", "…and returns the same draft, so the talk is not lost either");

  // A different step of the same job is unaffected.
  await paidModelStep(deps, { jobId: "jr", stepName: "critique", call: () => deps.callCritique() });
  ok(deps.calls.critique === 1, "…while a different step of the same job still runs");
}

// ── 12 · AMBIGUITY FAILS CLOSED ──────────────────────────────────────────────
// A provider that answered with a status cannot have billed for a completion. A network error or
// timeout might have. "Don't know" must be treated as "may have been billed".
{
  ok(definitelyNotBilled(new Error("429 rate_limit")), "an HTTP status means the provider answered");
  ok(definitelyNotBilled(new Error("400 invalid_request")), "…4xx too");
  ok(!definitelyNotBilled(new Error("fetch failed")), "a network error is NOT known-unbilled");
  ok(!definitelyNotBilled(new Error("504 timeout")), "…nor is a timeout, even with a status in the text");

  // A network failure leaves the marker set, so a later execution refuses rather than re-issuing.
  const deps = makeDeps({ callDraft: async () => { throw new Error("fetch failed"); } });
  try { await paidModelStep(deps, { jobId: "jn", stepName: "draft", call: () => deps.callDraft() }); } catch (_) {}
  ok((await deps.kvGet("attempt:jn:draft")) !== null,
     "after a NETWORK failure the attempt marker REMAINS — we cannot prove it was not billed");

  // A 4xx clears it, because we know no completion was produced.
  const d2 = makeDeps({ callDraft: async () => { throw new Error("400 bad_request"); } });
  try { await paidModelStep(d2, { jobId: "j4x", stepName: "draft", call: () => d2.callDraft() }); } catch (_) {}
  ok((await d2.kvGet("attempt:j4x:draft")) === null,
     "…while a 4xx releases it, since the provider answered without billing");
}

console.log("\n" + (failures === 0 ? "✔ GENERATION WORKFLOW TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
