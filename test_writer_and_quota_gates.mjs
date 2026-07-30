// AUTHORISATION ON THE SYNC ROUTE — run: node test_writer_and_quota_gates.mjs
//
// Three rounds of review got this wrong in three different ways, each time in the same direction: the
// gate looked like a control and was actually a courtesy.
//
//   v1  no gate at all. WRITER_CLEARED was enforced only by the async runner; the quota was enforced by
//       the client's good manners.
//   v2  gated on `X-CT-Meter: talk` and a 12-call receipt. Codex: a client header cannot decide whether
//       a request is medical (relabel it `aux` and both gates vanish), and one credit buying twelve
//       arbitrary calls buys twelve independent generations.
//   v3  this. Authorisation is a receipt bound to (user, job, stage, model set). The header selects
//       WHICH receipt is demanded; it cannot exempt a request from needing one.
//
// Every assertion counts UPSTREAM CALLS, not status codes. A gate that returns 403 while still spending
// money is not a gate.
import worker from "./worker.js";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const ORIGIN = "http://localhost:8000";
const realFetch = globalThis.fetch;

function harness({ withKV = true, userId = "u1" } = {}) {
  const kv = new Map();
  const calls = { anthropic: 0 };
  const env = {
    ALLOWED_ORIGINS: ORIGIN, ANTHROPIC_API_KEY: "sk-test",
    SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "k",
    MAX_MONTHLY_SPEND_USD: "250",
  };
  if (withKV) env.JOBS_KV = {
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
  };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) {
      calls.anthropic++;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: {} }),
                          { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: userId, email: "a@b.c" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("free_tier_consume")) return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { env, calls, kv };
}
const ctx = { waitUntil() {} };

function msg({ model = "claude-opus-5", kind = "talk", receipt, job, stage } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-CT-Meter": kind, "X-Supabase-Auth": "t" };
  if (receipt) headers["X-CT-Receipt"] = receipt;
  if (job) headers["X-CT-Job"] = job;
  if (stage) headers["X-CT-Stage"] = stage;
  return new Request("https://p.test/v1/messages", {
    method: "POST", headers,
    body: JSON.stringify({ model, messages: [{ role: "user", content: "manage severe hyperkalemia" }] }),
  });
}
async function mint(env, jobId) {
  const res = await worker.fetch(new Request("https://p.test/v1/free-tier/consume", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Supabase-Auth": "t" },
    body: JSON.stringify({ kind: "talk", clientJobId: jobId }),
  }), env, ctx);
  return { status: res.status, body: await res.json() };
}
const reason = async (res) => ((await res.json()).error || {}).detail?.reason;

// ── 1 · `aux` CANNOT BE USED TO GENERATE WITH AN UNCLEARED MODEL ─────────────
// Codex's first hole: relabel the talk and both gates disappear. It must not matter what the header says.
{
  const h = harness();
  h.calls.anthropic = 0;
  for (const model of ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"]) {
    const res = await worker.fetch(msg({ model, kind: "aux" }), h.env, ctx);
    ok(res.status >= 400, `aux + ${model} is REFUSED (got ${res.status}) — the header is not an exemption`);
  }
  ok(h.calls.anthropic === 0, "…and nothing reached Anthropic. `aux` no longer bypasses authorisation");
  globalThis.fetch = realFetch;
}

// ── 2 · A RECEIPT FOR JOB A CANNOT AUTHORISE JOB B ───────────────────────────
// Otherwise one consumed credit funds unlimited generations.
{
  const h = harness();
  const { body } = await mint(h.env, "job-aaaaaaaa");
  h.calls.anthropic = 0;
  const res = await worker.fetch(
    msg({ receipt: body.receipt, job: "job-bbbbbbbb", stage: "draft" }), h.env, ctx);
  ok(res.status === 402, `a receipt used against a DIFFERENT job is refused (got ${res.status})`);
  ok(await reason(res) === "wrong_job", "…for wrong_job specifically");
  ok(h.calls.anthropic === 0, "…and spends nothing");

  const good = await worker.fetch(
    msg({ receipt: body.receipt, job: "job-aaaaaaaa", stage: "draft" }), h.env, ctx);
  ok(good.status === 200, "…while the job it was minted for works");
  globalThis.fetch = realFetch;
}

