// LIVE CHECK IN THE REVIEW PASS — run: node test_live_check.mjs
//
// Drafting has never searched the web. S.wantWebSearch defaults false and no code path sets it true —
// while a comment in the compose section states "we ALWAYS search the web while drafting (pinned true)".
// Every talk carrying the field records false. So recommendations came from the model's training plus a
// corpus snapshot, which is why OpenEvidence found stale guidance in a talk generated the same day.
//
// The search now runs in the REVIEW pass: the draft is already on screen and being read, so the time is
// hidden behind something useful, and review is where currency matters — it re-reads numbers, doses and
// guideline claims. It redeems the same critique stage on the same receipt, so it costs no extra credit.
import { readFileSync } from "fs";

let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const code = html.split("\n").map(l => l.replace(/^\s*\/\/.*$/, "")).join("\n");

// ── 1 · THE SEARCH IS ON THE REVIEW CALL, NOT THE DRAFT ──────────────────────
const critIdx = code.indexOf('_critOpts.tools');
ok(critIdx > 0, "the review call can carry the web_search tool");
const critBlock = code.slice(critIdx - 700, critIdx + 700);
ok(/stage: "critique"/.test(critBlock), "…on the critique stage");
ok(/max_uses: 3/.test(critBlock), "…capped at 3 searches");
ok(/allowed_domains: ALLOWED_SEARCH_DOMAINS/.test(critBlock), "…restricted to the society/journal allowlist");
// ── THE DRAFT MUST NOT SEARCH, ANYWHERE ──────────────────────────────────────
// The first version of this assertion looked at a 1500-character slice around searchHint and concluded
// "the draft is untouched" — while `if (S.wantWebSearch) mainOpts.tools = [...]` sat outside that window
// and would have put search latency back in front of the first token. A slice narrow enough to pass is
// not evidence. Assert over the WHOLE file instead. (Codex, 2026-08-07)
ok(!/mainOpts\.tools\s*=\s*\[/.test(code),
   "no drafting path attaches search tools — the blank wait cannot grow");
ok(/draft:\s*\{[^}]*tools:\s*null/.test(code),
   "…and the async submit sends the draft with tools explicitly null");

// ── THE FREE TIER'S CRITIQUE IS SERVER-SIDE, SO THE TOOLS MUST TRAVEL ────────
// Free-tier generation is durable-only: its critique runs in the Workflow, not the browser. Tools added
// only to the browser critique reached BYOK users and nobody else.
ok(/critique:\s*\{[\s\S]{0,400}?tools:\s*\(topicNeedsLiveCheck/.test(code),
   "the submitted critique spec carries the search tools when the topic needs a live check");

const worker = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
ok(/p\.critique\.maxTok \|\| 16384, p\.critique\.models, p\.critique\.tools/.test(worker),
   "the Workflow's critique call forwards those tools — the main path actually searches");
ok(/p\.draft\.maxTok \|\| 16384, p\.draft\.models, null\)/.test(worker),
   "…and the Workflow's draft call forwards none, whatever a client submits");

// ── 2 · PURE MECHANISM TOPICS SKIP IT ────────────────────────────────────────
const fn = code.slice(code.indexOf("function topicNeedsLiveCheck"), code.indexOf("function talkIsFastMoving"));
const needs = new Function("S", "PURE_MECHANISM_RE", "MANAGEMENT_RE", fn + "; return topicNeedsLiveCheck;")(
  { topic: "" },
  /\b(physiolog\w*|pathophysiolog\w*|mechanism\w*|biochem\w*|anatomy|histolog\w*|embryolog\w*|pharmacokinetic\w*|receptor\w*|signal\w*\s+transduction)\b/i,
  /\b(management|treat\w*|therap\w*|guideline\w*|workup|work-up|diagnos\w*|screen\w*|prevent\w*|vaccin\w*|dose\w*|dosing|indication\w*|approval\w*|recommend\w*|trial\w*|update\w*)\b/i
);
for (const t of ["Acid-base physiology", "Pathophysiology of heart failure", "Mechanisms of insulin resistance"]) {
  ok(needs(t) === false, `pure mechanism skips the search: "${t}"`);
}
for (const t of ["Primary prevention: risk, statins, aspirin and vaccines",
                 "Management of atrial fibrillation",
                 "Metabolic acidosis: physiology to workup",
                 "Acute myeloid leukemia"]) {
  ok(needs(t) === true, `anything actionable gets checked: "${t}"`);
}
ok(needs("") === true, "…and an empty topic defaults to checking, not skipping");

// ── 3 · PROVENANCE RECORDS WHAT HAPPENED, NOT WHAT WAS REQUESTED ─────────────
ok(/S\._reviewSearched = !!\(critResult && critResult\.webSearched\)/.test(code),
   "the flag is set from the RESULT, so a talk cannot claim a search it never got");
ok(/if\(S\._reviewSearched\) talk\._webSearched = true;/.test(code),
   "…and that is what gets stamped onto the talk");

// ── 4 · THE WAIT IS NAMED WHILE IT HAPPENS ───────────────────────────────────
ok(/S\.reviewLiveChecking = true;/.test(code) && /S\.reviewLiveChecking = false;/.test(code),
   "the UI knows when the live check is running, and when it stops");
ok(/ct-hourglass/.test(code), "…showing an hourglass rather than another spinner");
ok(/Checking society sites and journals/.test(code), "…and saying what it is doing");
ok(/prefers-reduced-motion/.test(code), "…with the animation disabled for reduced-motion users");

// ── 5 · IT COSTS NO EXTRA CREDIT ─────────────────────────────────────────────
// The tool rides on the existing critique redemption. Nothing here may consume quota.
ok(!/consumeFreeTier|reserveTalkForJob|free-tier\/session/.test(critBlock),
   "the live check takes no additional credit — it rides the critique stage already paid for");

console.log("\n" + (failures === 0 ? "✔ LIVE CHECK OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
