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
    // Refine receipts go through the ATOMIC RENEWAL rather than insert-once, because they must work days
    // later without ever letting a loop replenish the budget. Counted as an issue so the existing
    // assertions about stages and models still see it.
    if (u.includes("/rpc/receipt_renew_refine")) {
      try {
        const b = JSON.parse(init.body);
        seen.issued.push({ p_id: b.p_id, p_stages: b.p_stages, p_allowed_models: b.p_allowed_models,
                           p_kind: "refine" });
      } catch (_) {}
      return json([{ ok: true, outcome: "created" }]);
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
  // THE PROPERTY, NOT THE PHRASING. These were exact source-text matches on one formatting of one object
  // literal. Adding receiptExpiresAt broke both, reporting a regression in code that had just been made
  // more correct — and my first repair matched only the FIRST of three durable returns, so a path missing
  // its receipt could still have passed.
  //
  // What actually has to hold: EVERY response that tells the browser a durable job is running also hands
  // it something to authorise with. Enumerate them and require it of each.
  const durableReturns = [...code.matchAll(/return jsonOK\(\{[\s\S]{0,400}?\}, origin\);/g)]
    .map(m => m[0]).filter(t => /durable: true/.test(t));
  ok(durableReturns.length >= 3,
     `found every durable-start response (${durableReturns.length}: fresh, workflow-duplicate, KV-resume)`);
  const receiptless = durableReturns.filter(t => !/receipt/.test(t));
  ok(receiptless.length === 0,
     "EVERY durable-start response carries a receipt — none reports a running paid job the browser " +
     `cannot authorise a single call against (${receiptless.length} without)`);
  ok(durableReturns.every(t => /receiptExpiresAt/.test(t)),
     "…each with its real absolute expiry, so a resume cannot reset a clock the database did not reset");
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

// ── 12 · MINTING IS IDEMPOTENT PER JOB ───────────────────────────────────────
// The reservation is exactly-once per job; the AUTHORISATION it pays for was not. mintReceipt used
// crypto.randomUUID(), so ten /session calls with one jobId took one credit and returned TEN receipts,
// each with a full draft 2 / critique 2 / aux 10 budget. One credit, unbounded paid calls. /refine-session
// was worse: free by design, so a loop over a talk you own minted unlimited refine authorisations.
{
  const h = harness();
  const JOB = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const r1 = await (await worker.fetch(post("/v1/free-tier/session", { jobId: JOB }), h.env, ctx)).json();
  const r2 = await (await worker.fetch(post("/v1/free-tier/session", { jobId: JOB }), h.env, ctx)).json();
  const r3 = await (await worker.fetch(post("/v1/free-tier/session", { jobId: JOB }), h.env, ctx)).json();
  globalThis.fetch = realFetch;

  ok(r1.receipt === r2.receipt && r2.receipt === r3.receipt,
     "repeat sessions for one job return the SAME receipt id, not fresh budgets");
  const ids = new Set(h.seen.issued.map(i => i.p_id));
  ok(ids.size === 1, `…and only one receipt id ever reached the store (got ${ids.size})`);
  ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r1.receipt),
     "…still a well-formed uuid, so the column and the client checks are satisfied");
}
{
  // Same for the free refine path, where the incentive to loop is strongest.
  const h = harness({ owns: true });
  const body = { talkId: "019f71d1-972b-4bce-b19a-0d04fec960bb" };
  const a = await (await worker.fetch(post("/v1/free-tier/refine-session", body), h.env, ctx)).json();
  const b = await (await worker.fetch(post("/v1/free-tier/refine-session", body), h.env, ctx)).json();
  globalThis.fetch = realFetch;
  ok(a.receipt === b.receipt, "repeat refine sessions for one talk return the SAME receipt");
  ok(new Set(h.seen.issued.map(i => i.p_id)).size === 1,
     "…so a loop cannot replenish the refine budget");
}

