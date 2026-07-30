// SERVER-SIDE WRITER ALLOWLIST + QUOTA RECEIPT — run: node test_writer_and_quota_gates.mjs
//
// Two bypasses Codex found, both on the SYNCHRONOUS /v1/messages route, both invisible from the async
// runner where the equivalent guards do exist:
//
//   1. WRITER ALLOWLIST. `callAnthropicText` fails closed against WRITER_CLEARED — but that is the async
//      path only. This endpoint validated ALLOWED_MODELS, which deliberately includes older and cheaper
//      models for utility calls, so a tampered client could have an unbenchmarked model write medical
//      teaching content while the file header said generation FAILS CLOSED. It did, on one of two routes.
//
//   2. QUOTA. Quota is consumed by POST /v1/free-tier/consume, which the front end calls before
//      generating. This endpoint checked authentication and then trusted that it had happened. A caller
//      who skipped the app could generate with zero talks left, and the per-IP fallback does not stop it
//      because RATE_LIMIT_KV is unbound.
//
// Both are executed here against the real handler. Counting the upstream calls is the assertion that
// matters: a gate that returns the right status code while still spending money is not a gate.
import worker from "./worker.js";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const ORIGIN = "http://localhost:8000";
const realFetch = globalThis.fetch;

function harness({ quotaOk = true } = {}) {
  const kv = new Map();
  const calls = { anthropic: 0, consume: 0 };
  const env = {
    ALLOWED_ORIGINS: ORIGIN, ANTHROPIC_API_KEY: "sk-test",
    SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "k",
    MAX_MONTHLY_SPEND_USD: "250",
    JOBS_KV: {
      get: async (k) => kv.get(k) ?? null,
      put: async (k, v) => { kv.set(k, v); },
      delete: async (k) => { kv.delete(k); },
    },
  };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) {
      calls.anthropic++;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: {} }),
                          { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "u1", email: "a@b.c" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("free_tier_consume")) {
      calls.consume++;
      return new Response(String(quotaOk), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { env, calls, kv };
}

const ctx = { waitUntil() {} };

function msg({ model = "claude-opus-5", kind = "talk", receipt = null, auth = "t" } = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN, "X-CT-Meter": kind };
  if (auth) headers["X-Supabase-Auth"] = auth;
  if (receipt) headers["X-CT-Receipt"] = receipt;
  return new Request("https://p.test/v1/messages", {
    method: "POST", headers,
    body: JSON.stringify({ model, messages: [{ role: "user", content: "write me a talk" }] }),
  });
}

async function mintReceipt(env) {
  const res = await worker.fetch(new Request("https://p.test/v1/free-tier/consume", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Supabase-Auth": "t" },
    body: JSON.stringify({ kind: "talk" }),
  }), env, ctx);
  return (await res.json()).receipt;
}

// ── 1 · WRITER ALLOWLIST ─────────────────────────────────────────────────────
{
  const h = harness();
  const receipt = await mintReceipt(h.env);
  ok(!!receipt, "/consume issues a receipt when a talk is paid for");

  h.calls.anthropic = 0;
  const bad = await worker.fetch(msg({ model: "claude-sonnet-4-20250514", receipt }), h.env, ctx);
  const body = await bad.json();
  ok(bad.status === 403, `an uncleared model is REFUSED for talk content (got ${bad.status})`);
  ok((body.error && body.error.type) === "writer_not_cleared", "…with writer_not_cleared");
  ok(h.calls.anthropic === 0, "…and nothing was spent upstream");

  // Haiku too — it is on ALLOWED_MODELS for utility work and must not write teaching content.
  const haiku = await worker.fetch(msg({ model: "claude-haiku-4-5-20251001", receipt }), h.env, ctx);
  ok(haiku.status === 403, "…the same for Haiku, which ALLOWED_MODELS permits for utility calls");

  const good = await worker.fetch(msg({ model: "claude-opus-5", receipt }), h.env, ctx);
  ok(good.status === 200, "a CLEARED writer is allowed through");
  ok(h.calls.anthropic === 1, "…and reaches Anthropic exactly once");
  globalThis.fetch = realFetch;
}

