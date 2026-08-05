// GENERATION SESSION / RECEIPT LIFECYCLE — run: node test_receipt_session.mjs
//
// ── THE COUPLING BUG (Codex, 2026-07-31) ────────────────────────────────────────────────────────────
// The Worker required a receipt before calling Claude; the client could not obtain a usable one. Three
// concrete failures, all 402:
//
//   1. DESKTOP SYNC drafted FIRST, then consumed the credit and got a receipt. The first request had no
//      receipt, so it was rejected — the client and server disagreed about when authorisation exists.
//   2. BACKGROUND generation reserved the credit server-side and returned only {jobId, durable}. Later
//      citation audits, diagram prompts and refines had nothing to authorise with.
//   3. TALK RECEIPTS covered draft/critique/refine on WRITER models only. The citation audit runs as
//      `aux`, often on Haiku, so it failed both the stage check and the model check — on a receipt
//      minted for that very generation.
//
// The fix is one session endpoint that reserves and mints atomically BEFORE any model call, plus a
// receipt returned from the async path, plus per-stage model sets.
import worker from "./worker.js";
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const ORIGIN = "https://tangjennii-wq.github.io";
const realFetch = globalThis.fetch;
const ctx = { waitUntil(p) { if (p && p.catch) p.catch(() => {}); } };
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

function harness({ owns = true, reserveOutcome = null, talkOwner = "u-1" } = {}) {
  const seen = { issued: [], reserved: 0, refunds: 0 };
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) return json({ id: "u-1", email: "j@t.dev" });
    if (u.includes("/rest/v1/talks")) {
      return json(owns ? [{ id: "t-1", user_id: talkOwner }] : []);
    }
    if (u.includes("/rpc/reserve_talk_for_job")) {
      seen.reserved++;
      if (reserveOutcome) return json([reserveOutcome]);
      return json([{ reserved: true, outcome: "reserved", owner_id: "u-1" }]);
    }
    if (u.includes("/rpc/receipt_issue")) {
      try { seen.issued.push(JSON.parse(init.body)); } catch (_) {}
      return json(null);
    }
    if (u.includes("/rpc/refund_talk_once")) { seen.refunds++; return json([{ refunded: true, outcome: "refunded" }]); }
    if (u.includes("/rpc/free_tier_remaining")) return json([{ talks_remaining: 9, images_remaining: 5 }]);
    return json([]);
  };
  const env = {
    ALLOWED_ORIGINS: ORIGIN, SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "k",
    SUPABASE_ANON_KEY: "a", ANTHROPIC_API_KEY: "sk", FREE_TALKS: "10",
    JOBS_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
  };
  return { env, seen };
}
const post = (path, body) => new Request("https://p.test" + path, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Supabase-Auth": "t" },
  body: JSON.stringify(body || {}),
});

// ── 1 · THE SESSION AUTHORISES BEFORE ANY MODEL CALL ─────────────────────────
{
  const h = harness();
  const res = await worker.fetch(post("/v1/free-tier/session", { jobId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }), h.env, ctx);
  const b = await res.json();
  globalThis.fetch = realFetch;

  ok(res.status === 200, `the session endpoint exists and answers (got ${res.status})`);
  ok(!!b.receipt, "…returning a receipt the client can use on its FIRST model call");
  ok(b.jobId === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "…bound to the client's job id");
  ok(h.seen.reserved === 1, "…having reserved exactly one talk");
  ok(b.charged === true, "…and reporting that this request took the credit");
}

// ── 2 · THE RECEIPT COVERS EVERY STAGE ONE GENERATION USES ───────────────────
// `aux` was missing, so the citation audit was rejected by a receipt minted for its own generation.
{
  const h = harness();
  await worker.fetch(post("/v1/free-tier/session", {}), h.env, ctx);
  globalThis.fetch = realFetch;

  const issued = h.seen.issued[0];
  ok(!!issued, "a receipt was issued to Postgres");
  const stages = Object.keys(issued.p_stages || {});
  for (const st of ["draft", "critique", "refine", "aux"]) {
    ok(stages.includes(st), `…covering the "${st}" stage`);
  }
  ok((issued.p_stages.aux || {}).max >= 5,
     `…with a realistic aux budget for one talk's fan-out (got ${(issued.p_stages.aux || {}).max})`);
}

