// THE UNAUTHENTICATED APP-FUNDED PATH IS CLOSED — run: node test_legacy_path_metering.mjs
//
// (Filename kept so CI wiring and history stay continuous. What it asserts has inverted.)
//
// ── HISTORY, BECAUSE THE REASONING CHANGED TWICE ────────────────────────────────────────────────────
// v1  The legacy/demo branch of POST /v1/messages spent ANTHROPIC_API_KEY with no cap and no ledger.
//     Reaching it required only OMITTING the X-Supabase-Auth header. Its stated guard was a per-IP
//     counter that does nothing, because RATE_LIMIT_KV is unbound.
//
// v2  I capped and metered it rather than closing it, arguing that "no caller I can find" is not "no
//     caller" and that silently 403-ing an unknown client was the worse failure.
//
// v3  Codex asked the question that settles it: does that path spend the app's key? It does. And his
//     rule follows — every request spending an app-funded key requires server-issued authorisation,
//     regardless of headers or claimed intent. Metering bounded the COST; it left the path
//     UNAUTHORISED. My v2 reasoning is sound for a bounded path and wrong for an unauthorised one.
//
// Verified before closing, rather than assumed:
//   * the Worker NEVER reads a caller-supplied key — it only ever sends env.ANTHROPIC_API_KEY;
//   * the shipped client's BYOK mode calls api.anthropic.com DIRECTLY and never touches this Worker.
// So "only true BYOK may bypass the receipt" holds trivially: nothing reaching this endpoint is BYOK,
// therefore everything reaching it must be authorised.
import worker from "./worker.js";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const ORIGIN = "http://localhost:8000";
const realFetch = globalThis.fetch;
const ctx = { waitUntil() {} };

function harness() {
  const calls = { anthropic: 0 };
  const env = {
    ALLOWED_ORIGINS: ORIGIN,
    ANTHROPIC_API_KEY: "sk-app-funded",
    SUPABASE_URL: "https://x.test",
    SUPABASE_SERVICE_ROLE_KEY: "k",
    MAX_MONTHLY_SPEND_USD: "250",
    JOBS_KV: { get: async () => null, put: async () => {}, delete: async () => {} },
  };
  globalThis.fetch = async (url) => {
    if (String(url).includes("api.anthropic.com")) {
      calls.anthropic++;
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { env, calls };
}

const req = (headers = {}) => new Request("https://p.test/v1/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: ORIGIN, ...headers },
  body: JSON.stringify({ model: "claude-opus-5", messages: [{ role: "user", content: "manage DKA" }] }),
});

// ── 1 · THE BYPASS: no token, labelled aux ───────────────────────────────────
// This is the exact shape Codex described — omit the sign-in token, claim it is auxiliary, send a
// medical prompt. It used to reach the app key.
{
  const h = harness();
  const res = await worker.fetch(req({ "X-CT-Meter": "aux" }), h.env, ctx);
  const body = await res.json();
  globalThis.fetch = realFetch;
  ok(res.status === 401, `an unauthenticated aux request is REFUSED (got ${res.status})`);
  ok((body.error && body.error.type) === "authorisation_required", "…with authorisation_required");
  ok(h.calls.anthropic === 0, "…and the app-funded key was NOT spent — the assertion that matters");
}

// ── 2 · No header games help ─────────────────────────────────────────────────
{
  for (const headers of [
    {},
    { "X-CT-Meter": "talk" },
    { "X-CT-Meter": "aux", "X-CT-Receipt": "made-up" },
    { "X-CT-Meter": "aux", "X-CT-Stage": "draft", "X-CT-Job": "j" },
  ]) {
    const h = harness();
    const res = await worker.fetch(req(headers), h.env, ctx);
    globalThis.fetch = realFetch;
    ok(res.status === 401 && h.calls.anthropic === 0,
       `refused with zero spend: ${JSON.stringify(headers) || "{}"}`);
  }
}

// ── 3 · The refusal names both legitimate routes ─────────────────────────────
// A caller who genuinely turns up should not be stonewalled into guessing.
{
  const h = harness();
  const body = await (await worker.fetch(req(), h.env, ctx)).json();
  globalThis.fetch = realFetch;
  const d = (body.error && body.error.detail) || {};
  ok(/sign in/i.test(d.free_tier || ""), "the error points to the free tier");
  ok(/own key/i.test(d.byok || ""), "…and to BYOK");
  ok(/directly/i.test(body.error.message || ""), "…noting that a personal key does not use this proxy");
}

// ── 4 · The code is GONE, not commented out ──────────────────────────────────
// An unreachable block that spends an API key is an invitation: someone re-enables it later without
// re-deriving why it was closed.
{
  const src = (await import("fs")).readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const code = src.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
  const anthropicCalls = (code.match(/fetch\("https:\/\/api\.anthropic\.com/g) || []).length;
  ok(anthropicCalls === 2,
     `exactly two call sites to Anthropic remain (found ${anthropicCalls}): the authorised free-tier ` +
     "branch, and callAnthropicText which only the Workflow runner reaches");
  ok(!/Legacy \/ demo path/.test(code), "the legacy branch is deleted from the code path");
  ok(/deleted, not commented out/.test(src), "…and the source says so, with the reason");
}

console.log("\n" + (failures === 0 ? "✔ UNAUTHENTICATED APP-FUNDED PATH IS CLOSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
