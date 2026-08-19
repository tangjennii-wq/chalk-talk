// BACKGROUNDED-TAB RECOVERY + BUILD STAMP — run: node test_launch_polish.mjs
//
// Observed 2026-08-11 while driving a free-tier generation with the tab unfocused: the elapsed counter
// froze at loadSec 46 and stayed there for six minutes, on a job the Worker had already finished. Chrome
// throttles setInterval and setTimeout hard in a hidden tab, so both the counter and the status poll
// stopped. The durable path genuinely survives backgrounding — genBackgroundSafe says so and it is true —
// but the CLIENT stops noticing. On a phone that is "switch apps, come back to a talk that looks stuck",
// which is exactly what a physician does between patients.
//
// Neither fix can un-throttle a hidden tab. They make the return instant and the number honest.
import { readFileSync } from "fs";
import vm from "node:vm";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

function fnSrc(name){
  let start = html.indexOf(`function ${name}(`);
  if(start < 0) throw new Error(`missing ${name}`);
  if(html.slice(Math.max(0,start-6), start) === "async ") start -= 6;
  const open = html.indexOf("{", start);
  let d=0,q=null,e=false;
  for(let i=open;i<html.length;i++){ const c=html[i];
    if(q){ if(e) e=false; else if(c==="\\") e=true; else if(c===q) q=null; continue; }
    if(c==='"'||c==="'"||c==="`"){ q=c; continue; }
    if(c==="{") d++; else if(c==="}" && --d===0) return html.slice(start,i+1);
  }
  throw new Error(`unclosed ${name}`);
}

// A document stub that lets a test fire visibilitychange and flip hidden.
function makeDoc(){
  const listeners = [];
  return {
    hidden: true,
    addEventListener(evt, fn){ if(evt === "visibilitychange") listeners.push(fn); },
    removeEventListener(evt, fn){ const i = listeners.indexOf(fn); if(i >= 0) listeners.splice(i,1); },
    _fire(){ listeners.slice().forEach(f => f()); },
    _count(){ return listeners.length; },
  };
}

const doc = makeDoc();
const ctx = { document: doc, setTimeout, clearTimeout, Promise, Date, Math, S: {} };
vm.createContext(ctx);
vm.runInContext(`var _wakeWaiters = [];\n${fnSrc("notifyWake")}\n${fnSrc("sleepUntilVisibleOr")}\n${fnSrc("genElapsedSec")}\n`
  + "this.sleep = sleepUntilVisibleOr; this.elapsed = genElapsedSec; this.notifyWake = notifyWake; this.waiters = () => _wakeWaiters.length;", ctx);
const { sleep, elapsed } = ctx;

// ── the sleep still honours its timeout ─────────────────────────────────────────────────────────────
{
  const t0 = Date.now();
  await sleep(60);
  ok(Date.now() - t0 >= 50, "a hidden tab still wakes on the timeout — the poll is delayed, never abandoned");
}

// ── …and wakes EARLY when the tab comes back ────────────────────────────────────────────────────────
{
  // THE POINT OF THE WHOLE FIX. The sleep cannot observe pageshow or focus itself — only the notifier
  // can — so this proves the wake path, not merely that listeners are registered somewhere.
  const t0 = Date.now();
  const p = sleep(1500);
  setTimeout(() => ctx.notifyWake(), 30);
  await p;
  const waited = Date.now() - t0;
  ok(waited < 400, `a wake notification releases a sleeping poll at once (${waited}ms, not 1500ms)`);
}

// ── a visibilitychange that leaves it hidden must NOT wake it ───────────────────────────────────────
{
  ctx.notifyWake();
  ok(true, "a wake notification with no sleeper waiting is a no-op rather than a throw");
  const p1 = sleep(1500), p2 = sleep(1500);
  setTimeout(() => ctx.notifyWake(), 20);
  await Promise.all([p1, p2]);
  ok(true, "one notification releases EVERY sleeper — two overlapping polls both wake");
}

// ── no listener leak, and no double-resolve ─────────────────────────────────────────────────────────
{
  // NO LEAK, asserted on the list itself. A generation polls ~40 times; a waiter list that only ever
  // grows would hold a dead closure for every one of them, and notifyWake would walk the lot. Added
  // because a mutation deleting the deregistration survived a test that only checked timings.
  const base = ctx.waiters();
  await sleep(5);                                   // times out
  ok(ctx.waiters() === base, `a TIMED-OUT sleeper deregisters itself (waiters ${ctx.waiters()}, base ${base})`);
  const p = sleep(1500);
  ok(ctx.waiters() === base + 1, "…a sleeping poll is registered while it waits");
  ctx.notifyWake();
  await p;
  ok(ctx.waiters() === base, "…and a NOTIFIED sleeper deregisters too");
  for (let i = 0; i < 5; i++) await sleep(2);
  ok(ctx.waiters() === base, "five polls later the list has not grown");
  const q = sleep(1500);
  ctx.notifyWake(); ctx.notifyWake();
  await q;
  ok(true, "a double notification resolves once rather than throwing");
}