// ── 3 · MODELS ARE AUTHORISED PER STAGE, NOT WRITERS-ONLY ────────────────────
// The citation audit runs on Haiku. A writers-only allowlist rejected it even with a valid receipt.
{
  const h = harness();
  await worker.fetch(post("/v1/free-tier/session", {}), h.env, ctx);
  globalThis.fetch = realFetch;

  const models = h.seen.issued[0].p_allowed_models || [];
  ok(models.includes("claude-opus-5"), "the writer model is authorised");
  ok(models.includes("claude-haiku-4-5-20251001"),
     "…and so is the aux model the citation audit actually uses");
}

// ── 4 · BACKGROUND GENERATION RETURNS A RECEIPT ──────────────────────────────
{
  const wsrc = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const code = wsrc.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  ok(/durable: true, receipt: asyncReceipt/.test(code),
     "/generate-async returns a receipt alongside {jobId, durable}");
  ok(/resumed: true, receipt: resumeReceipt/.test(code),
     "…and so does the resumed-duplicate response, so a reload keeps authorisation");
}

// ── 5 · REFINE OF A SAVED TALK IS FREE, AND GATED ON OWNERSHIP ───────────────
// Product decision: refinement is part of the talk already paid for. Ownership is the control, not price.
{
  const h = harness({ owns: true });
  const res = await worker.fetch(post("/v1/free-tier/refine-session",
    { talkId: "019f71d1-972b-4bce-b19a-0d04fec960bb" }), h.env, ctx);
  const b = await res.json();
  globalThis.fetch = realFetch;

  ok(res.status === 200 && !!b.receipt, "the owner gets a refine receipt");
  ok(b.charged === false, "…free — no credit consumed");
  ok(h.seen.reserved === 0, "…and no reservation is taken at all");
  const issued = h.seen.issued[0];
  ok(Object.keys(issued.p_stages).includes("refine"), "…authorising the refine stage");
  ok(!Object.keys(issued.p_stages).includes("draft"),
     "…and NOT draft — a refine receipt cannot buy a whole new talk");
}

// ── 6 · A NON-OWNER GETS 404, AND NO RECEIPT ─────────────────────────────────
// Without this, refine-session is a free unauthenticated route to the app key.
{
  const h = harness({ owns: false });
  const res = await worker.fetch(post("/v1/free-tier/refine-session",
    { talkId: "019f71d1-972b-4bce-b19a-0d04fec960bb" }), h.env, ctx);
  const b = await res.json();
  globalThis.fetch = realFetch;
  ok(res.status === 404, `a talk the caller does not own is 404 (got ${res.status})`);
  ok(!b.receipt, "…and no receipt is minted");
  ok(h.seen.issued.length === 0, "…nothing reached the receipt store");
}
{
  // Owned by SOMEONE ELSE — the row exists, so this proves the check compares ids rather than existence.
  const h = harness({ owns: true, talkOwner: "u-stranger" });
  const res = await worker.fetch(post("/v1/free-tier/refine-session",
    { talkId: "019f71d1-972b-4bce-b19a-0d04fec960bb" }), h.env, ctx);
  globalThis.fetch = realFetch;
  ok(res.status === 404, "a talk owned by another user is also 404, not 200");
  ok(h.seen.issued.length === 0, "…and mints nothing");
}

// ── 7 · A FAILED MINT REFUNDS, AND ONLY WHAT THIS REQUEST TOOK ───────────────
{
  const h = harness();
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, i) => {
    if (String(u).includes("/rpc/receipt_issue")) return json({ message: "down" }, 500);
    return orig(u, i);
  };
  const res = await worker.fetch(post("/v1/free-tier/session", {}), h.env, ctx);
  globalThis.fetch = realFetch;
  ok(res.status === 503, "a receipt-store outage fails CLOSED (503)");
  ok(h.seen.refunds === 1, "…refunding the credit it just reserved");
}
{
  // A DUPLICATE session whose mint fails must NOT refund — it never took a credit, and refunding would
  // burn the job's single refund slot, leaving the original reservation unrefundable.
  const h = harness({ reserveOutcome: { reserved: false, outcome: "already_reserved", owner_id: "u-1" } });
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, i) => {
    if (String(u).includes("/rpc/receipt_issue")) return json({ message: "down" }, 500);
    return orig(u, i);
  };
  await worker.fetch(post("/v1/free-tier/session", {}), h.env, ctx);
  globalThis.fetch = realFetch;
  ok(h.seen.refunds === 0, "a duplicate session never refunds a credit it did not take");
}

