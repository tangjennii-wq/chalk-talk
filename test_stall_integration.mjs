// STALL: WORKER RESPONSE -> BROWSER POLLER — run: node test_stall_integration.mjs
//
// WHY THIS EXISTS (Codex, 2026-07-29). I added `stalled: true` to /generate-status, wrote a test that
// pattern-matched worker.js, and reported that the failure was now visible to the user. It was not.
// `pollAsyncGeneration()` in index.html reads only `done`, `error` and `cancelled` — everything else
// falls through to "still running". So the spinner kept turning until the nine-minute poll timeout, and
// my test certified an API field that no consumer read.
//
// That is exactly the defect class this whole session has been about: an instrument reporting success
// it had not earned. Pattern-matching one side of a contract cannot show the contract holds.
//
// So this test EXECUTES BOTH SIDES. It runs the real Worker handler to produce a real response, serves
// that response to the real pollAsyncGeneration lifted out of index.html, and asserts what the poller
// actually does with it. Neither half is stubbed by a fixture I wrote to agree with myself.
import { readFileSync } from "fs";
import vm from "vm";
import worker from "./worker.js";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

// ── lift the REAL poller out of index.html ───────────────────────────────────
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const start = html.indexOf("async function pollAsyncGeneration(");
const end = html.indexOf("// RELOAD RECONNECT", start);
ok(start > 0 && end > start, "found pollAsyncGeneration in index.html");
const pollerSrc = html.slice(start, end);

// ── run the REAL worker to get a REAL status response ────────────────────────
const ORIGIN = "http://localhost:8000";
const jobs = new Map();
const env = {
  ALLOWED_ORIGINS: ORIGIN, SUPABASE_URL: "https://x.test", SUPABASE_SERVICE_ROLE_KEY: "k",
  JOBS_KV: { get: async k => jobs.get(k) ?? null, put: async (k, v) => { jobs.set(k, v); } },
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => String(u).includes("/auth/v1/user")
  ? new Response(JSON.stringify({ id: "u1", email: "a@b.c" }), { status: 200, headers: { "Content-Type": "application/json" } })
  : new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });

async function statusFor(job) {
  jobs.set("job:j1", JSON.stringify(job));
  const res = await worker.fetch(
    new Request("https://p.test/generate-status/j1", { headers: { Origin: ORIGIN, "X-Supabase-Auth": "t" } }),
    env, { waitUntil() {} });
  return { status: res.status, body: await res.json() };
}

// ── drive the REAL poller with that response ─────────────────────────────────
async function runPoller(statusBody, { httpStatus = 200 } = {}) {
  const ctx = {
    RAG_CONFIG: { url: "https://p.test" },
    ASYNC_GEN_CONFIG: { maxPollMs: 5000, pollMs: 1, jobKey: "k" },
    freeTierToken: () => "t",
    encodeURIComponent, setTimeout, Promise, Date, Error, JSON, console: { warn() {}, log() {} },
    fetch: async () => ({ status: httpStatus, ok: httpStatus < 400, json: async () => statusBody }),
  };
  vm.createContext(ctx);
  return await vm.runInContext(`(async () => {
    ${pollerSrc}
    try { const r = await pollAsyncGeneration("j1", null, null, null); return { resolved: r }; }
    catch (e) { return { error: { message: e.message, code: e.code, idleSeconds: e.idleSeconds } }; }
  })()`, ctx, { timeout: 10000 });
}

const OLD = new Date(Date.now() - 240_000).toISOString();
const NOW = new Date().toISOString();