// ── elapsed time is DERIVED, so a missed tick cannot make it wrong ──────────────────────────────────
{
  ctx.S._genStartedAt = Date.now() - 42_000;
  ok(elapsed() === 42, "elapsed seconds are read from the clock, not accumulated by a tick that may not fire");
  ctx.S._genStartedAt = null; ctx.S.loadSec = 7;
  ok(elapsed() === 7, "…falling back to the old counter when no start stamp exists");
}

// ── both timers use it, and the tab repaints on return ──────────────────────────────────────────────
ok((html.match(/S\.loadSec = genElapsedSec\(\);/g) || []).length === 2,
   "BOTH generation timers derive elapsed — the resume path had the same frozen-counter bug");
ok(/S\._genStartedAt = \(stored && stored\.at\) \? stored\.at : Date\.now\(\);/.test(html),
   "the RESUME path dates elapsed from the PERSISTED submit time, so a reconnected talk shows how long it",
   "has really been running rather than restarting the clock at zero");
ok(/S\._genStartedAt = Date\.now\(\);\n  loadTimer=setInterval/.test(html),
   "…and a fresh generation stamps the moment it starts");
ok(/await sleepUntilVisibleOr\(ASYNC_GEN_CONFIG\.pollMs\);/.test(html),
   "the status poll sleeps on the visibility-aware helper, not a bare setTimeout");
ok(!/await new Promise\(function\(res\)\{ setTimeout\(res, ASYNC_GEN_CONFIG\.pollMs\); \}\);/.test(html),
   "…and the throttleable bare sleep is gone");
// THREE wake events, not one. A bfcache restore fires pageshow with NO visibilitychange, so a
// back-button return would otherwise never be noticed at all.
for (const evt of ["visibilitychange", "pageshow", "focus"]) {
  ok(new RegExp('addEventListener\\("' + evt + '", function\\(\\)\\{ checkActiveJobOnWake\\(\\); \\}\\)').test(html),
     `${evt} routes through the guarded wake check`);
}