// ── 8 · A STRANGER'S JOB ID IS REFUSED HERE TOO ──────────────────────────────
{
  const h = harness({ reserveOutcome: { reserved: false, outcome: "owned_by_other", owner_id: "u-other" } });
  const res = await worker.fetch(post("/v1/free-tier/session", { jobId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }), h.env, ctx);
  globalThis.fetch = realFetch;
  ok(res.status === 404, "the session endpoint refuses another user's job id");
  ok(h.seen.issued.length === 0, "…and mints no receipt for it");
}

// ── 9 · ENFORCEMENT IS STAGED, AND THE HOLE IS VISIBLE ───────────────────────
// The Worker and the published client cannot change in the same instant.
{
  const wsrc = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const code = wsrc.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  ok(/env\.RECEIPTS_REQUIRED/.test(code), "enforcement is gated on RECEIPTS_REQUIRED");
  ok(/receipt_missing_unenforced/.test(code),
     "…and every unauthorised call is LOGGED while the flag is off, not silently allowed");
  ok(/!auth\.ok && enforceReceipts/.test(code),
     "…with the refusal itself conditional on the flag");
  // The temporary hole must still require authentication — otherwise it is the bypass this replaced.
  const idxUser = code.indexOf("verifySupabaseUser");
  ok(idxUser > 0, "…and a signed-in user is still required regardless of the flag");
}

// ── 10 · ONE PLACE MINTS RECEIPTS ────────────────────────────────────────────
{
  const wsrc = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const code = wsrc.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const direct = (code.match(/"receipt_issue"/g) || []).length;
  ok(direct === 1,
     `receipt_issue is called from exactly ONE place (found ${direct}) — mintReceipt`);
  ok(/async function mintReceipt/.test(code), "…which is mintReceipt");
  ok((code.match(/mintReceipt\(env/g) || []).length >= 4,
     "…and every path (consume, session, refine, async) goes through it");
}

// ── 11 · THE TWO ENFORCEMENT MODES, EXECUTED ─────────────────────────────────
// The staged rollout is only safe if both halves behave as claimed: unenforced ALLOWS AND LOGS (so the
// live client keeps working), enforced REFUSES (so the property is real once the flag is set).
{
  const mkEnv = (enforce) => ({
    ALLOWED_ORIGINS: ORIGIN, ANTHROPIC_API_KEY: "sk", SUPABASE_URL: "https://x.test",
    SUPABASE_SERVICE_ROLE_KEY: "k", SUPABASE_ANON_KEY: "a", FREE_TALKS: "10",
    JOBS_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
    ...(enforce ? { RECEIPTS_REQUIRED: "true" } : {}),
  });
  const call = (env) => worker.fetch(new Request("https://p.test/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Supabase-Auth": "t",
               "X-CT-Meter": "talk" },   // no receipt at all — the live client's shape today
    body: JSON.stringify({ model: "claude-opus-5", messages: [{ role: "user", content: "hi" }] }),
  }), env, ctx);

  let anthropic = 0, logged = 0;
  const origErr = console.error;
  console.error = (...a) => { if (String(a[0]).includes("receipt_missing_unenforced")) logged++; };
  globalThis.fetch = async (u) => {
    if (String(u).includes("api.anthropic.com")) { anthropic++; return json({ content: [{ type: "text", text: "{}" }] }); }
    if (String(u).includes("/auth/v1/user")) return json({ id: "u-1", email: "j@t.dev" });
    return json([]);
  };

  const unenforced = await call(mkEnv(false));
  const allowedCalls = anthropic;
  const enforced = await call(mkEnv(true));
  const afterEnforced = anthropic;

  globalThis.fetch = realFetch;
  console.error = origErr;

  ok(unenforced.status === 200, `unenforced: a receiptless call is ALLOWED (got ${unenforced.status})`);
  ok(logged >= 1, "…and logged as receipt_missing_unenforced, so the hole is visible");
  ok(enforced.status === 402 || enforced.status === 403,
     `enforced: the same call is REFUSED (got ${enforced.status})`);
  ok(afterEnforced === allowedCalls,
     "…and reached Anthropic zero additional times once the flag is set");
}

console.log("\n" + (failures === 0 ? "✔ RECEIPT SESSION OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
