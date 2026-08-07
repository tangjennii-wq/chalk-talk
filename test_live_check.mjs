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
// The draft must stay clean: adding search there is what makes the blank wait longer.
const draftCall = code.slice(code.indexOf("var searchHint"), code.indexOf("var searchHint") + 1500);
ok(!/max_uses: 3/.test(draftCall), "the DRAFT call is untouched, so the blank wait does not grow");

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
