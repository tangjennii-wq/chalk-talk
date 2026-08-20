// AUDIO INTEGRITY — run: node test_audio_integrity.mjs
//
// Two defects in genPodcast, both invisible today and both live at launch.
//
// 1. NO AUTHORISATION. It called the model with no opts at all — no receipt, no stage. Identical to the
//    defect fixed in checkForUpdates, but Audio is worse exposed: it is the ONLY user-triggered call
//    that runs on a cold-loaded SAVED talk, where nothing has minted a receipt. The Worker permits it
//    today only because RECEIPTS_REQUIRED has never been switched on. The moment it is, Generate audio
//    returns 402 on every saved talk — which is most of the library.
//
// 2. A RACE WITH THE CITATION AUDIT. The button was live while the audit ran in the background.
//    genPodcast snapshots S.talk; the audit then replaces S.talk with the audited version; S.podScript
//    is never invalidated. So the script could narrate a reference the audit had just dropped as
//    unverifiable — the audio ending up MORE wrong than the talk it came from.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

function fnSrc(name){
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error("missing " + name);
  const open = html.indexOf("{", start);
  let d = 0, q = null, e = false;
  for (let i = open; i < html.length; i++) { const c = html[i];
    if (q) { if (e) e = false; else if (c === "\\") e = true; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === "{") d++; else if (c === "}" && --d === 0) return html.slice(start, i + 1);
  }
  throw new Error("unclosed " + name);
}
const fn = fnSrc("genPodcast");

// ── 1. authorisation, before anything is spent ──────────────────────────────────────────────────────
ok(/await ensureRefineAuth\(\)/.test(fn),
   "genPodcast asks for authorisation — the same free, ownership-checked call every refine makes");
const iAuth = fn.indexOf("ensureRefineAuth"), iCall = fn.indexOf("callAPI");
ok(iAuth > -1 && iCall > -1 && iAuth < iCall, "…BEFORE the model call, so a refusal costs nothing");
ok(/if\(!_ra\.ok\)\{/.test(fn), "…and a refusal is handled rather than ignored");
ok(/Nothing was generated and your talk is unchanged/.test(fn),
   "…and says plainly that nothing was spent and nothing changed");
ok(/S\.podBusy = false; render\(\); return;/.test(fn),
   "…and clears podBusy on the refusal path, so the button does not stay stuck disabled");

// STAGE. A refine receipt covers refine/critique/aux and deliberately NOT draft, so omitting the stage
// would swap 402 receipt_required for 402 stage_not_authorised — the same dead button, new message.
ok(/meterKind:"aux", stage:"aux"/.test(fn),
   "the call declares stage aux, which a refine receipt covers, and labels its cost aux");
ok(!/meterKind:"talk"/.test(fn),
   "…and is not labelled a talk: it writes no teaching content, it reads a finished one");

// Same server-side rule this depends on, asserted against the Worker so a change there fails HERE.
const worker = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const budgets = worker.slice(worker.indexOf("RECEIPT_STAGE_BUDGETS"), worker.indexOf("RECEIPT_STAGE_BUDGETS") + 1200);
const refineLine = (budgets.match(/refine:\s*\{[^}]*\}/) || [""])[0];
ok(/aux:/.test(refineLine) && !/draft:/.test(refineLine),
   "a refine receipt still budgets aux and not draft — which is why stage matters here");

// ── 2. the citation-audit race ──────────────────────────────────────────────────────────────────────
ok(/if\(S\.citationAuditPending\)\{/.test(fn), "genPodcast checks whether the citation audit is still running…");
const iWait = fn.indexOf("citationAuditPending"), iSnap = fn.indexOf("S.talk.sections");
ok(iWait > -1 && iWait < iCall, "…before the model call, not after");
ok(/while\(S\.citationAuditPending && _waited < 30000\)/.test(fn),
   "…and waits for it, with a bound so a stuck audit cannot hang the button forever");
ok(/Waiting for the citation check to finish/.test(fn),
   "…telling the user why, rather than appearing frozen");
ok(/reference the check is about to remove/.test(fn),
   "…and naming the actual risk, which is audio that outlives a dropped citation");
ok(/if\(!S\.talk\)\{ render\(\); return; \}/.test(fn),
   "…and bails if the talk vanished while waiting, rather than scripting a null");

// The talk must be READ AFTER the wait, or waiting achieved nothing.
ok(iSnap > iWait, "the talk is read AFTER the wait resolves — a snapshot taken first would defeat the point");

// ── the guard must be real, not cosmetic ────────────────────────────────────────────────────────────
// citationAuditPending has to actually be set by the paths that run an audit, or this waits on nothing.
ok((html.match(/S\.citationAuditPending = true/g) || []).length >= 3,
   "citationAuditPending is genuinely set by the generate and refine audit paths");
ok(/S\.podWaitingOnAudit = false;/.test(fn) && /podWaitingOnAudit:false/.test(html),
   "the waiting flag is declared in state and always cleared");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ AUDIO INTEGRITY OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
