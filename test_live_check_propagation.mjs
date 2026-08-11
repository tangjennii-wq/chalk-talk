// LIVE-CHECK PROVENANCE, END TO END — run: node test_live_check_propagation.mjs
//
// test_live_check.mjs asserts that the CLIENT reads critResult.webSearched and stamps the talk. It does
// that by pattern-matching index.html, and it passed for the entire period during which the free tier
// could not possibly report a live check:
//
//   * the Workflow's critique step returned {text, modelUsed, usage} and dropped webSearched, which
//     callAnthropicText had already computed;
//   * finalize then reported draft.webSearched — and callDraft passes tools:null BY DESIGN (920773e),
//     so that value is structurally false forever;
//   * the legacy waitUntil critique was called with five arguments and never received the tools at all.
//
// Net effect: the review searched, and every result said it hadn't. The verification step in the handoff
// ("should record _webSearched: true") would have read false and been blamed on the tools not arriving.
//
// So this suite EXECUTES the workflow and asserts on the record it actually writes. A regex over the
// client cannot see any of the above, which is exactly why it missed it.
import { readFileSync } from "fs";
import { runGenerationWorkflow } from "./generation_workflow.js";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

class FakeNonRetryable extends Error {
  constructor(msg){ super(msg); this.name = "NonRetryableError"; this.__nonRetryable = true; }
}

function makeStep(){
  const cache = new Map();
  return { async do(name, configOrFn, maybeFn){
    const fn = typeof configOrFn === "function" ? configOrFn : maybeFn;
    if(cache.has(name)) return cache.get(name);
    const out = await fn(); cache.set(name, out); return out;
  }, async sleep(){} };
}

// Runs a full workflow and hands back the result record finalize wrote.
async function resultFor({ draftSearched, critSearched }){
  const jobs = new Map();
  const deps = {
    NonRetryableError: FakeNonRetryable,
    now: () => "2026-08-10T00:00:00.000Z",
    kvGet: async () => null, kvPut: async () => {}, kvDelete: async () => {},
    updateJob: async (jobId, patch) => { jobs.set(jobId, Object.assign({}, jobs.get(jobId)||{}, patch)); return true; },
    callDraft:    async () => ({ text:"DRAFT", modelUsed:"claude-opus-5", usage:{}, webSearched: draftSearched }),
    callCritique: async () => ({ text:"CRIT",  modelUsed:"claude-opus-5", usage:{}, webSearched: critSearched }),
    meterSpend: async () => {},
    refund: async () => ({ refunded:true, outcome:"refunded" }),
  };
  await runGenerationWorkflow({ step: makeStep(), payload: { jobId:"j1", userEmail:"a@b.c", wantCritique:true }, deps });
  return jobs.get("j1").result;
}

// ── the defect, stated as a test ────────────────────────────────────────────────────────────────────
const searchedInReview = await resultFor({ draftSearched:false, critSearched:true });
ok(searchedInReview.webSearched === true,
   "a critique that really searched is reported as searched — THE regression (draft never searches by design)");

const noSearch = await resultFor({ draftSearched:false, critSearched:false });
ok(noSearch.webSearched === false,
   "no search anywhere stays false — the flag still means a real web_search event, not an intention");

const searchedInDraft = await resultFor({ draftSearched:true, critSearched:false });
ok(searchedInDraft.webSearched === true,
   "a searching draft is still reported, if a future path ever forwards draft tools again");

ok(searchedInReview.critText === "CRIT" && searchedInReview.draftText === "DRAFT",
   "the rest of the result record is unchanged");

// ── the same value, one step earlier ────────────────────────────────────────────────────────────────
// Asserted separately so a failure says WHICH of the two links broke: the step that returns it, or the
// finalize that reads it.
{
  const jobs = new Map();
  let critiqueStepOut = null;
  const step = makeStep();
  const wrapped = { ...step, async do(name, c, f){ const out = await step.do(name, c, f); if(name==="critique") critiqueStepOut = out; return out; } };
  await runGenerationWorkflow({
    step: wrapped,
    payload: { jobId:"j2", userEmail:"a@b.c", wantCritique:true },
    deps: {
      NonRetryableError: FakeNonRetryable, now: () => "2026-08-10T00:00:00.000Z",
      kvGet: async () => null, kvPut: async () => {}, kvDelete: async () => {},
      updateJob: async (id,p) => { jobs.set(id, Object.assign({}, jobs.get(id)||{}, p)); return true; },
      callDraft: async () => ({ text:"D", modelUsed:"m", usage:{}, webSearched:false }),
      callCritique: async () => ({ text:"C", modelUsed:"m", usage:{}, webSearched:true }),
      meterSpend: async () => {}, refund: async () => ({ refunded:true }),
    },
  });
  ok(critiqueStepOut && critiqueStepOut.webSearched === true,
     "the critique STEP carries webSearched out — it is not dropped at the step boundary");
}

// ── the two source-level halves this suite cannot execute ───────────────────────────────────────────
const worker = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const html   = readFileSync(new URL("./index.html", import.meta.url), "utf8");

ok(/crit = await callAnthropicText\(env, body\.critique\.sys,[^;]*body\.critique\.tools \|\| null\);/.test(worker),
   "the legacy waitUntil critique is passed the submitted tools (it took five arguments and got none)");
ok(/return callAnthropicText\(env, p\.draft\.sys, p\.draft\.content, p\.draft\.maxTok \|\| 16384, p\.draft\.models, null\);/.test(worker),
   "callDraft still forwards NULL tools — search stays out of the first-token path (920773e)");

// The hourglass lived only in the synchronous branch, so the durable path — the only one the free tier
// takes — never showed it. Both durable stage handlers must set it, from the SAME predicate the submit
// uses to decide whether to send tools, so the two cannot drift.
const durableHourglass = (html.match(/S\.reviewLiveChecking = \(stage === "critique"\) && topicNeedsLiveCheck\(S\.topic\);/g) || []).length;
ok(durableHourglass === 2,
   `both durable stage handlers raise the hourglass from the submit's own predicate (found ${durableHourglass}/2)`);
ok((html.match(/S\.loading = false; S\.reviewLiveChecking = false;/g) || []).length === 2,
   "…and every place generation stops clears it, so a stale true cannot leak into the next run");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ LIVE CHECK PROVENANCE OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
