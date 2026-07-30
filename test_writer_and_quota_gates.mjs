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

// Receipts live in Postgres now, so the harness models receipt_issue / receipt_redeem.
//
// receipt_redeem is modelled as ATOMIC — check and decrement inseparable — because that is what the SQL
// does: one UPDATE ... WHERE used < max, serialised by the row lock. Modelling it as read-then-write
// would reproduce the KV bug in the test and let a broken implementation pass. Section 8 demonstrates
// the difference explicitly rather than asking anyone to take it on faith.
const RECEIPTS = new Map();
function harness({ withStore = true, userId = "u1" } = {}) {
  const calls = { anthropic: 0 };
  const env = {
    ALLOWED_ORIGINS: ORIGIN, ANTHROPIC_API_KEY: "sk-test",
    MAX_MONTHLY_SPEND_USD: "250",
    JOBS_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
  };
  if (withStore) { env.SUPABASE_URL = "https://x.test"; env.SUPABASE_SERVICE_ROLE_KEY = "k"; }

  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) {
      calls.anthropic++;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: {} }),
                          { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: userId, email: "a@b.c" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const body = (() => { try { return JSON.parse(init && init.body || "{}"); } catch (_) { return {}; } })();
    if (u.includes("receipt_issue")) {
      RECEIPTS.set(body.p_id, {
        userId: body.p_user_id, jobId: body.p_job, kind: body.p_kind,
        allowedModels: body.p_allowed_models, stages: JSON.parse(JSON.stringify(body.p_stages)),
        expired: false,
      });
      return new Response("null", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("receipt_redeem")) {
      const r = RECEIPTS.get(body.p_receipt);
      const fail = (reason) => new Response(JSON.stringify([{ ok: false, reason, used: 0, max_allowed: 0 }]),
                                            { status: 200, headers: { "Content-Type": "application/json" } });
      if (!r) return fail("unknown_or_expired");
      if (r.userId !== body.p_user_id) return fail("wrong_owner");
      if (r.jobId && r.jobId !== body.p_job) return fail("wrong_job");
      if (!r.allowedModels.includes(body.p_model)) return fail("model_not_authorised");
      const st = r.stages[body.p_stage];
      if (!st) return fail("stage_not_authorised");
      // ATOMIC, as the SQL is. No await between reading `used` and writing it.
      if (st.used >= st.max) return fail("stage_exhausted");
      st.used += 1;
      return new Response(JSON.stringify([{ ok: true, reason: "ok", used: st.used, max_allowed: st.max }]),
                          { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("free_tier_consume")) return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { env, calls };
}
const ctx = { waitUntil() {} };
// Mirrors RECEIPT_STAGE_BUDGETS.talk.draft in worker.js.
const RECEIPT_DRAFT_BUDGET = 2;

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
  ok(allowed <= 2, `a draft authorisation permits at most its stage budget (${allowed} allowed)`);
  ok(refused >= 10, `…and refuses the rest (${refused} of 12)`);
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
  const h = harness({ withStore: false });
  h.calls.anthropic = 0;
  const res = await worker.fetch(msg({ receipt: "anything", job: "j", stage: "draft" }), h.env, ctx);
  // 401 (the unauthenticated app-funded path is closed) or 503 (free tier unconfigured) — either is a
  // refusal. Pinning the exact code would make this fail on a reword that changed nothing; the property
  // is that it is refused and NOTHING IS SPENT.
  ok(res.status === 401 || res.status === 503,
     `no receipt store => refused, not "carry on" (got ${res.status})`);
  ok(h.calls.anthropic === 0, "…and ZERO app-funded upstream calls");

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
  ok(/p_allowed_models: WRITER_CLEARED/.test(flat),
     "…and that the model gate now travels with the receipt");
  ok(!/receipt check SKIPPED/.test(src), "the silent-degradation path is gone");
  ok(/Availability does not outrank billing and content safety/.test(src),
     "…replaced by an explicit statement of the trade");
}

// ── 8 · TEN AT ONCE MUST NOT EXCEED THE BUDGET ───────────────────────────────
// Codex: "Receipt redemption must be atomic. KV read-modify-write and eventual consistency can allow
// concurrent reuse. Prove that 10 simultaneous requests with the same jobId + stage cannot exceed its
// budget."
//
// He was right, and the measurement was worse than the warning. Against the previous KV implementation,
// with a stage budget of 3:
//
//     concurrent requests: 10   allowed: 10   UPSTREAM CALLS BILLED: 10
//
// Every one got through. Each read used=0, each decided it was in budget, each spent money. The bound
// existed only when nothing was racing it — which is the one condition under which a bound is pointless.
//
// Both shapes are executed below so the difference is demonstrated rather than claimed.
{
  const BUDGET = 2;

  // (a) THE OLD SHAPE — read, decide, write, with an await between. This is what KV forces.
  {
    let used = 0, billed = 0;
    const nonAtomic = async () => {
      const seen = used;                                   // read
      await new Promise(r => setTimeout(r, 1));            // ...any await at all
      if (seen >= BUDGET) return false;                    // decide on a stale read
      used = seen + 1;                                     // write
      billed++;
      return true;
    };
    await Promise.all(Array.from({ length: 10 }, nonAtomic));
    ok(billed > BUDGET,
       `NON-ATOMIC: 10 concurrent requests billed ${billed} against a budget of ${BUDGET} — the bug, reproduced`);
  }

  // (b) THE SQL SHAPE — check and decrement inseparable, as `UPDATE ... WHERE used < max` is.
  {
    let used = 0, billed = 0;
    const atomic = async () => {
      await new Promise(r => setTimeout(r, 1));            // latency before, as a real round trip has
      if (used >= BUDGET) return false;                    // check and decrement with NO await between:
      used += 1;                                           // JS is single-threaded, so this is atomic,
      billed++;                                            // exactly as the row lock makes the SQL atomic
      return true;
    };
    await Promise.all(Array.from({ length: 10 }, atomic));
    ok(billed === BUDGET,
       `ATOMIC: 10 concurrent requests billed exactly ${billed} — the budget holds`);
  }

  // NB the SQL was ALSO verified in production, sequentially: redeem #1 and #2 succeed, #3 is refused
  // with stage_exhausted, and wrong job / wrong owner / uncleared model / unknown stage each return
  // their own reason. A first attempt at a CONCURRENT check used generate_series + lateral and reported
  // ten authorised against a budget of two — that is one statement sharing one snapshot, so it measured
  // the test rather than the lock. The concurrent case rests on Postgres row-locking semantics; see
  // supabase/migrations/add_receipts.sql for how to close that last gap with real parallel connections.

  // (c) END TO END, through the real handler, against the modelled store.
  const h = harness();
  const { body } = await mint(h.env, "job-concurrent");
  h.calls.anthropic = 0;
  const results = await Promise.all(Array.from({ length: 10 }, () =>
    worker.fetch(msg({ receipt: body.receipt, job: "job-concurrent", stage: "draft" }), h.env, ctx)));
  const allowed = results.filter(r => r.status === 200).length;
  ok(allowed <= RECEIPT_DRAFT_BUDGET,
     `10 simultaneous requests, same job and stage: ${allowed} allowed (budget ${RECEIPT_DRAFT_BUDGET})`);
  ok(h.calls.anthropic === allowed,
     `…and UPSTREAM CALLS BILLED = ${h.calls.anthropic}, matching exactly what was authorised`);
  ok(h.calls.anthropic <= RECEIPT_DRAFT_BUDGET,
     "…so concurrency cannot buy calls the receipt did not authorise");
  globalThis.fetch = realFetch;
}

// ── 9 · REDEMPTION LIVES WHERE ATOMICITY EXISTS ──────────────────────────────
{
  const src = (await import("fs")).readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  ok(/supaServiceRPC\(env, "receipt_redeem"/.test(src),
     "redemption goes through the database, not KV");
  ok(!/JOBS_KV\.get\("receipt:/.test(src), "no KV receipt reads remain");
  ok(!/JOBS_KV\.put\("receipt:/.test(src), "no KV receipt writes remain");
  ok(/return \{ ok: false, reason: "store_unreachable" \}/.test(src),
     "an unreachable database FAILS CLOSED — if we cannot establish it was paid for, it was not");

  const sql = (await import("fs")).readFileSync(new URL("./supabase/migrations/add_receipts.sql", import.meta.url), "utf8");
  const flatSql = sql.split("\n").map(l => l.replace(/^\s*--.*$/, "")).join(" ").replace(/\s+/g, " ");
  ok(/update public\.generation_receipts/.test(flatSql) && /jsonb_set/.test(flatSql),
     "the SQL decrements with an UPDATE");
  ok(/< \(\(r\.stages -> p_stage ->> 'max'\)::int\)/.test(flatSql),
     "…whose WHERE carries the budget check, so decision and decrement are one statement");
  ok(/revoke all on function public\.receipt_issue/.test(flatSql),
     "…and a browser cannot mint its own receipt");
}

console.log("\n" + (failures === 0 ? "✔ AUTHORISATION TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
