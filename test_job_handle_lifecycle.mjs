// THE RECONNECT HANDLE OUTLIVES POST-PROCESSING — run: node test_job_handle_lifecycle.mjs
//
// ── THE BUG ─────────────────────────────────────────────────────────────────────────────────────────
// `ct_active_job` was deleted the instant pollAsyncGeneration returned — BEFORE parsing, review
// recovery, provenance stamping or rendering:
//
//     var res = await pollAsyncGeneration(stored.jobId, ...);
//     try{ localStorage.removeItem(ASYNC_GEN_CONFIG.jobKey); }catch(_){}   // <- here
//     var draftTalk = parseTalkStrict(txt, S.style);                       // <- and this can throw
//
// So any failure after the Workflow succeeded stranded a COMPLETED, ALREADY-PAID result: the talk
// existed on the server, the credit was spent, and the only handle to it had just been destroyed. Both
// catch paths then removed it again, for most error classes.
//
// Observed in production: a reload showed "Network hiccup", and a console probe reported NO STORED JOB.
// I read that as "the key was never written" — it had been written, used, and prematurely deleted. The
// probe could not distinguish the two, which is why the diagnosis needed the code rather than the symptom.
//
// ── WHAT IS ASSERTED ────────────────────────────────────────────────────────────────────────────────
// 1. the handle survives a parse failure on a completed job, so a reload can reconnect;
// 2. it is released only once the talk is assigned, or a reviewPending is durably saved;
// 3. compare-and-delete: an older generation cannot erase a newer job's handle;
// 4. terminal outcomes (cancel, expiry) DO release it.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const grab = (name) => {
  const start = html.indexOf("function " + name + "(");
  if (start < 0) throw new Error("not found: " + name);
  let depth = 0;
  for (let j = html.indexOf("{", start); j < html.length; j++) {
    if (html[j] === "{") depth++;
    else if (html[j] === "}") { depth--; if (depth === 0) return html.slice(start, j + 1); }
  }
  throw new Error("unbalanced: " + name);
};

// ── EXECUTABLE: the two helpers, against a real localStorage stub ─────────────
const store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const ctx = {};
new Function("ctx", "localStorage", "console",
  "var ASYNC_GEN_CONFIG = { jobKey: 'ct_active_job' };" +
  grab("_clearActiveJob") + grab("_errorKeepsJobRecoverable") +
  "ctx.clear=_clearActiveJob; ctx.keeps=_errorKeepsJobRecoverable;"
)(ctx, localStorage, { info(){}, warn(){} });
const { clear, keeps } = ctx;

const seed = (jobId) => { store["ct_active_job"] = JSON.stringify({ jobId, at: Date.now() }); };
const present = () => !!store["ct_active_job"];

// ── 1 · COMPARE-AND-DELETE ───────────────────────────────────────────────────
// A late unwind from a superseded generation must not strand the job the user is currently watching.
{
  seed("job-NEW");
  clear("job-OLD", "stale invocation");
  ok(present(), "an older generation does NOT delete a newer job's handle");

  clear("job-NEW", "delivered");
  ok(!present(), "…the owning generation does delete it");

  seed("job-X");
  clear(null, "no id supplied");
  ok(!present(), "a clear with no id still works (cancel path, id unknown)");
}

// ── 2 · WHICH ERRORS KEEP THE JOB RECOVERABLE ────────────────────────────────
{
  // The class that caused the outage: the Workflow finished, our parsing failed.
  const parseFails = [
    new Error("Unexpected token < in JSON at position 0"),
    new Error("Unexpected end of JSON input"),
    new Error("Empty response"),
    new Error("Talk is incomplete: section 3 missing bullets"),
  ];
  for (const e of parseFails) {
    ok(keeps(e) === true, `parse/shape failure keeps the handle — "${e.message.slice(0, 44)}"`);
  }

  const netFails = [new Error("Failed to fetch"), new Error("NetworkError when attempting to fetch")];
  for (const e of netFails) ok(keeps(e) === true, `network failure keeps the handle — "${e.message.slice(0, 40)}"`);

  const byCode = (c) => { const e = new Error("x"); e.code = c; return e; };
  ok(keeps(byCode("timeout")) === true, "timeout keeps it");
  ok(keeps(byCode("stalled")) === true, "stalled keeps it");
  ok(keeps(byCode("auth"))    === true, "an expired session keeps it — the job is fine, our token is not");

  // Terminal: the job is genuinely gone, holding the handle would only strand the UI.
  ok(keeps(byCode("cancelled")) === false, "confirmed cancellation releases it");
  ok(keeps(byCode("expired"))   === false, "confirmed expiry (404) releases it");
}

