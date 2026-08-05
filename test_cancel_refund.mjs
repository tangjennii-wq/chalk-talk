// CANCELLATION AND REFUND — run: node test_cancel_refund.mjs
//
// ── FOUR SERVER-SIDE FAILURES, ALL CONFIRMED IN THE CODE BEFORE THIS WAS WRITTEN (Codex, 2026-07-31) ─
//
// 1. THE DURABLE WORKFLOW NEVER REFUNDED. `refundOnce()` was exported from generation_workflow.js and
//    called by nothing, and makeWorkflowDeps() supplied no `deps.refund` — so the call inside it would
//    have thrown had anything reached it. The legacy waitUntil runner has its own local refundOnce and
//    DOES refund, which is exactly why this survived review: the helper existed, tests referenced it,
//    and the path that actually runs in production was the one without it.
//
// 2. CANCELLATION SWALLOWED TERMINATION FAILURE. `get()` and `terminate()` shared one catch that
//    ignored every error, so a real termination outage was indistinguishable from "unknown instance" —
//    and the handler then wrote cancelled:true regardless.
//
// 3. THE WORKFLOW IGNORED CANCELLATION BETWEEN PAID STEPS. deps.updateJob() returns false on a
//    cancelled job; both draft and critique discarded the return value. If termination failed, the
//    Workflow walked into a second paid call on a job the user had already stopped.
//
// 4. CANCELLING A COMPLETED JOB WAS MISREPORTED. terminate() throws when the instance is complete, the
//    shared catch swallowed it, the record was marked cancelled:true while keeping status:"done", and
//    the endpoint reported success — so a user who cancelled a moment too late was told the talk was
//    cancelled while the finished talk sat in the record.
//
// The six scenarios below are Codex's, executed rather than asserted about.
import worker from "./worker.js";
import { runGenerationWorkflow, refundOnce, isCancellation } from "./generation_workflow.js";
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

// ── A WORKFLOW HARNESS THAT COUNTS MONEY ─────────────────────────────────────
function wfHarness({ cancelAt = null, failAt = null } = {}) {
  const calls = { draft: 0, critique: 0, refunds: [], updates: [] };
  const job = { status: "queued", cancelled: false };
  const deps = {
    NonRetryableError: class NonRetryableError extends Error {},
    now: () => new Date().toISOString(),
    updateJob: async (jobId, patch) => {
      calls.updates.push(patch);
      if (job.cancelled) return false;                 // the signal both paid steps used to ignore
      Object.assign(job, patch);
      return true;
    },
    refund: async (jobId, reason) => {
      // Stands in for refund_talk_once: job-keyed and exactly-once.
      if (calls.refunds.length) return { refunded: false, outcome: "already_refunded" };
      calls.refunds.push({ jobId, reason });
      return { refunded: true, outcome: "refunded" };
    },
    callDraft: async () => {
      calls.draft++;
      if (failAt === "draft") throw new Error("model exploded");
      return { text: "draft text", modelUsed: "claude-opus-5", usage: {}, webSearched: false };
    },
    callCritique: async () => {
      calls.critique++;
      if (failAt === "critique") throw new Error("critic exploded");
      return { text: "crit", modelUsed: "claude-opus-5", usage: {} };
    },
    meterSpend: async () => {},
    kvGet: async () => null,
    kvPut: async () => {},
    kvDelete: async () => {},
  };
  // step.do runs the closure directly; cancelAt flips the flag before the named step.
  const step = { do: async (name, _opts, fn) => { if (cancelAt === name) job.cancelled = true; return fn(); } };
  return { deps, step, calls, job };
}

const run = async (h, wantCritique = true) => {
  try { return { ok: true, value: await runGenerationWorkflow({ step: h.step, deps: h.deps,
                                                                payload: { jobId: "j1", wantCritique } }) }; }
  catch (e) { return { ok: false, error: e }; }
};

// ── 1 · CANCEL BEFORE DRAFT → zero paid calls, one refund ────────────────────
{
  const h = wfHarness({ cancelAt: "draft" });
  const r = await run(h);
  ok(!r.ok, "a job cancelled before drafting does not complete");
  ok(h.calls.draft === 0, `…ZERO paid draft calls (got ${h.calls.draft})`);
  ok(h.calls.critique === 0, "…and no critique");
  ok(h.calls.refunds.length === 1, `…exactly one refund (got ${h.calls.refunds.length})`);
  ok(isCancellation(r.error), "…recorded as a cancellation, not a model failure");
}