// ── 13 · MODELS ARE AUTHORISED PER STAGE, NOT PER RECEIPT ────────────────────
// The flat union was the FIRST fix for the 402s and it broke something worse: a talk receipt must
// authorise Opus for draft AND Haiku for the citation audit, so the flat list held both — authorising
// HAIKU FOR THE DRAFT. That defeats WRITER_CLEARED, whose whole purpose is that clinical prose comes
// from a benchmarked writer.
//
// Verified against the live database as well:
//   draft + Opus  -> ok
//   draft + Haiku -> model_not_authorised_for_stage
//   aux   + Haiku -> ok
{
  const h = harness();
  await worker.fetch(post("/v1/free-tier/session", {}), h.env, ctx);
  globalThis.fetch = realFetch;

  const stages = h.seen.issued[0].p_stages;
  ok(Array.isArray(stages.draft.models), "each stage carries its own model list");
  ok(!stages.draft.models.includes("claude-haiku-4-5-20251001"),
     "…and the DRAFT stage does NOT authorise the aux model");
  ok(!stages.refine.models.includes("claude-haiku-4-5-20251001"),
     "…nor does REFINE, which is also medical prose");
  ok(stages.aux.models.includes("claude-haiku-4-5-20251001"),
     "…while AUX does, because classification on a cheap model is appropriate");
  ok(stages.draft.models.includes("claude-opus-5"), "…and draft still authorises the writer");

  const wsrc = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const code = wsrc.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  ok(/models: stageModelsFor\(name\)/.test(code), "the stage's models are written into the receipt");
  ok(/draft:\s*WRITER_CLEARED/.test(code) && /refine:\s*WRITER_CLEARED/.test(code),
     "…with draft and refine pinned to the benchmarked writers");
}

// ── 14 · TALK RECEIPTS ARE PERMANENT; REFINE RENEWS ATOMICALLY ────────────────
// The time-window derivation this replaced renewed TALK budgets too (one credit, a fresh draft budget
// every 30 minutes) and produced OVERLAPPING valid receipts across boundaries. Both were worse than the
// expired-refine bug it fixed. The id is now permanent; renewal is explicit, refine-only, and atomic.
{
  const wsrc = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const code = wsrc.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");

  ok(!/receiptWindow/.test(code), "the time-window derivation is GONE, not merely unused");
  ok(/ct-receipt:v3:\$\{userId\}:\$\{jobId\}:\$\{kind\}/.test(code),
     "…the id is derived from (user, job, kind) with no time component");
  ok(/kind === "refine"/.test(code) && /receipt_renew_refine/.test(code),
     "…and only REFINE goes through the atomic renewal");
  const mint = code.slice(code.indexOf("async function mintReceipt"));
  const idxRenew = mint.indexOf("receipt_renew_refine");
  const idxIssue = mint.indexOf('"receipt_issue"');
  ok(idxRenew > 0 && idxIssue > idxRenew,
     "…while talk receipts stay on insert-once receipt_issue, never renewed");

  // Verified live: created -> still_valid (used stays 1) -> renewed (used 0) -> not_owner.
  // The renewal lives in its own migration — one migration, one transaction, one concern (the atomicity
  // guard enforces that, and caught it when this was appended to the file above).
  const sql = readFileSync(new URL("./supabase/migrations/receipt_renew_refine.sql", import.meta.url), "utf8");
  const scode = sql.split("\n").filter(l => !/^\s*--/.test(l)).join("\n");
  ok(/expires_at <= now\(\)/.test(scode),
     "the checked-in renewal only fires once the previous receipt has EXPIRED");
  ok(/update public\.generation_receipts[\s\S]{0,400}expires_at <= now\(\)/.test(scode),
     "…in a single UPDATE, so two renewals cannot both win and overlap");
  ok(/not_owner/.test(scode), "…and refuses a renewal requested by anyone else");
}

// ── 15 · THE MIGRATION CARRIES THE PER-STAGE ENFORCEMENT ─────────────────────
// Applied to production with apply_migration but the CHECKED-IN file is what a rebuild replays. This is
// the third time repo-vs-production drift has been the finding, hence the assertion rather than trust.
{
  const sql = readFileSync(new URL("./supabase/migrations/receipt_redeem_per_stage_models.sql", import.meta.url), "utf8");
  const code = sql.split("\n").filter(l => !/^\s*--/.test(l)).join("\n");
  ok(/stages -> p_stage\) \? 'models'/.test(code),
     "the checked-in redeem prefers the STAGE's own model list");
  ok(/model_not_authorised_for_stage/.test(code),
     "…and reports a stage-specific refusal");
  ok(/p_model = any\(r\.allowed_models\)/.test(code),
     "…while keeping the flat fallback for receipts already in flight");
  ok(/begin;[\s\S]*commit;/.test(code), "…and the migration is transactional");
}