// ── 3 · THE SCENARIO, END TO END ─────────────────────────────────────────────
// Workflow returns done -> client parsing throws -> reload must still find the handle.
{
  seed("job-42");
  const err = new Error("Unexpected token < in JSON at position 0");   // parseTalkStrict blowing up
  if (!keeps(err)) clear("job-42", "unrecoverable");
  ok(present(), "AFTER a completed job whose parsing threw, the handle is still there to reconnect with");

  const stored = JSON.parse(store["ct_active_job"]);
  ok(stored.jobId === "job-42", "…and it still points at the same completed job");
}

// ── 4 · THE SOURCE NO LONGER CLEARS BEFORE POST-PROCESSING ───────────────────
// Comments stripped first — earlier suites in this repo passed by matching their own prose.
{
  const code = html.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");

  // The exact shape of the bug: a removeItem on the job key immediately following the poll's return.
  const premature = /await pollAsyncGeneration\([\s\S]{0,600}?\)\s*;\s*(try\s*\{\s*)?localStorage\.removeItem\(\s*ASYNC_GEN_CONFIG\.jobKey/;
  ok(!premature.test(code), "no path clears the handle immediately after pollAsyncGeneration returns");

  // Raw removeItem should survive only in two places: inside _clearActiveJob (which IS the guarded
  // delete) and the stale-job sweep at the top of resumeAsyncJobIfAny, which discards a handle older
  // than the KV TTL before any job is adopted. Counting the helper's own call as a violation is what
  // made the first version of this assertion fail on correct code.
  const helperBody = grab("_clearActiveJob");
  const outsideHelper = code.replace(helperBody, "");
  const raw = (outsideHelper.match(/localStorage\.removeItem\(\s*ASYNC_GEN_CONFIG\.jobKey\s*\)/g) || []).length;
  ok(raw <= 1, `only the stale-job sweep clears the key directly, outside the helper (found ${raw})`);
  ok(/600000[\s\S]{0,200}?localStorage\.removeItem\(\s*ASYNC_GEN_CONFIG\.jobKey/.test(code),
     "…and that one sweep is the TTL-expiry discard, not a post-processing clear");
  ok((code.match(/_clearActiveJob\(/g) || []).length >= 5,
     "every other clear goes through the compare-and-delete helper");

  // Released at the point the talk becomes recoverable by other means.
  ok(/S\.talk = finalTalk;[\s\S]{0,400}?_clearActiveJob\(/.test(code),
     "the handle is released after S.talk is assigned");
  ok(/_saveReviewPending\(\);[\s\S]{0,300}?_clearActiveJob\(/.test(code),
     "…or after a withheld draft is durably saved to reviewPending");

  // The catch paths must consult the recoverability predicate, not delete unconditionally.
  ok(/_errorKeepsJobRecoverable\(/.test(code), "catch paths consult the recoverability predicate");
  ok(!/catch\(err\)\{\s*try\{\s*localStorage\.removeItem\(\s*ASYNC_GEN_CONFIG\.jobKey/.test(code),
     "the resume catch no longer deletes the handle unconditionally");
}

// ── 5 · THE POLL DISTINGUISHES STATUS CODES ──────────────────────────────────
// `if(!r.ok) continue;` treated 401/403 as "still running" and spun to the nine-minute timeout, then
// blamed a timeout — a diagnosis that named the wrong failure.
{
  const poll = grab("pollAsyncGeneration");
  ok(!/if\(!r\.ok\)\{\s*continue;\s*\}/.test(poll.replace(/\s+/g, " ").replace(/ /g, "")) ||
     /r\.status === 401/.test(poll),
     "a non-OK poll response is no longer blanket-treated as still-running");
  ok(/r\.status === 401 \|\| r\.status === 403/.test(poll), "401/403 are handled explicitly");
  ok(/code = "auth"/.test(poll), "…and carry an auth code so the handle is preserved");
  ok(/code = "expired"/.test(poll), "404 carries an expired code");
  ok(/r\.status >= 500/.test(poll) || /r\.status === 503/.test(poll),
     "5xx is treated as transient and keeps polling");
}

console.log("\n" + (failures === 0 ? "✔ JOB HANDLE LIFECYCLE OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