// ── 3 · A DRAFT AUTHORISATION CANNOT BUY TWELVE MORE DRAFTS ──────────────────
// The v2 receipt was 12 arbitrary calls. Per-stage budgets bound each phase separately.
{
  const h = harness();
  const { body } = await mint(h.env, "job-cccccccc");
  h.calls.anthropic = 0;
  let allowed = 0, refused = 0;
  for (let i = 0; i < 12; i++) {
    const r = await worker.fetch(msg({ receipt: body.receipt, job: "job-cccccccc", stage: "draft" }), h.env, ctx);
    if (r.status === 200) allowed++; else refused++;
  }
  ok(allowed <= 3, `a draft authorisation permits at most its stage budget (${allowed} allowed)`);
  ok(refused >= 9, `…and refuses the rest (${refused} of 12)`);
  ok(h.calls.anthropic === allowed, "…with upstream spend matching exactly the allowed calls");

  // …and the critique budget is SEPARATE, so exhausting drafts does not consume it.
  const crit = await worker.fetch(msg({ receipt: body.receipt, job: "job-cccccccc", stage: "critique" }), h.env, ctx);
  ok(crit.status === 200, "critique has its own budget — exhausting drafts does not exhaust it");

  // A stage that was never authorised is refused outright.
  const bogus = await worker.fetch(msg({ receipt: body.receipt, job: "job-cccccccc", stage: "somethingelse" }), h.env, ctx);
  ok(bogus.status === 402 && await reason(bogus) === "stage_not_authorised",
     "…and an unrecognised stage is refused rather than defaulting to something permissive");
  globalThis.fetch = realFetch;
}

// ── 4 · MISSING KV FAILS CLOSED, WITH ZERO UPSTREAM CALLS ────────────────────
// v2 logged a warning and continued, so a misconfiguration silently disabled both quota and the writer
// allowlist while the app kept spending. An outage is visible; a silently ungated proxy is not.
{
  const h = harness({ withKV: false });
  h.calls.anthropic = 0;
  const res = await worker.fetch(msg({ receipt: "anything", job: "j", stage: "draft" }), h.env, ctx);
  ok(res.status === 503, `no receipt store => 503, not "carry on" (got ${res.status})`);
  ok(h.calls.anthropic === 0, "…and ZERO upstream calls");

  const consume = await mint(h.env, "job-dddddddd");
  ok(consume.status === 503, "…and /consume refuses to pretend it reserved anything");
  globalThis.fetch = realFetch;
}

// ── 5 · MODEL AND OPERATION MUST MATCH WHAT THE RECEIPT AUTHORISES ───────────
// The model gate rides on the receipt, so there is no header to set that routes around it.
{
  const h = harness();
  const { body } = await mint(h.env, "job-eeeeeeee");
  h.calls.anthropic = 0;
  for (const model of ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001", "claude-sonnet-5"]) {
    const res = await worker.fetch(msg({ model, receipt: body.receipt, job: "job-eeeeeeee", stage: "draft" }), h.env, ctx);
    ok(res.status === 403, `${model} is not authorised by a talk receipt (got ${res.status})`);
  }
  ok(h.calls.anthropic === 0, "…and none of them reached Anthropic");
  const cleared = await worker.fetch(
    msg({ model: "claude-opus-5", receipt: body.receipt, job: "job-eeeeeeee", stage: "draft" }), h.env, ctx);
  ok(cleared.status === 200 && h.calls.anthropic === 1, "…while a cleared writer goes through, once");
  globalThis.fetch = realFetch;
}

// ── 6 · ANOTHER USER'S RECEIPT ───────────────────────────────────────────────
{
  const h = harness({ userId: "u1" });
  const { body } = await mint(h.env, "job-ffffffff");
  // Same env and KV, different authenticated user.
  const h2 = harness({ userId: "SOMEONE_ELSE" });
  h2.env.JOBS_KV = h.env.JOBS_KV;
  h2.calls.anthropic = 0;
  const res = await worker.fetch(msg({ receipt: body.receipt, job: "job-ffffffff", stage: "draft" }), h2.env, ctx);
  ok(res.status === 402 && await reason(res) === "wrong_owner", "another user's receipt is refused");
  ok(h2.calls.anthropic === 0, "…and spends nothing");
  globalThis.fetch = realFetch;
}

// ── 7 · THE SOURCE MUST NOT CLAIM MORE THAN IT DOES ─────────────────────────
{
  const src = (await import("fs")).readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  // Flatten AND strip the leading // of continuation lines, so a comment that wraps mid-sentence still
  // matches. Pinning a specific wrap makes the test fail on a reflow that changed nothing.
  const flat = src.split("\n").map(l => l.replace(/^\s*\/\/\s?/, "")).join(" ").replace(/\s+/g, " ");
  ok(/client header cannot determine whether a request is medical/.test(flat),
     "the source records WHY the header-based gate was wrong");
  ok(/allowedModels: WRITER_CLEARED/.test(flat),
     "…and that the model gate now travels with the receipt");
  ok(!/receipt check SKIPPED/.test(src), "the silent-degradation path is gone");
  ok(/Availability does not outrank billing and content safety/.test(src),
     "…replaced by an explicit statement of the trade");
}

console.log("\n" + (failures === 0 ? "✔ AUTHORISATION TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