// ══ THE THREE MINIMAL-PASS INVARIANTS (Codex, frozen scope) ═════════════════════════════════════════
//
// ── I · FREE TIER IS WORKFLOW-ONLY, AND REFUSES BEFORE CHARGING ──────────────
{
  const mk = (bindings) => ({
    ALLOWED_ORIGINS: ORIGIN, SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "k",
    SUPABASE_ANON_KEY: "a", ANTHROPIC_API_KEY: "sk", FREE_TALKS: "10", ...bindings,
  });
  const submit = () => new Request("https://p.test/generate-async", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Supabase-Auth": "t" },
    body: JSON.stringify({ clientJobId: "11111111-2222-3333-4444-555555555555", topic: "x",
                           style: "lecture", depth: "concise", system: "s",
                           messages: [{ role: "user", content: "go" }], model: "claude-opus-5" }),
  });
  const kv = () => ({ get: async () => null, put: async () => {}, delete: async () => {} });

  for (const [label, bindings] of [
    ["GEN_WORKFLOW missing", { JOBS_KV: kv() }],
    ["JOBS_KV missing",      { GEN_WORKFLOW: { create: async () => {}, get: async () => null } }],
    ["both missing",         {}],
  ]) {
    let reserved = 0;
    globalThis.fetch = async (u) => {
      if (String(u).includes("/auth/v1/user")) return json({ id: "u-1", email: "j@t.dev" });
      if (String(u).includes("/rpc/reserve_talk_for_job")) { reserved++; return json([{ reserved: true, outcome: "reserved" }]); }
      return json([]);
    };
    const res = await worker.fetch(submit(), mk(bindings), ctx);
    const b = await res.json();
    globalThis.fetch = realFetch;
    ok(res.status === 503, `${label} -> 503 (got ${res.status})`);
    ok((b.error && b.error.type) === "async_unconfigured", `…as async_unconfigured`);
    ok(reserved === 0, `…and ZERO credits reserved — refused before charging`);
  }
}

// ── II · A SUCCESSFUL START RETURNS ONE WORKING RECEIPT WITH ITS REAL EXPIRY ──
{
  const created = [];
  let mintedBeforeStart = null;
  globalThis.fetch = async (u, i) => {
    const su = String(u);
    if (su.includes("/auth/v1/user")) return json({ id: "u-1", email: "j@t.dev" });
    if (su.includes("/rpc/reserve_talk_for_job")) return json([{ reserved: true, outcome: "reserved", owner_id: "u-1" }]);
    if (su.includes("/rpc/receipt_issue")) { mintedBeforeStart = created.length === 0; return json(null); }
    return json([]);
  };
  const env = {
    ALLOWED_ORIGINS: ORIGIN, SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "k",
    SUPABASE_ANON_KEY: "a", ANTHROPIC_API_KEY: "sk", FREE_TALKS: "10",
    JOBS_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
    GEN_WORKFLOW: { create: async (o) => { created.push(o); }, get: async () => null },
  };
  const res = await worker.fetch(new Request("https://p.test/generate-async", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Supabase-Auth": "t" },
    body: JSON.stringify({ clientJobId: "22222222-3333-4444-5555-666666666666", topic: "x",
                           style: "lecture", depth: "concise", system: "s",
                           messages: [{ role: "user", content: "go" }], model: "claude-opus-5" }),
  }), env, ctx);
  const b = await res.json();
  globalThis.fetch = realFetch;

  ok(res.status === 200, `a good start succeeds (got ${res.status})`);
  ok(!!b.receipt, "…returning a receipt");
  ok(b.durable === true, "…on the durable path");
  ok(mintedBeforeStart === true,
     "…MINTED BEFORE Workflow.create(), so a mint failure cannot leave a paid job unauthorised");
  ok(!!b.receiptExpiresAt && !Number.isNaN(Date.parse(b.receiptExpiresAt)),
     `…with an ABSOLUTE expiry (${b.receiptExpiresAt})`);
  ok(Date.parse(b.receiptExpiresAt) > Date.now(), "…in the future");
  ok(created.length === 1, "…and exactly one Workflow instance created");
}