// ── 2 · CANCEL BETWEEN DRAFT AND CRITIQUE → draft may bill, critique never ───
// The scenario the draft/critique split exists for, and the one where ignoring updateJob cost the most:
// the draft is already paid for, so proceeding doubles the loss.
{
  const h = wfHarness({ cancelAt: "critique" });
  const r = await run(h);
  ok(!r.ok, "a job cancelled after drafting does not complete");
  ok(h.calls.draft === 1, `…the draft was billed once (got ${h.calls.draft})`);
  ok(h.calls.critique === 0, `…and the CRITIQUE NEVER RUNS (got ${h.calls.critique})`);
  ok(h.calls.refunds.length === 1, "…exactly one refund");
}

// ── 3 · TERMINATION FAILURE → cancelled:false, no false refund claim ─────────
{
  const ORIGIN = "https://tangjennii-wq.github.io";
  const store = new Map([["job:j9", JSON.stringify({ userId: "u-1", status: "running" })]]);
  let refundCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const s = String(u);
    if (s.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "u-1", email: "j@t.dev" }),
      { status: 200, headers: { "Content-Type": "application/json" } });
    if (s.includes("/rpc/refund_talk_once")) { refundCalls++; return new Response(JSON.stringify([{ refunded: true, outcome: "refunded" }]),
      { status: 200, headers: { "Content-Type": "application/json" } }); }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const env = {
    ALLOWED_ORIGINS: ORIGIN, SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "k",
    JOBS_KV: { get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } },
    GEN_WORKFLOW: {
      get: async () => ({
        status: async () => ({ status: "running" }),
        terminate: async () => { throw new Error("Workflows API unavailable"); },
      }),
    },
  };
  const res = await worker.fetch(new Request("https://p.test/generate-cancel/j9",
    { method: "POST", headers: { Origin: ORIGIN, "X-Supabase-Auth": "t" } }), env, { waitUntil() {} });
  const body = await res.json();
  globalThis.fetch = realFetch;

  ok(res.status >= 400, `a termination failure is a non-2xx (got ${res.status})`);
  ok(body.error && body.error.detail && body.error.detail.cancelled === false,
     "…and reports cancelled:false rather than resolving uncertainty in our own favour");
  ok(refundCalls === 0, "…and issues NO refund for a job that may still be running");
  ok(/still be running|still be billed/i.test(JSON.stringify(body)),
     "…telling the user plainly that it may still be billed");
}

// ── 4 · CANCEL AFTER COMPLETION → result kept, no refund ─────────────────────
{
  const ORIGIN = "https://tangjennii-wq.github.io";
  const done = JSON.stringify({ userId: "u-1", status: "done", result: { draftText: "the talk" } });
  const store = new Map([["job:j8", done]]);
  let refundCalls = 0, terminateCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const s = String(u);
    if (s.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "u-1", email: "j@t.dev" }),
      { status: 200, headers: { "Content-Type": "application/json" } });
    if (s.includes("/rpc/refund_talk_once")) { refundCalls++; return new Response(JSON.stringify([{ refunded: true, outcome: "refunded" }]),
      { status: 200, headers: { "Content-Type": "application/json" } }); }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const env = {
    ALLOWED_ORIGINS: ORIGIN, SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "k",
    JOBS_KV: { get: async k => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } },
    GEN_WORKFLOW: { get: async () => ({ status: async () => ({ status: "complete" }),
                                        terminate: async () => { terminateCalls++; } }) },
  };
  const res = await worker.fetch(new Request("https://p.test/generate-cancel/j8",
    { method: "POST", headers: { Origin: ORIGIN, "X-Supabase-Auth": "t" } }), env, { waitUntil() {} });
  const body = await res.json();
  globalThis.fetch = realFetch;

  ok(body.cancelled === false, "a completed job is NOT reported as cancelled");
  ok(body.already_complete === true && body.result_available === true,
     "…it is reported as already_complete with the result available");
  ok(refundCalls === 0, "…and NO refund is issued for work the user received");
  ok(terminateCalls === 0, "…and terminate() is not called on a finished instance");
  const after = JSON.parse(store.get("job:j8"));
  ok(after.status === "done" && !after.cancelled,
     "…the record still says done, and was NOT stamped cancelled:true");
}