// ── 1 · a KILLED job: worker flags it, and the poller ACTS on the flag ───────
{
  const { body } = await statusFor({ status: "critique", stage: "critique", userId: "u1", createdAt: OLD, updatedAt: OLD });
  ok(body.stalled === true, "worker flags a 4-minute-idle critique as stalled");

  const out = await runPoller(body);
  ok(!!out.error, "the poller THROWS rather than looping — this is the assertion that was missing");
  ok(out.error && out.error.code === "stalled", `…with code "stalled" (got ${out.error && out.error.code})`);
  ok(out.error && out.error.idleSeconds === body.idle_seconds,
     "…carrying idle_seconds through, so the UI can say how long");
  ok(out.error && out.error.message === body.stall_detail,
     "…and surfacing the SERVER's explanation verbatim, not a generic client string");
}

// ── 2 · a HEALTHY job must not be killed by the new branch ───────────────────
// The failure mode of an over-eager stall check is worse than the bug: it aborts working generations.
{
  const { body } = await statusFor({ status: "running", stage: "drafting", userId: "u1", createdAt: NOW, updatedAt: NOW });
  ok(body.stalled === undefined, "a fresh job is not flagged");
  const out = await runPoller(body);
  // It KEEPS POLLING, so in this harness it eventually hits the deliberately-short maxPollMs and throws
  // "timeout". The property under test is WHICH error: never "stalled" for a healthy job.
  ok(out.error && out.error.code === "timeout",
     `a healthy job keeps polling to the deadline (code ${out.error && out.error.code})`);
  ok(!out.error || out.error.code !== "stalled", "…and is NEVER thrown as stalled");
}

// ── 3 · THE FALSE POSITIVE THE HEARTBEAT EXISTS TO PREVENT ───────────────────
// Critique is one long non-streaming call. Before the heartbeat, `updatedAt` was written once when the
// stage changed and then not again, so a legitimate 90s+ review was indistinguishable from a terminated
// Worker — and the user would have been told their credit was lost while the review was still running.
{
  const beating = { status: "critique", stage: "critique", userId: "u1",
                    createdAt: OLD, updatedAt: OLD, heartbeatAt: NOW };
  const { body } = await statusFor(beating);
  ok(body.stalled === undefined,
     "a LONG critique that is still beating is NOT called stalled, even though updatedAt is 4m old");
  const out = await runPoller(body);
  ok(out.error && out.error.code === "timeout", "…and the poller lets it continue rather than aborting");
  ok(out.error.code !== "stalled", "…so a slow-but-alive review is never reported as dead");

  // …while a stale heartbeat still trips it.
  const dead = await statusFor({ status: "critique", stage: "critique", userId: "u1",
                                 createdAt: OLD, updatedAt: OLD, heartbeatAt: OLD });
  ok(dead.body.stalled === true, "a critique whose heartbeat stopped IS flagged");
}

// ── 4 · the wording must not assert what a status read cannot know ───────────
// The first version said the job "will never finish" and the credit "was not refunded". Neither is
// established from a poll: the runner may be alive, and the refund may yet run.
{
  const { body } = await statusFor({ status: "critique", userId: "u1", createdAt: OLD, updatedAt: OLD });
  const d = String(body.stall_detail);
  ok(!/will never finish/.test(d), "the message no longer asserts the job will never finish");
  ok(!/was reserved and not refunded/.test(d), "…nor that the credit was definitely lost");
  ok(/most likely|may also be/.test(d), "…it is stated probabilistically");
  ok(/not something you did/.test(d), "…while still telling the user this is our defect, not their fault");
}

// ── 5 · the client actually renders it ───────────────────────────────────────
// A thrown error that no branch handles falls through to humanizeError, which says "tap Generate again"
// — wrong advice, and it discards the server's explanation.
{
  ok(/e\.code === "stalled"/.test(html), "generate()'s error handler has an explicit stalled branch");
  const branch = html.slice(html.indexOf('e && e.code === "stalled"'), html.indexOf('e && e.code === "stalled"') + 400);
  ok(/S\.error = e\.message/.test(branch), "…which shows the server's message rather than a generic one");
  ok(/job\.stalled === true/.test(html), "the poller reads job.stalled from the response");
}

globalThis.fetch = realFetch;
console.log("\n" + (failures === 0 ? "✔ STALL INTEGRATION TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
