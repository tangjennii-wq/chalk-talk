// CLIENT RECEIPT WIRING — run: node test_client_receipt_wiring.mjs
//
// Steps 1–3 of the client half: sync creates a session BEFORE drafting, async accepts the receipt the
// server returns, and resume restores BOTH the job id and the receipt.
//
// ── WHAT WAS BROKEN ─────────────────────────────────────────────────────────────────────────────────
//   sync:   draft -> consume -> receipt      first call had no receipt -> 402
//   async:  reserve server-side, return {jobId, durable}   browser had nothing to authorise with
//   resume: restored the job, not the receipt              follow-up calls 402'd after a reload
//
// The credentials are one unit — {jobId, receipt} — because every failure above came from holding one
// half of the pair.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const code = html.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");
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

// ── 1 · CREDENTIALS ARE ONE UNIT, EXECUTED ───────────────────────────────────
{
  const store = {};
  const ctx = { S: {}, localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  }, console: { info() {}, warn() {} } };
  const c = {};
  new Function("S", "localStorage", "console", "c",
    "var GEN_CRED_KEY = 'ct_active_cred';" +
    grab("setGenCredentials") + grab("loadGenCredentials") + grab("clearGenCredentials") +
    "c.set=setGenCredentials;c.load=loadGenCredentials;c.clear=clearGenCredentials;"
  )(ctx.S, ctx.localStorage, ctx.console, c);

  c.set("job-1", "rcpt-1");
  ok(ctx.S.genJobId === "job-1" && ctx.S.genReceipt === "rcpt-1", "setting credentials sets both halves");
  const back = c.load();
  ok(back && back.jobId === "job-1" && back.receipt === "rcpt-1",
     "…and both survive a reload via localStorage");

  // Half a pair is not a credential.
  store["ct_active_cred"] = JSON.stringify({ jobId: "job-2", at: Date.now() });   // no receipt
  ok(c.load() === null, "a stored record missing the receipt is treated as NO credential");
  store["ct_active_cred"] = JSON.stringify({ receipt: "rcpt-2", at: Date.now() }); // no jobId
  ok(c.load() === null, "…and so is one missing the job id");

  // Expiry: a 30-minute receipt must not be sent as though it were live.
  store["ct_active_cred"] = JSON.stringify({ jobId: "j", receipt: "r", at: Date.now() - 31 * 60 * 1000 });
  ok(c.load() === null, "a credential older than the 30-minute TTL is discarded, not sent dead");
  store["ct_active_cred"] = JSON.stringify({ jobId: "j", receipt: "r", at: Date.now() - 60 * 1000 });
  ok(!!c.load(), "…while a fresh one is still usable");

  c.set("job-3", "rcpt-3");
  c.clear("test");
  ok(ctx.S.genJobId === null && ctx.S.genReceipt === null && c.load() === null,
     "clearing removes both halves and the persisted copy");
}

// ── 2 · SYNC AUTHORISES BEFORE THE FIRST MODEL CALL ──────────────────────────
{
  ok(/async function createGenSession/.test(code), "there is a session helper");
  ok(/\/v1\/free-tier\/session/.test(code), "…pointed at the session endpoint");

  // Ordering is the whole bug: the session must precede the draft call inside generate().
  //
  // Sliced by offset rather than brace-matched. generate() is thousands of lines and contains braces
  // inside template literals and regexes, so a naive brace counter reports "unbalanced" on correct code —
  // which it did on the first run of this test.
  const genStart = code.indexOf("async function generate()");
  const genEnd = code.indexOf("async function ", genStart + 30);
  const gen = code.slice(genStart, genEnd > genStart ? genEnd : code.length);
  const idxSession = gen.indexOf("createGenSession");
  const idxDraft = Math.min(...["callAPIWithFallback", "submitAsyncGeneration", "_callClaude"]
    .map(n => { const i = gen.indexOf(n); return i < 0 ? Infinity : i; }));
  ok(idxSession > 0, "generate() creates a session");
  ok(idxSession < idxDraft,
     `…BEFORE the first model call (session @${idxSession}, first call @${idxDraft})`);

  // And it must not ALSO consume, which would charge twice for one talk.
  ok(!/await consumeFreeTier\("talk"\)[\s\S]{0,40}\n[\s\S]{0,200}_useAsync/.test(gen) ||
     !/consumeFreeTier\("talk"\)/.test(gen),
     "…and does not also call the old consume path for the same talk");
  ok(/session above already reserved/.test(html),
     "…with the reason recorded where the old consume used to be");
}