// ── 5 · TEN CONCURRENT CANCELS → exactly one refund ─────────────────────────
// The client can fire repeats, and a user can hold the button. The lock is a Postgres primary key —
// `insert ... on conflict (job_id) do nothing` — so N callers produce one credit. Verified against the
// live database as well: three sequential calls returned refunded / already_refunded / already_refunded.
{
  const ledger = new Set();
  const deps = {
    refund: async (jobId) => {
      if (ledger.has(jobId)) return { refunded: false, outcome: "already_refunded" };
      ledger.add(jobId);
      return { refunded: true, outcome: "refunded" };
    },
  };
  const results = await Promise.all(
    Array.from({ length: 10 }, () => refundOnce(deps, "same-job", "user_cancelled")));
  const credited = results.filter(r => r.refunded).length;
  ok(credited === 1, `ten concurrent cancels produce exactly ONE credit (got ${credited})`);
  ok(results.filter(r => !r.refunded).every(r => /already/.test(r.why)),
     "…and the other nine report already_refunded rather than an error");
}

// ── 6 · WORKFLOW TERMINAL FAILURE → exactly one refund ──────────────────────
{
  const h = wfHarness({ failAt: "draft" });
  const r = await run(h);
  ok(!r.ok, "a draft failure fails the workflow");
  ok(h.calls.refunds.length === 1, `…and refunds exactly once (got ${h.calls.refunds.length})`);
  ok(h.calls.refunds[0].reason === "workflow_failed", "…recorded as a failure, not a cancellation");

  const h2 = wfHarness({ failAt: "critique" });
  const r2 = await run(h2);
  ok(!r2.ok && h2.calls.refunds.length === 1, "a critique failure also refunds exactly once");
  ok(h2.calls.draft === 1, "…and the draft is not re-purchased");
}

// ── 7 · NO DEAD REFUND HELPER ────────────────────────────────────────────────
// The defect was a helper that looked wired and was not. If deps.refund goes missing again, say so
// loudly rather than reporting a refund that never happened.
{
  const r = await refundOnce({}, "j", "reason");
  ok(r.refunded === false && /not wired/.test(r.why),
     "an unwired deps.refund is reported explicitly, not swallowed as a declined refund");

  const wsrc = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const code = wsrc.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  ok(/refund:\s*async \(jobId, reason\) =>/.test(code), "makeWorkflowDeps now supplies deps.refund");
  ok(/refund_talk_once/.test(code), "…backed by the Postgres exactly-once RPC");
  ok(/refunded: refund\.refunded/.test(code) || /refunded: refund\.refunded,/.test(code),
     "the cancel endpoint reports cancellation and refund separately");
}

// ── 8 · A CANCELLED JOB STILL RECORDS ITS OUTCOME ────────────────────────────
// Found by self-audit AFTER the fixes above, which is the point of auditing your own patch.
// updateJob refuses every write once `cancelled` is set — correct for the paid steps, wrong for the
// handler that records the result. Measured before fixing: on a cancelled job ZERO status writes
// landed, so the refund happened in Postgres and the job record showed no trace of it. /generate-status
// could not report refund state for the one case that most needs it.
{
  const writes = [];
  const deps = {
    NonRetryableError: class extends Error {},
    now: () => "t",
    updateJob: async () => false,                                  // as if cancelled
    finalizeJob: async (id, patch) => { writes.push(patch); return true; },
    refund: async () => ({ refunded: true, outcome: "refunded" }),
    callDraft: async () => ({ text: "x", modelUsed: "m", usage: {} }),
    callCritique: async () => ({ text: "c", modelUsed: "m" }),
    meterSpend: async () => {},
  };
  const step = { do: async (_n, _o, fn) => fn() };
  try { await runGenerationWorkflow({ step, deps, payload: { jobId: "j1", wantCritique: true } }); } catch (_) {}

  ok(writes.length === 1, `the terminal outcome IS recorded on a cancelled job (${writes.length} write(s))`);
  ok(writes[0] && writes[0].status === "cancelled", "…with status cancelled");
  ok(writes[0] && writes[0].refunded === true, "…and refunded:true, so status can report it");
  ok(writes[0] && writes[0].refundOutcome === "refunded", "…carrying the refund outcome verbatim");
}