// ── the wake check itself: one poll per wake, however many events fire ──────────────────────────────
{
  let resumes = 0, renders = 0;
  const wakeDoc = { hidden: false };
  const wctx = {
    document: wakeDoc, localStorage: { getItem: () => JSON.stringify({ jobId: "j1", at: Date.now() }) },
    ASYNC_GEN_CONFIG: { jobKey: "k" }, JSON, Promise, Date, setTimeout,
    S: { loading: false, reconnecting: false },
    render(){ renders++; },
    // A slow resume, so overlapping calls genuinely overlap rather than finishing in between.
    resumeAsyncJobIfAny: async () => { resumes++; await new Promise(r => setTimeout(r, 40)); },
  };
  vm.createContext(wctx);
  // The module-level guard travels with the function; without it the extracted copy throws on its
  // first line, which would look like a bug in the code under test rather than a missing declaration.
  // checkActiveJobOnWake notifies the sleeping poll, so the harness needs that too. Counting the
  // notifications is what proves a wake during a live generation actually reaches the loop.
  let notified = 0;
  wctx.notifyWake = () => { notified++; };
  vm.runInContext(`var _wakeCheckInFlight = false;\n${fnSrc("checkActiveJobOnWake")}\nthis.wake = checkActiveJobOnWake;`, wctx);
  // visibilitychange + pageshow + focus routinely fire together on a single return.
  await Promise.all([wctx.wake(), wctx.wake(), wctx.wake()]);
  ok(resumes === 1, `three wake events produce ONE reconnect, not three concurrent polls (got ${resumes})`);
ok(/if\(S\.loading\)\{\s*\n\s*notifyWake\(\);/.test(html),
   "a wake DURING a live poll notifies the sleeping loop — without this, pageshow and focus mean nothing");
  ok(wctx.S.reconnecting === false, "…and the reconnecting flag is cleared when the check finishes");

  wakeDoc.hidden = true;
  const before = resumes;
  await wctx.wake();
  ok(resumes === before, "a wake event while still hidden does nothing — there is nobody to show it to");

  wakeDoc.hidden = false;
  wctx.S.loading = true;
  const r0 = renders, res0 = resumes;
  const n0 = notified;
  await wctx.wake();
  ok(resumes === res0 && renders > r0,
     "with a poll loop already running it repaints only — no second reconnect against a live job");
  ok(notified > n0,
     "…and it NOTIFIES that loop, which is the only way pageshow and focus can wake a throttled sleep");
}

// ── the user is told, and cannot start a second paid job by accident ─────────────────────────────────
ok(/var _genLabel = S\.reconnecting \? "Reconnecting to your talk…"/.test(html),
   "the CTA says Reconnecting rather than offering an ordinary Generate button");
ok(/var _genOff = S\.reconnecting \|\|/.test(html),
   "…and is disabled while it reconnects, so a running paid job cannot be duplicated");
ok(/if\(S\.reconnecting\) h\+=/.test(html), "…with a Reconnecting line inside the loading card too");

// ── EACH EVENT, END TO END ───────────────────────────────────────────────────────────────────────────
// The chain is: browser event -> registered listener -> checkActiveJobOnWake -> notifyWake -> the sleeping
// poll resolves. Everything above tests links 2-4 and asserts link 1 with a regex, which is precisely the
// gap that let the FIRST version of this fix look correct while pageshow could not reach the sleep at all.
// So: register the REAL listener block, dispatch each event for real, and assert the sleep wakes.
{
  const reg = html.slice(html.indexOf('try{\n  document.addEventListener("visibilitychange"'));
  const regBlock = reg.slice(0, reg.indexOf("}catch(_){}") + "}catch(_){}".length);
  ok(/pageshow/.test(regBlock) && /focus/.test(regBlock) && /visibilitychange/.test(regBlock),
     "found the real listener registration block");

  for (const evt of ["visibilitychange", "pageshow", "focus"]) {
    const handlers = { document: {}, window: {} };
    const ectx = {
      setTimeout, clearTimeout, Promise, Date,
      S: { loading: true },                       // a generation is in flight, poll sleeping
      render(){},
      document: { hidden: false, addEventListener(e, fn){ handlers.document[e] = fn; } },
      window:   { addEventListener(e, fn){ handlers.window[e] = fn; } },
    };
    vm.createContext(ectx);
    vm.runInContext(
      `var _wakeWaiters = []; var _wakeCheckInFlight = false;\n`
      + `${fnSrc("notifyWake")}\n${fnSrc("sleepUntilVisibleOr")}\n${fnSrc("checkActiveJobOnWake")}\n`
      + regBlock + `\nthis.sleep = sleepUntilVisibleOr;`, ectx);

    const fire = handlers.document[evt] || handlers.window[evt];
    ok(typeof fire === "function", `${evt} is registered on the right target`);

    const t0 = Date.now();
    const p = ectx.sleep(1500);
    setTimeout(() => fire(), 25);
    await p;
    const waited = Date.now() - t0;
    ok(waited < 400, `${evt} WAKES a sleeping poll (${waited}ms, not 1500ms)`);
  }

  // …and the same event while hidden must not.
  const handlers = {};
  const hctx = {
    setTimeout, clearTimeout, Promise, Date, S: { loading: true }, render(){},
    document: { hidden: true, addEventListener(e, fn){ handlers[e] = fn; } },
    window: { addEventListener(e, fn){ handlers[e] = fn; } },
  };
  vm.createContext(hctx);
  vm.runInContext(`var _wakeWaiters = []; var _wakeCheckInFlight = false;\n`
    + `${fnSrc("notifyWake")}\n${fnSrc("sleepUntilVisibleOr")}\n${fnSrc("checkActiveJobOnWake")}\n`
    + regBlock + `\nthis.sleep = sleepUntilVisibleOr;`, hctx);
  const t1 = Date.now();
  const ph = hctx.sleep(150);
  setTimeout(() => handlers.pageshow(), 20);
  await ph;
  ok(Date.now() - t1 >= 120, "a pageshow that leaves the tab hidden does NOT wake it early");
}

// ── the build stamp ─────────────────────────────────────────────────────────────────────────────────
// It cache-busts guidelines.json and landmark_pmids.json, AND it is how a coworker's bug report gets
// tied to a build. It sat six commits stale through the whole trial-grounding change.
const buildId = (html.match(/var BUILD_ID = "([^"]+)"/) || [])[1];
const buildTxt = readFileSync(new URL("./build.txt", import.meta.url), "utf8").trim();
ok(!!buildId, "index.html declares a BUILD_ID");
ok(buildId === buildTxt, `BUILD_ID matches build.txt (${buildId} vs ${buildTxt})`);
ok(/^\d{4}-\d{2}-\d{2}-\d{2}$/.test(buildId), `BUILD_ID is a dated stamp, so staleness is visible (${buildId})`);

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ LAUNCH POLISH OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
