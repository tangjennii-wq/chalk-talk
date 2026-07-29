// LEGACY PATH METERING — run: node test_legacy_path_metering.mjs
//
// WHY THIS EXISTS (2026-07-29 audit). The legacy/demo branch of POST /v1/messages spends
// ANTHROPIC_API_KEY. It checked no monthly cap and wrote no ledger row, so its spend was uncapped AND
// invisible to the cap every other path respects. Its only stated guard was the per-IP daily counter,
// and that counter does nothing: RATE_LIMIT_KV is not bound in wrangler.toml, so readDailyCount always
// returns 0 while /health advertises the limit as enforced with full headroom.
//
// Reaching it requires only OMITTING the X-Supabase-Auth header. Origin is checked, but Origin is
// client-supplied and trivially set by any non-browser client.
//
// The path was NOT closed — no shipped frontend uses it (PROXY_CONFIG.enabled is false on both main and
// launch-integration) but "no caller I can find" is not "no caller". It was metered instead, which is
// strictly additive: existing callers keep working, spend becomes visible, and it stops at the same
// backstop as everything else.
//
// THIS TEST EXECUTES THE HANDLER. `node --check` cannot catch what went wrong on the first attempt: I
// referenced `meterKind` and `monthKey`, both const-scoped to the free-tier branch, which is a
// ReferenceError at runtime and not a syntax error. Importing the module does not catch it either,
// because the handler body never runs. Only calling it does.
import worker from "./worker.js";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const ORIGIN = "http://localhost:8000";
const realFetch = globalThis.fetch;

function makeEnv(overrides = {}) {
  return {
    ALLOWED_ORIGINS: ORIGIN,
    ANTHROPIC_API_KEY: "sk-test",
    MAX_MONTHLY_SPEND_USD: "250",
    DAILY_LIMIT_PER_IP: "10",
    // Deliberately NO SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, so the free-tier branch is skipped and
    // the request falls through to the legacy path — exactly the condition being tested.
    ...overrides,
  };
}
const ctxCalls = [];
const ctx = { waitUntil: (p) => { ctxCalls.push(p); return p; } };

function req(headers = {}) {
  return new Request("https://proxy.test/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": ORIGIN, ...headers },
    body: JSON.stringify({ model: "claude-opus-5", messages: [{ role: "user", content: "hi" }] }),
  });
}

// ── 1 · the legacy path RUNS — no ReferenceError from the metering I added ────
{
  ctxCalls.length = 0;
  let upstreamCalled = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.anthropic.com")) {
      upstreamCalled = true;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 10, output_tokens: 5 } }),
                          { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  let res, threw = null;
  try { res = await worker.fetch(req(), makeEnv(), ctx); }
  catch (e) { threw = e; }
  globalThis.fetch = realFetch;

  ok(threw === null, `the legacy path executes without throwing${threw ? " — " + threw.message : ""}`);
  ok(!!res && res.status === 200, "…and returns the upstream response");
  ok(upstreamCalled, "…having actually called Anthropic");
  // The metering is scheduled via ctx.waitUntil. Before this fix there was exactly one (the daily
  // counter); there must now also be a meterCost.
  ok(ctxCalls.length >= 2, `…and schedules metering as well as the counter (${ctxCalls.length} tasks)`);
}

// ── 2 · the monthly cap now applies to this path ─────────────────────────────
// Previously it did not exist here at all: the branch went straight to fetch.
{
  ctxCalls.length = 0;
  let anthropicCalled = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.anthropic.com")) { anthropicCalled = true; return new Response("{}", { status: 200 }); }
    // getMonthlySpendCents reads the ledger via PostgREST — report the cap as already blown.
    return new Response(JSON.stringify([{ total_cents: 999999 }]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const res = await worker.fetch(req(), makeEnv({ SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "k", }), ctx)
    .catch(e => ({ status: 0, err: e }));
  globalThis.fetch = realFetch;
  // NB: with SUPABASE_* set AND no auth header, the free-tier branch is skipped (it requires the token),
  // so this still exercises the legacy path — now with a reachable ledger.
  ok(res.status === 503, `an exhausted cap stops the legacy path too (got ${res.status})`);
  ok(!anthropicCalled, "…before spending anything upstream");
}

// ── 3 · the source states what it did NOT do, and why ────────────────────────
// The path is still open. A future reader must not have to infer that from its absence.
{
  const src = (await import("fs")).readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const legacy = src.slice(src.indexOf("Legacy / demo path"), src.indexOf("const respHeaders"));
  ok(/RATE_LIMIT_KV is not\s*\n?\s*\/\/ bound|RATE_LIMIT_KV is not/.test(legacy),
     "the comment records that the per-IP guard is non-functional, not merely weak");
  ok(/did NOT close this path/.test(legacy),
     "…and that leaving it open was a decision, with its reason");
  ok(/getMonthlySpendCents\(env, legacyMonthKey\)/.test(legacy), "the cap check is present");
  ok(/meterCost\(env, upstream\.clone\(\)/.test(src.slice(src.indexOf("Legacy / demo path"))),
     "the ledger write is present");
}

console.log("\n" + (failures === 0 ? "✔ LEGACY PATH METERING TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