// ── 9 · NO EMAIL-KEYED TALK REFUND SURVIVES ANYWHERE ─────────────────────────
// The legacy waitUntil runner still refunded via free_tier_grant_bonus(email, 1, 0) guarded by a
// per-INVOCATION boolean — a lock that does not survive a retry or a second request, paired with a
// bonus talk that never expires. It is still reachable whenever GEN_WORKFLOW is unbound.
{
  const wsrc = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const code = wsrc.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");

  ok(!/refundQuotaTalk\(env/.test(code),
     "no talk refund anywhere uses the email-keyed bonus grant");
  ok(!/async function refundQuotaTalk/.test(code),
     "…and the helper is DELETED, not left dead to imply production uses it");
  ok((code.match(/refundTalkOnce\(env/g) || []).length >= 3,
     "every talk-refund site goes through the job-keyed atomic refund");
  ok(/refundQuota\(env/.test(code),
     "…while IMAGE refunds keep their own primitive (no job id, deliberate asymmetry)");
}

// ── 10 · RESERVATION IS JOB-SCOPED, NOT USER-SCOPED ──────────────────────────
// The duplicate-submit double-charge. consumeQuota is atomic per USER and says nothing about jobs, and
// the duplicate guard read KV — which is eventually consistent. A double-click whose read missed took a
// SECOND credit, then learned from Workflow.create() that the instance existed and returned
// resumed:true with the surplus still taken.
//
// My earlier test asserted consume === 0 for the duplicate and PASSED, because its KV stub is strongly
// consistent. It was testing the stub, not the system — which is why this one goes through the
// reservation primitive instead.
{
  const wsrc = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const code = wsrc.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");

  ok(/reserve_talk_for_job/.test(code), "submit reserves through the job-keyed Postgres primitive");
  ok(!/consumeQuota\(env, user\.id, "talk"/.test(code),
     "…and no longer takes a user-scoped consume at submit, which could not see the job");
  ok(/already_reserved/.test(code), "…a duplicate is recognised as already_reserved");
  ok(/const reservedNow = reservation\.reserved/.test(code),
     "…and the handler tracks whether THIS request took the credit");
  ok(/if \(reservedNow\) await refundTalkOnce/.test(code),
     "…so a duplicate never refunds a credit it did not take (which would burn the job's refund slot)");
  ok(/quota_exhausted/.test(code), "…and a genuine out-of-quota is still a 403");

  // Measured against the live database: five racing submits for one job id took ONE credit
  // (talks_used 4 -> 5), four returned already_reserved, and the probe was reversed afterwards.
}

// ── 11 · TERMINAL-BUT-UNDELIVERED IS RECONCILED, NOT CALLED COMPLETE ─────────
// errored / terminated were grouped with complete and returned already_complete + refunded:false, so a
// Workflow that failed left the user charged for a talk they never received.
{
  const wsrc = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const code = wsrc.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");

  ok(/sv === "complete" && cur\.result/.test(code),
     "only `complete` WITH a saved result counts as delivered");
  ok(/sv === "errored" \|\| sv === "terminated" \|\| \(sv === "complete" && !cur\.result\)/.test(code),
     "…errored, terminated, and complete-without-result are handled together as undelivered");
  ok(/completed_without_result/.test(code),
     "…including the case where the instance says complete but KV holds no talk");
  // Matched on the PROPERTY, not on one spelling: the undelivered branch calls the atomic refund and
  // tags it with the terminal state. The first version pinned an exact argument layout and failed on a
  // ternary that spans lines — a test obstructing a correct implementation.
  const undelivered = code.slice(code.indexOf('sv === "errored"'));
  ok(/refundTalkOnce\(/.test(undelivered.slice(0, 800)) && /workflow_/.test(undelivered.slice(0, 800)),
     "…and the refund is retried there, since the Workflow's own attempt may have failed");
}

// ── 12 · A LOOKUP FAILURE IS UNCERTAINTY, NOT "NO SUCH INSTANCE" ─────────────
{
  const wsrc = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const code = wsrc.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  ok(/executor: env\.GEN_WORKFLOW \? "workflow" : "legacy"/.test(code),
     "the job record names which runner owns it");
  ok(/cur\.executor === "workflow"/.test(code),
     "…and a failed lookup on a workflow-backed job is treated as uncertainty");
  ok(/instance_lookup_failed/.test(code), "…returning 502 rather than claiming cancellation");
}

// ── 13 · FINALIZE CANNOT REPORT SUCCESS WITHOUT DELIVERING ───────────────────
{
  const wf = readFileSync(new URL("./generation_workflow.js", import.meta.url), "utf8");
  const code = wf.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  ok(/const wrote = await deps\.updateJob/.test(code), "finalize captures the write result");
  ok(/if \(!wrote\)[\s\S]{0,200}NonRetryableError/.test(code),
     "…and throws when the record refused it, rather than returning finalized:true with no talk in KV");

  // Executed: a rejected finalize write must fail the workflow AND refund.
  const refunds = [];
  const deps = {
    NonRetryableError: class extends Error {},
    now: () => "t",
    updateJob: async (id, patch) => (patch.status === "done" ? false : true),   // reject only finalize
    finalizeJob: async () => true,
    refund: async (jobId, reason) => { refunds.push(reason); return { refunded: true, outcome: "refunded" }; },
    callDraft: async () => ({ text: "x", modelUsed: "m", usage: {} }),
    callCritique: async () => ({ text: "c", modelUsed: "m" }),
    meterSpend: async () => {},
  };
  const step = { do: async (_n, _o, fn) => fn() };
  let threw = false;
  try { await runGenerationWorkflow({ step, deps, payload: { jobId: "jF", wantCritique: true } }); }
  catch (_) { threw = true; }
  ok(threw, "a rejected finalize write fails the workflow instead of completing it");
  ok(refunds.length === 1, `…and refunds exactly once (got ${refunds.length})`);
}

// ── 14 · THE UI STAYS LOCKED UNTIL CANCELLATION RESOLVES ────────────────────
{
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const code = html.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  ok(/S\.cancelPending = true;/.test(code), "cancelling marks the UI as pending");
  ok(/S\.cancelPending = false;/.test(code), "…cleared only when the response lands (finally)");
  // AND NOT CLEARED INTO A FREE-FOR-ALL ON FAILURE (Codex, 2026-07-31). An unconditional clear in the
  // finally re-opened the hole the flag exists to close: cancellation unresolved, the old job possibly
  // still running, and generate() free to start one that overwrites the single reconnect handle.
  ok(/_cancelResolved/.test(code), "resolution is tracked explicitly, not assumed from the finally");
  ok(/S\.cancelUnresolved = true;/.test(code),
     "…an unconfirmed cancel leaves the UI in an explicit unresolved state");
  ok(/S\.cancelPending \|\| S\.cancelUnresolved/.test(code),
     "…and generate() refuses while EITHER is set");
  ok(/Reload to reconnect/i.test(code),
     "…telling the user the way out is a reload, which reconnects to the job the handle still holds");
  // Condition widened when the finally stopped clearing unconditionally; assert the PROPERTY (generate
  // returns early while a cancellation is in flight OR unresolved) rather than one spelling of it.
  ok(/if\(S\.cancelPending \|\| S\.cancelUnresolved\)\{[\s\S]{0,400}return;/.test(code),
     "…and generate() refuses to start a new job while a cancellation is unresolved");
}

// ── 15 · A CLIENT-SUPPLIED JOB ID CANNOT ADOPT ANOTHER USER'S JOB ────────────
// The worst finding of the session, and it came out of the fix for the double-charge: the reservation
// returned `already_reserved` on primary-key conflict WITHOUT comparing user_id. Job ids are
// client-supplied, so a second user submitting a known id got a free pass, and the handler then
// overwrote the record's userId and the stored job body before discovering the existing instance —
// redirecting the first user's generation to the second. A cross-account leak, not a billing bug.
//
// Verified against the live database: owner -> reserved, owner again -> already_reserved,
// STRANGER -> owned_by_other.
{
  const wsrc = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const code = wsrc.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");

  ok(/owned_by_other/.test(code), "the handler recognises a job id held by another user");
  ok(/reservation\.outcome === "owned_by_other"[\s\S]{0,300}job_not_found/.test(code),
     "…and refuses with 404 rather than adopting the job");
  ok(/job_id_collision/.test(code), "…logging the collision, since it should never happen benignly");

  // The two writes that performed the hijack must both be gated on having reserved.
  ok(/if \(reservedNow\) \{[\s\S]{0,400}JOBS_KV\.put\("job:" \+ jobId/.test(code),
     "only the reserver writes the job record (the userId overwrite)");
  ok(/if \(reservedNow\) \{[\s\S]{0,300}JOBS_KV\.put\("jobbody:" \+ jobId/.test(code),
     "…and only the reserver writes the job body (the prompt overwrite)");
}

// ── 16 · THE EARLY KV RESUME BRANCH CHECKS OWNERSHIP TOO ─────────────────────
// The reservation's owner check is useless if a branch ABOVE it answers first. This returned
// `resumed: true` for any existing job id, so a different authenticated user who knew or guessed an id
// learned that the job existed and when it was created. It no longer redirects the talk — the later
// writes are gated — but existence and createdAt are still a disclosure.
{
  const wsrc = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const code = wsrc.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");

  ok(/ex\.userId !== user\.id/.test(code),
     "the KV resume branch compares the stored owner against the caller");
  // AND FAILS CLOSED. `ex.userId && ex.userId !== user.id` reads as a null-guard and behaves as a
  // bypass: a record with no userId (written before the field existed, or a JSON parse yielding {})
  // skips the check entirely and returns resumed:true. Asserted as the ABSENCE of that shape, because
  // `ex.userId !== user.id` is a substring of the broken version and cannot distinguish them.
  ok(!/ex\.userId\s*&&\s*ex\.userId !== user\.id/.test(code),
     "…and treats MISSING ownership as unauthorised rather than ownerless");
  ok(/ex\.userId !== user\.id[\s\S]{0,300}job_not_found/.test(code),
     "…and returns the SAME 404 as owned_by_other, leaking nothing about whose job it is");
  ok(/where: "kv_resume"/.test(code), "…logging which branch caught it");

  // FAIL CLOSED ON MISSING OWNERSHIP. Executed, because a source check cannot distinguish
  // `ex.userId && ex.userId !== user.id` from `ex.userId !== user.id` in terms of INTENT — only in
  // terms of behaviour on a record that has no userId at all (an older job, or a JSON parse yielding {}).
  {
    const ORIGIN2 = "https://tangjennii-wq.github.io";
    const legacy = new Map([
      ["job:ownerless", JSON.stringify({ status: "running", createdAt: "2026-07-01T00:00:00Z" })],  // no userId
      ["job:corrupt", "{not json"],
    ]);
    const realFetch2 = globalThis.fetch;
    globalThis.fetch = async (u) => {
      if (String(u).includes("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: "u-stranger", email: "s@t.dev" }),
          { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const env2 = {
      ALLOWED_ORIGINS: ORIGIN2, SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "k",
      JOBS_KV: { get: async (k) => legacy.get(k) ?? null, put: async () => {}, delete: async () => {} },
    };
    const submit = (jid) => new Request("https://p.test/generate-async", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN2, "X-Supabase-Auth": "t" },
      body: JSON.stringify({ clientJobId: jid, topic: "x", style: "lecture", depth: "concise",
                             system: "s", messages: [{ role: "user", content: "go" }], model: "claude-opus-5" }),
    });

    for (const jid of ["ownerless", "corrupt"]) {
      const res = await worker.fetch(submit(jid), env2, { waitUntil() {} });
      const b = await res.json().catch(() => ({}));
      ok(b.resumed !== true,
         `a record with unattributable ownership ("${jid}") does NOT return resumed:true`);
      ok(!b.createdAt, `…and leaks no createdAt for "${jid}"`);
    }
    globalThis.fetch = realFetch2;
  }

  // The ownership check must precede the resumed:true response, or it is decorative.
  const branch = code.slice(code.indexOf('JOBS_KV.get("job:" + jobId)'));
  const idxCheck = branch.indexOf("ex.userId !== user.id");
  const idxResume = branch.indexOf("resumed: true");
  ok(idxCheck > 0 && idxResume > idxCheck,
     "…and the check comes BEFORE resumed:true, not after");
}

console.log("\n" + (failures === 0 ? "✔ CANCEL / REFUND OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