// ── III · STARTUP FAILURE LEAVES NO AUTHORISED ORPHAN ────────────────────────
{
  for (const [label, failAt] of [["receipt mint fails", "mint"], ["Workflow.create fails", "create"]]) {
    const calls = { aborts: [], deleted: [] };
    globalThis.fetch = async (u, i) => {
      const su = String(u);
      if (su.includes("/auth/v1/user")) return json({ id: "u-1", email: "j@t.dev" });
      if (su.includes("/rpc/reserve_talk_for_job")) return json([{ reserved: true, outcome: "reserved", owner_id: "u-1" }]);
      if (su.includes("/rpc/receipt_issue")) {
        if (failAt === "mint") return json({ message: "store down" }, 500);
        return json(null);
      }
      if (su.includes("/rpc/abort_generation")) {
        try { calls.aborts.push(JSON.parse(i.body)); } catch (_) {}
        return json([{ aborted: true, refunded: true, outcome: "aborted_and_refunded" }]);
      }
      return json([]);
    };
    const env = {
      ALLOWED_ORIGINS: ORIGIN, SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "k",
      SUPABASE_ANON_KEY: "a", ANTHROPIC_API_KEY: "sk", FREE_TALKS: "10",
      JOBS_KV: { get: async () => null, put: async () => {},
                 delete: async (k) => { calls.deleted.push(k); } },
      GEN_WORKFLOW: {
        create: async () => { if (failAt === "create") throw new Error("workflows down"); },
        get: async () => { throw new Error("unknown id"); },   // confirms it is NOT a duplicate
      },
    };
    const res = await worker.fetch(new Request("https://p.test/generate-async", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Supabase-Auth": "t" },
      body: JSON.stringify({ clientJobId: "33333333-4444-5555-6666-777777777777", topic: "x",
                             style: "lecture", depth: "concise", system: "s",
                             messages: [{ role: "user", content: "go" }], model: "claude-opus-5" }),
    }), env, ctx);
    globalThis.fetch = realFetch;

    ok(res.status >= 500, `${label} -> non-2xx (got ${res.status})`);
    ok(calls.aborts.length === 1,
       `…abort_generation called exactly once (got ${calls.aborts.length})`);
    ok(calls.deleted.some(k => k.startsWith("job:")),
       "…the job record removed, so nothing runnable is left");
    ok(calls.deleted.some(k => k.startsWith("jobbody:")),
       "…and the stored prompt removed too");
  }

  // The cleanup RPC must revoke the receipt AND refund in one transaction, not two.
  const sql = readFileSync(new URL("./supabase/migrations/abort_generation.sql", import.meta.url), "utf8");
  const scode = sql.split("\n").filter(l => !/^\s*--/.test(l)).join("\n");
  ok(/delete from public\.generation_receipts/.test(scode), "abort revokes the receipt");
  ok(/insert into public\.refunded_jobs/.test(scode), "…and refunds, exactly once");
  ok(/already_delivered/.test(scode), "…refusing to refund a delivered job");
  ok(/not_owner/.test(scode), "…or another user's job");
  ok(/begin;[\s\S]*commit;/.test(scode), "…in one transaction");
}

// ── IV · THE CLIENT NEVER FALLS BACK TO A RECEIPTLESS SYNC CALL ──────────────
{
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const hcode = html.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  ok(/if \(!\(_job && _job\.jobId\)\)/.test(hcode),
     "a failed async submit STOPS the generation instead of continuing");
  ok(/Nothing was charged/.test(hcode), "…telling the user nothing was charged");
  const sub = hcode.slice(hcode.indexOf("async function submitAsyncGeneration"));
  const subBody = sub.slice(0, sub.indexOf("\nasync function"));
  ok(!/return null/.test(subBody),
     "…and submitAsyncGeneration returns a tagged error rather than null for every failure");
  ok((subBody.match(/error:true/g) || []).length >= 3,
     "…covering unconfigured, quota, and generic HTTP failures");
}

console.log("\n" + (failures === 0 ? "✔ RECEIPT SESSION OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