// ── 3 · ASYNC STORES THE RECEIPT THE SERVER RETURNS ──────────────────────────
{
  ok(/_job\.receipt/.test(code), "the async submit result is inspected for a receipt");
  // Match the CALL, not its exact argument list: adding the third argument (the server's absolute expiry)
  // broke the closed-paren version of this pattern and reported a regression in a strict improvement.
  ok(/setGenCredentials\(_job\.jobId, _job\.receipt\b/.test(code),
     "…and stored as a credential pair");
  ok(/setGenCredentials\(_job\.jobId, _job\.receipt,[\s\S]{0,80}receiptExpiresAt/.test(code),
     "…together with the server's absolute expiry, not the browser's arrival time");
  ok(/returned no receipt/.test(html),
     "…with an explicit warning when the server could not mint one, rather than silence");
}

// ── 4 · RESUME RESTORES BOTH ─────────────────────────────────────────────────
{
  const rStart = code.indexOf("async function resumeAsyncJobIfAny()");
  const rEnd = code.indexOf("async function ", rStart + 30);
  const resume = code.slice(rStart, rEnd > rStart ? rEnd : code.length);
  ok(/loadGenCredentials\(\)/.test(resume), "resume consults the persisted credentials");
  ok(/stored\.receipt/.test(resume), "…and the receipt stored with the job record");
  ok(/setGenCredentials\(stored\.jobId, _resumeReceipt\b/.test(resume),
     "…restoring the pair together");
  // A resume must PRESERVE the original expiry. Recomputing it here is precisely how a dead receipt looked
  // live: the 402 that followed read as a permissions problem rather than an expiry.
  ok(/expiresAt: stored\.receiptExpiresAt/.test(resume),
     "…carrying the ORIGINAL absolute expiry rather than restamping it to now");
  ok(/without a receipt/.test(resume),
     "…and saying so when only the job survived, instead of silently 402-ing later");

  // The receipt must be written INTO the job record at submit, so the two cannot drift apart.
  ok(/receipt: S\.genReceipt \|\| null/.test(code),
     "the active-job record carries the receipt alongside the job id");
  ok(/receiptExpiresAt: \(loadGenCredentials\(\) \|\| \{\}\)\.expiresAt/.test(code),
     "…and its expiry, so the two cannot drift apart across a reload");

  // Restoration must happen before anything that could make an authorised call.
  const idxRestore = resume.indexOf("setGenCredentials");
  const idxPoll = resume.indexOf("pollAsyncGeneration");
  ok(idxRestore > 0 && idxPoll > idxRestore,
     "…and restoration precedes polling, which is what triggers the follow-up work");
}

// ── 5 · DELIVERY IS **NOT** A REASON TO CLEAR ────────────────────────────────
// The first version cleared on delivery, which read as tidy and was wrong: the citation audit starts
// AFTER the talk renders, and so do user-triggered diagrams and podcast scripts. Every one of them would
// have sent no receipt and 402'd once enforcement is on — on a talk just paid for. (Codex, 2026-07-31)
//
// Authorisation outlives the reconnect handle. It ends at expiry, at confirmed cancellation, or when a new
// generation replaces it — never on delivery and never on a transient failure.
{
  const reasons = [...code.matchAll(/clearGenCredentials\("([^"]+)"\)/g)].map(m => m[1]);
  ok(!reasons.some(r => /deliver/i.test(r)),
     `credentials are NOT cleared on delivery (reasons: ${reasons.join(", ") || "none"})`);
  ok(reasons.some(r => /cancel/i.test(r)), "…cleared on confirmed cancellation");
  ok(!reasons.some(r => /error|fail|timeout|network/i.test(r)),
     "…and NEVER on a transient failure");
  ok(/30 \* 60 \* 1000/.test(code), "…with expiry enforced when the credential is read");

  // The post-delivery audit must still be able to authorise. The clear must not sit between the talk
  // being assigned and the audit starting.
  const idxAssign = code.indexOf("S.talk = finalTalk;");
  const idxAudit = code.indexOf("verifyCitations", idxAssign);
  const between = code.slice(idxAssign, idxAudit > 0 ? idxAudit : idxAssign + 4000);
  ok(!/clearGenCredentials\(/.test(between),
     "…and nothing clears them between delivery and the citation audit");
}

// ── 5b · FREE TIER ALWAYS TAKES THE DURABLE PATH ─────────────────────────────
// Desktop free-tier generation used the SYNCHRONOUS path, which put billing reconciliation in the
// browser: it reserved a credit before drafting and refunded nothing if drafting, parsing or review then
// failed. The durable path's terminal reconciliation is server-owned, exactly-once and already tested —
// so routing every free-tier generation through it deletes the problem instead of solving it.
{
  const aStart = code.indexOf("function asyncGenApplicable()");
  const aEnd = code.indexOf("\nasync function", aStart);
  const fn = code.slice(aStart, aEnd > aStart ? aEnd : aStart + 2000);
  ok(!/matchMedia/.test(fn),
     "the async decision no longer depends on viewport — free tier is always durable");
  ok(/return true;/.test(fn), "…it returns true once the free-tier preconditions hold");

  // And the decision must be taken ONCE. It was evaluated before AND after an await, so a viewport
  // change between the two could reserve a sync session and then start a separately reserved async job.
  const genStart = code.indexOf("async function generate()");
  const genEnd = code.indexOf("async function ", genStart + 30);
  const gen = code.slice(genStart, genEnd > genStart ? genEnd : code.length);
  ok((gen.match(/asyncGenApplicable\(\)/g) || []).length === 1,
     `asyncGenApplicable() is evaluated exactly ONCE per generation (found ${(gen.match(/asyncGenApplicable\(\)/g) || []).length})`);
  ok(/var _wantAsync = asyncGenApplicable\(\)/.test(gen), "…captured in a local");
  ok(/if \(_wantAsync\)/.test(gen), "…and reused rather than re-evaluated after the await");
}

// ── 6 · REFINE OF A SAVED TALK GETS ITS OWN NARROW SESSION ───────────────────
{
  ok(/async function createRefineSession/.test(code), "there is a refine-session helper");
  ok(/\/v1\/free-tier\/refine-session/.test(code), "…pointed at the ownership-checked endpoint");
  const rsStart = code.indexOf("async function createRefineSession");
  const rsEnd = code.indexOf("async function ", rsStart + 30);
  const rs = code.slice(rsStart, rsEnd > rsStart ? rsEnd : code.length);
  ok(/talkId/.test(rs), "…which sends the talk id for the server to verify ownership against");
  ok(/refineOf/.test(rs), "…and records that this credential is a refine, not a generation");
}

console.log("\n" + (failures === 0 ? "✔ CLIENT RECEIPT WIRING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
