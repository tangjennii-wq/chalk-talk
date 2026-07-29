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
// STRIP COMMENTS BEFORE ASSERTING ABOUT CODE. Twice in this file a check matched the prose explaining
// the bug rather than the bug: `await beat` appears in a comment quoting the broken pattern, and a
// regex looking for its absence fired on the explanation. Prose must never satisfy — or violate — a
// test about behaviour. (Third occurrence this session; hence a helper rather than another one-off.)
const codeOnly = (src) => src.split("\n").map(l => l.replace(/\/\/.*$/, "")).join("\n");

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
  // Hedged language, matched loosely on purpose: pinning the exact adverb makes this fail on a reword
  // that preserves the property, which is how a test starts obstructing rather than protecting.
  ok(/\blikely\b|\bmay\b|can't be certain/i.test(d), "…it is stated probabilistically");
  ok(/not something you did/.test(d), "…while still telling the user this is our defect, not their fault");
}

// ── 5 · the client actually renders it ───────────────────────────────────────
// A thrown error that no branch handles falls through to humanizeError, which says "tap Generate again"
// — wrong advice, and it discards the server's explanation.
{
  ok(/e\.code === "stalled"/.test(html), "generate()'s error handler has an explicit stalled branch");
  // Take the whole branch, then strip its comments — a fixed character window silently truncated when
  // the explanatory comment grew, which is a test failing for a reason unrelated to the behaviour.
  const bStart = html.indexOf('e && e.code === "stalled"');
  const branch = codeOnly(html.slice(bStart, html.indexOf("} else {", bStart)));
  ok(/S\.error = e\.message/.test(branch), "…which shows the server's message rather than a generic one");
  ok(/job\.stalled === true/.test(html), "the poller reads job.stalled from the response");
}

// ── 6 · THE HEARTBEAT LIFECYCLE ──────────────────────────────────────────────
// The gap that let the worst bug through. Sections 1–5 test the stall CONTRACT; none of them runs the
// heartbeat, so a heartbeat that delayed finalization past Cloudflare's ~30s budget passed everything.
//
// The bug: `while (alive) { await sleep(20s); ... }` with `await beat` in the finally. A sleeping
// promise cannot be interrupted, so a critique finishing at 25s while the beat was mid-sleep held
// finalization until ~40s — the diagnostic killing a generation that had completed inside the window,
// and adding ~10s on average to every talk that survived.
//
// Executed, with the real timing shape scaled down. Asserting on the SHAPE (cancellable, exit adds no
// wait) rather than on the source text, because "it uses setInterval" is not the property that matters.
{
  const HEARTBEAT = 20;   // stands in for CRITIQUE_HEARTBEAT_MS
  const beats = [];

  // The BROKEN pattern, reproduced exactly.
  async function brokenRun(critMs) {
    let alive = true;
    const beat = (async () => {
      while (alive) {
        await new Promise(r => setTimeout(r, HEARTBEAT));
        if (!alive) break;
        beats.push("b");
      }
    })();
    const t0 = Date.now();
    try { await new Promise(r => setTimeout(r, critMs)); }
    finally { alive = false; try { await beat; } catch (_) {} }
    return Date.now() - t0;
  }

  // The FIXED pattern, as now in worker.js.
  async function fixedRun(critMs) {
    let alive = true;
    const timer = setInterval(() => { if (alive) beats.push("b"); }, HEARTBEAT);
    const t0 = Date.now();
    try { await new Promise(r => setTimeout(r, critMs)); }
    finally { alive = false; clearInterval(timer); }
    return Date.now() - t0;
  }

  // A critique finishing just after a beat starts sleeping is the worst case.
  const CRIT = HEARTBEAT + 5;   // 25 — i.e. 5ms into the second sleep
  const brokeMs = await brokenRun(CRIT);
  const fixedMs = await fixedRun(CRIT);

  ok(brokeMs >= HEARTBEAT * 2 - 3,
     `the OLD pattern held finalization to ~${brokeMs}ms for a ${CRIT}ms critique — it awaited the sleep`);
  ok(fixedMs < CRIT + HEARTBEAT / 2,
     `the FIXED pattern returns in ~${fixedMs}ms — clearInterval adds no wait`);
  ok(brokeMs - fixedMs >= HEARTBEAT / 2,
     `…a difference of ~${brokeMs - fixedMs}ms, which at real scale is the 0–20s that could push a ` +
     "completed critique past the ~30s budget");

  // And it must still actually beat during a long critique, or the false-positive fix is undone.
  beats.length = 0;
  await fixedRun(HEARTBEAT * 3 + 5);
  ok(beats.length >= 2, `a long critique still produces heartbeats (${beats.length})`);

  // The source must not reintroduce either half.
  const w = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const critBlock = codeOnly(w.slice(w.indexOf("CANCELLABLE TIMER"), w.indexOf("critText = crit.text")));
  ok(/clearInterval\(beatTimer\)/.test(critBlock), "worker.js cancels the timer synchronously");
  ok(!/await beat\b/.test(critBlock), "…and never awaits the outstanding heartbeat on the exit path");
  ok(!/while \(critAlive\)/.test(critBlock), "…the uninterruptible sleep loop is gone");
  ok(/\.catch\(\(\) => \{\}\)/.test(critBlock), "…and the KV write inside the tick is fire-and-forget");
}

// ── 7 · THE ADVICE MUST MATCH THE CONFIDENCE ─────────────────────────────────
// The message allowed the job "may also be unusually slow" and then said "starting again is safe".
// That is only safe if the job is definitely dead — and a suspected stall is not a confirmed one, since
// the heartbeat write is best-effort and its failure is swallowed. Acting as if we know means two
// generations and potentially two charges.
{
  const { body } = await statusFor({ status: "critique", userId: "u1", createdAt: OLD, updatedAt: OLD });
  const d = String(body.stall_detail);
  ok(!/Starting again is safe/i.test(d), "the message no longer says starting again is safe");
  ok(/can't be certain|may simply be slow/i.test(d), "…it states the uncertainty plainly");
  ok(/[Rr]eload/.test(d), "…advises reloading first, which reconnects a job that is merely slow");
  ok(/cancel.*before starting another|cancel this generation before/i.test(d),
     "…and to cancel before restarting, so a live job cannot be double-charged");

  // The reconnect key must survive a stall, or the reload advice is a lie.
  ok(/e\.code === "timeout" \|\| e\.code === "stalled"/.test(html),
     "the client RETAINS the reconnect key on a stall, exactly as for a timeout");
}

globalThis.fetch = realFetch;
console.log("\n" + (failures === 0 ? "✔ STALL INTEGRATION TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