// ── 2 · UTILITY CALLS ARE UNAFFECTED ─────────────────────────────────────────
// ALLOWED_MODELS includes cheaper models deliberately: podcast scripts, diagram prompts, chat. Gating
// those on WRITER_CLEARED would break real features to protect against nothing.
{
  const h = harness();
  const aux = await worker.fetch(msg({ model: "claude-haiku-4-5-20251001", kind: "aux" }), h.env, ctx);
  ok(aux.status === 200, "a non-talk utility call with an uncleared model still works");
  ok(h.calls.anthropic === 1, "…and reaches Anthropic");
  globalThis.fetch = realFetch;
}

// ── 3 · THE QUOTA BYPASS ─────────────────────────────────────────────────────
// The whole finding: a signed-in caller skipping the front end.
{
  const h = harness();
  h.calls.anthropic = 0;
  const noReceipt = await worker.fetch(msg({ receipt: null }), h.env, ctx);
  const b = await noReceipt.json();
  ok(noReceipt.status === 402, `a talk with NO receipt is refused (got ${noReceipt.status})`);
  ok((b.error && b.error.type) === "receipt_required", "…with receipt_required");
  ok(h.calls.anthropic === 0, "…having spent nothing — the point of the gate");

  const forged = await worker.fetch(msg({ receipt: "not-a-real-receipt" }), h.env, ctx);
  ok(forged.status === 402, "a forged receipt is refused");
  ok(h.calls.anthropic === 0, "…and still spends nothing");
  globalThis.fetch = realFetch;
}

// ── 4 · A RECEIPT BELONGS TO THE USER WHO PAID FOR IT ────────────────────────
// Otherwise one person's receipt authorises another's generation — the same bypass wearing the fix's
// clothes.
{
  const h = harness();
  const receipt = await mintReceipt(h.env);
  // Re-point auth at a DIFFERENT user, receipt unchanged.
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) { h.calls.anthropic++; return new Response("{}", { status: 200 }); }
    if (u.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "SOMEONE_ELSE", email: "z@z.z" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  h.calls.anthropic = 0;
  const stolen = await worker.fetch(msg({ receipt }), h.env, ctx);
  const sb = await stolen.json();
  ok(stolen.status === 402, "another user's receipt is refused");
  ok(sb.error && sb.error.detail && sb.error.detail.reason === "wrong_owner", "…for the right reason");
  ok(h.calls.anthropic === 0, "…and spends nothing");
  globalThis.fetch = realFetch;
}

// ── 5 · ONE RECEIPT COVERS A GENERATION, NOT ONE CALL — BUT IS BOUNDED ───────
// A generation makes several calls (draft, review, retries, fallbacks). Charging a talk per call would
// burn a user's whole quota on one generation; unlimited calls would make the receipt meaningless.
{
  const h = harness();
  const receipt = await mintReceipt(h.env);
  h.calls.anthropic = 0;
  let okCount = 0, refused = 0;
  for (let i = 0; i < 20; i++) {
    const r = await worker.fetch(msg({ receipt }), h.env, ctx);
    if (r.status === 200) okCount++; else refused++;
  }
  ok(okCount > 1, `one receipt covers multiple calls (${okCount}) — a generation is not a single call`);
  ok(refused > 0, `…but is bounded: ${refused} of 20 refused once exhausted`);
  ok(h.calls.anthropic === okCount, "…and upstream spend matches exactly the calls that were allowed");
  globalThis.fetch = realFetch;
}

// ── 6 · THE SOURCE SAYS WHAT THESE GATES ARE, AND ARE NOT ───────────────────
{
  const src = (await import("fs")).readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  ok(/X-CT-Meter is supplied by the client/.test(src),
     "the writer allowlist states plainly that the header is client-supplied");
  ok(/it is NOT an authorisation control/.test(src),
     "…and that it is not an authorisation control on its own");
  ok(/receipt/i.test(src.slice(src.indexOf("SERVER-SIDE WRITER ALLOWLIST"), src.indexOf("SERVER-SIDE WRITER ALLOWLIST") + 1600)),
     "…naming the receipt as the thing that makes it real");
  ok(/JOBS_KV is not bound, so quota is unenforceable here/.test(src),
     "the one deliberate degradation — no KV, no receipt store — is logged rather than silent");
}

console.log("\n" + (failures === 0 ? "✔ WRITER + QUOTA GATE TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
