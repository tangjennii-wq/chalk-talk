// CORS PREFLIGHT COVERS EVERY HEADER THE CLIENT SENDS — run: node test_cors_preflight.mjs
//
// ── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────────────────────────────
// Found in production, 2026-07-31, during the first real free-tier smoke test:
//
//   Access to fetch at '.../v1/messages' from origin 'https://tangjennii-wq.github.io' has been
//   blocked by CORS policy: Request header field x-ct-stage is not allowed by
//   Access-Control-Allow-Headers in preflight response.
//
// The receipt work added X-CT-Receipt / X-CT-Job / X-CT-Stage to the CLIENT and never to the Worker's
// Access-Control-Allow-Headers. Every browser-side /v1/messages call was rejected at preflight — before
// the request ever reached the handler.
//
// ── WHY 33 SUITES AND 1,300 ASSERTIONS ALL PASSED ───────────────────────────────────────────────────
// Nothing in the suite speaks CORS. Preflight is a BROWSER behaviour: the Node tests call
// worker.fetch(new Request(...)) directly, where any custom header simply arrives. The authorisation
// tests were passing X-CT-Receipt and asserting it was honoured, on a request path a browser could
// never have made.
//
// Production masked it too. The durable path runs generation inside the Workflow, server-side, so a
// talk still generated end to end — while the client-side aux calls (citation audit, images,
// check-for-updates) failed with a bare "Network hiccup" that named nothing.
//
// The lesson generalises past this one header: a client header is only real if the preflight allows it,
// so the two lists must be checked against each other rather than maintained in parallel by hand.
import worker from "./worker.js";
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const ORIGIN = "https://tangjennii-wq.github.io";
const env = { ALLOWED_ORIGINS: ORIGIN + ",http://localhost:8000" };
const ctx = { waitUntil() {} };

const preflight = async (requestHeaders, path = "/v1/messages") =>
  worker.fetch(new Request("https://p.test" + path, {
    method: "OPTIONS",
    headers: {
      Origin: ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": requestHeaders,
    },
  }), env, ctx);

const allowedSet = async () => {
  const res = await preflight("content-type");
  const raw = res.headers.get("Access-Control-Allow-Headers") || "";
  return new Set(raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
};

// ── 1 · THE THREE HEADERS THAT BROKE PRODUCTION ──────────────────────────────
{
  const allow = await allowedSet();
  for (const h of ["x-ct-receipt", "x-ct-job", "x-ct-stage"]) {
    ok(allow.has(h), `preflight allows ${h}`);
  }
  ok(allow.has("x-supabase-auth") && allow.has("content-type") && allow.has("x-ct-meter"),
     "…and the pre-existing headers are still allowed");
}

// ── 2 · EVERY HEADER index.html ACTUALLY SENDS IS ALLOWED ────────────────────
// Derived from the client rather than hard-coded, so a header added there tomorrow fails HERE instead
// of failing silently in a physician's browser. This is the assertion that would have caught it.
{
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const code = html.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");

  // TWO FORMS, and getting this wrong once already made the test worthless.
  // The first version matched only object-literal keys — `{ "X-CT-Meter": ... }` — and found 3 headers.
  // The three that actually broke production are set by BRACKET ASSIGNMENT:
  //     headers["X-CT-Receipt"] = S.genReceipt;
  //     headers["X-CT-Job"]     = S.genJobId;
  //     headers["X-CT-Stage"]   = opts.stage || ...;
  // so this suite would have passed while the outage it was written for went straight through it. A
  // coverage check that silently under-collects is worse than none: it reports safety it never measured.
  const found = new Set();
  for (const re of [
    /["'`](X-[A-Za-z0-9-]+)["'`]\s*:/g,          // { "X-CT-Meter": v }
    /\[\s*["'`](X-[A-Za-z0-9-]+)["'`]\s*\]\s*=/g, // headers["X-CT-Stage"] = v
    /\.set\(\s*["'`](X-[A-Za-z0-9-]+)["'`]/g,     // headers.set("X-CT-Stage", v)
  ]) {
    let m;
    while ((m = re.exec(code))) found.add(m[1].toLowerCase());
  }
  // Guard the guard: if the extraction ever collapses back to a handful, fail loudly rather than
  // quietly asserting over a near-empty set.
  ok(found.size >= 5, `header extraction found ${found.size} X- headers in the client (expected >= 5)`);
  ok(found.has("x-ct-stage") && found.has("x-ct-receipt") && found.has("x-ct-job"),
     "…including the three set by bracket assignment, which the first version of this test missed");

  // Headers the client sends ONLY to third parties (OpenAI, Gemini, Anthropic direct in BYOK mode)
  // never traverse this Worker, so they are not preflighted against it.
  const THIRD_PARTY = new Set([
    "x-api-key",              // Anthropic direct, BYOK
    "x-goog-api-key",         // Gemini
    "x-requested-with",
  ]);

  const allow = await allowedSet();
  const missing = [...found].filter(h => !THIRD_PARTY.has(h) && !allow.has(h));
  ok(missing.length === 0,
     missing.length
       ? `client sends header(s) the preflight rejects: ${missing.join(", ")}`
       : `every X- header the client sends (${found.size} found) is allowed by the preflight`);
}

// ── 3 · A REAL PREFLIGHT FOR THE EXACT FAILING REQUEST ───────────────────────
// The literal shape from the console error, asserted end to end.
{
  const res = await preflight("content-type,x-supabase-auth,x-ct-meter,x-ct-receipt,x-ct-job,x-ct-stage");
  ok(res.status >= 200 && res.status < 300, `preflight for the full free-tier header set succeeds (${res.status})`);
  ok((res.headers.get("Access-Control-Allow-Origin") || "") === ORIGIN,
     "…and echoes the deployed origin");

  const allow = (res.headers.get("Access-Control-Allow-Headers") || "").toLowerCase();
  const requested = ["content-type","x-supabase-auth","x-ct-meter","x-ct-receipt","x-ct-job","x-ct-stage"];
  const rejected = requested.filter(h => !allow.includes(h));
  ok(rejected.length === 0,
     rejected.length ? `browser would reject: ${rejected.join(", ")}` : "…and a browser would send the request");
}

// ── 4 · THE ALLOW-LIST IS NOT A FREE-FOR-ALL ─────────────────────────────────
// Fixing a preflight failure with a wildcard would end this class of bug by removing the control.
{
  const allow = (await preflight("content-type")) .headers.get("Access-Control-Allow-Headers") || "";
  ok(!allow.includes("*"), "Access-Control-Allow-Headers is an explicit list, not *");
  const origin = (await preflight("content-type")).headers.get("Access-Control-Allow-Origin") || "";
  ok(origin !== "*", "Access-Control-Allow-Origin is not * (credentials-bearing requests)");
}

// ── 5 · AN UNKNOWN ORIGIN IS STILL REFUSED ───────────────────────────────────
{
  const res = await worker.fetch(new Request("https://p.test/v1/messages", {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST",
               "Access-Control-Request-Headers": "x-ct-stage" },
  }), env, ctx);
  const o = res.headers.get("Access-Control-Allow-Origin") || "";
  ok(o !== "https://evil.example", "an origin outside the allowlist is not echoed back");
}

console.log("\n" + (failures === 0 ? "✔ CORS PREFLIGHT OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
