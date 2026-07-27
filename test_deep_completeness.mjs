// BEHAVIOURAL tests for (a) the depth of the completeness gate and (b) the citation-audit pipeline on
// EVERY release path. Both are Codex P1 findings, 2026-07-26.
//
// (a) The first "strict" gate only asked whether required TOP-LEVEL values were non-empty, so a talk
//     like {sections:[{}], visual_memory_card:{top_left:"x"}} passed and rendered empty section bodies
//     and three blank quadrants. A present-but-hollow field is the same harm as a missing one and is
//     harder for a reader to notice.
// (b) retryReview() released talks after verifyCitations() alone — a SEMANTIC check of whether a source
//     supports a claim. It never asks whether the PMID exists or whether the DOI belongs to the paper
//     named, so a talk released after a successful review retry verified LESS than the path beside it.
//
// Run: node test_deep_completeness.mjs
import { readFileSync } from "fs";
import vm from "vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
function block(re) { const m = html.match(re); if (!m) throw new Error("not found: " + re); const i = m.index, e = /\n\};?/.exec(html.slice(i)); return html.slice(i, i + e.index + e[0].length); }
const line = (re) => { const m = html.match(re); if (!m) throw new Error("line not found: " + re); return m[0]; };

// ── build a sandbox with the REAL gate ──────────────────────────────────────────
const ctx = { console: { warn() {}, info() {} }, S: { boardsDifficulty: 4 }, parseInt, String, Array, Object, JSON };
vm.createContext(ctx);
// BOARDS_DIFFICULTY is a multi-line object literal; take it by its own terminator, not by line().
const objLiteral = (name) => { const i = html.indexOf("var " + name + " = {"); const e = /\n\};?/.exec(html.slice(i)); return html.slice(i, i + e.index + e[0].length); };
vm.runInContext([
  objLiteral("BOARDS_DIFFICULTY"),
  line(/^function boardsDifficulty\(.*$/m),
  block(/^function _repairBoardQuestionInPlace\(/m),
  line(/^var _BOARD_TOPLEVEL_FIELDS = .*$/m),
  block(/^function _hoistMisplacedBoardFields\(/m),
  line(/^var _MIN_MEANINGFUL = .*$/m), line(/^var _MIN_BOARD_PEARLS = .*$/m),
  line(/^function _meaningful\(.*$/m),
  block(/^function _meaningfulList\(/m),
  line(/^var _VMC_QUADRANTS = .*$/m),
  block(/^function _vmcIncomplete\(/m),
  line(/^var _REQUIRED_LECTURE_FIELDS = .*$/m), line(/^var _REQUIRED_BOARDS_FIELDS  = .*$/m),
  block(/^function _missingTalkFields\(/m),
  block(/^function _normalizeTalkInPlace\(/m),
  block(/^function fixJSON\(/m),
  block(/^function parseTalkStrict\(/m),
  block(/^function _assertCompleteTalk\(/m),
].join("\n"), ctx);
const missingFields = vm.runInContext("_missingTalkFields", ctx);
const assertComplete = vm.runInContext("_assertCompleteTalk", ctx);
const rejects = (talk, style) => { try { assertComplete(JSON.parse(JSON.stringify(talk)), style, "t"); return false; } catch (e) { return e.code === "incomplete_talk"; } };

// ── 1) Codex's exact skeletal fixtures must now be REJECTED ─────────────────────
ok(rejects({ title: "Example", sections: [{}], summary_points: ["x"], visual_memory_card: { top_left: "x" } }, "lecture"),
   "LECTURE skeleton {sections:[{}], one quadrant} is REJECTED (it rendered blank sections + 3 blank quadrants)");
ok(rejects({ title: "Example", question: { stem: "x" }, key_point: "x", board_pearls: ["x"], visual_memory_card: { top_left: "x" } }, "boards"),
   "BOARDS skeleton {question:{stem:'x'}, one pearl, one quadrant} is REJECTED");

// name the reasons, so a future reader can see WHY it failed
{
  const m = missingFields({ title: "Example", sections: [{}], summary_points: ["x"], visual_memory_card: { top_left: "x" } }, "lecture");
  ok(m.some((x) => /^sections\[0\]/.test(x)), `the empty section is named specifically (${m.find((x) => /sections/.test(x)) || "—"})`);
  ok(m.some((x) => /visual_memory_card\./.test(x)), "the missing quadrants are named specifically");
}

// ── 2) the granular rules, one at a time ───────────────────────────────────────
const goodVmc = { top_left: "Na <120", top_right: "Check Uosm", bottom_left: "SIADH", bottom_right: "Correct <8/24h" };
const goodLecture = { title: "Hyponatremia", sections: [{ heading: "Physiology", points: ["ADH drives free water retention"] }], summary_points: ["Correct slowly"], visual_memory_card: goodVmc };
ok(!rejects(goodLecture, "lecture"), "a genuinely complete lecture still PASSES (the gate does not over-reject)");

for (const [label, mutate] of [
  ["a section with a blank heading", (t) => { t.sections[0].heading = ""; }],
  ["a section with a 1-char heading", (t) => { t.sections[0].heading = "x"; }],
  ["a section with no points", (t) => { t.sections[0].points = []; }],
  ["a section whose points are blank strings", (t) => { t.sections[0].points = ["  "]; }],
  ["a SECOND section that is empty", (t) => { t.sections.push({}); }],
  ["one blank summary point among good ones", (t) => { t.summary_points = ["Correct slowly", ""]; }],
  ["a missing bottom_right quadrant", (t) => { delete t.visual_memory_card.bottom_right; }],
  ["a blank top_right quadrant", (t) => { t.visual_memory_card.top_right = " "; }],
]) {
  const t = JSON.parse(JSON.stringify(goodLecture)); mutate(t);
  ok(rejects(t, "lecture"), `lecture REJECTED: ${label}`);
}

const goodQ = {
  stem: "A 62-year-old with confusion and Na 112...", correct_letter: "C", explanation: "Hypertonic saline is indicated for seizure risk.",
  choices: [
    { letter: "A", text: "Fluid restriction alone", correct: false },
    { letter: "B", text: "Isotonic saline", correct: false },
    { letter: "C", text: "3% hypertonic saline", correct: true },
    { letter: "D", text: "Tolvaptan", correct: false },
    { letter: "E", text: "Desmopressin", correct: false },
  ],
  wrong_explanations: [{ letter: "A", why: "Too slow for symptomatic hyponatremia" }, { letter: "B", why: "May worsen Na in SIADH" }, { letter: "D", why: "Not first line acutely" }, { letter: "E", why: "Worsens water retention" }],
  difficulty_level: 4, difficulty_label: "Board-level", difficulty_rationale: "Requires triage of severity", reasoning_steps: ["Assess symptoms"],
};
const goodBoards = { title: "Hyponatremia", question: goodQ, key_point: "Symptomatic hyponatremia needs hypertonic saline", board_pearls: ["Correct <8 mEq/L/24h", "Check urine osm", "Treat symptoms not the number"], visual_memory_card: goodVmc };
ok(!rejects(goodBoards, "boards"), "a genuinely complete boards talk still PASSES");

for (const [label, mutate] of [
  ["4 choices instead of 5", (t) => { t.question.choices.pop(); }],
  ["a choice with empty text", (t) => { t.question.choices[1].text = ""; }],
  ["no answer flagged correct", (t) => { t.question.choices.forEach((c) => { c.correct = false; }); t.question.correct_letter = ""; }],
  ["two answers flagged correct", (t) => { t.question.choices[0].correct = true; t.question.correct_letter = ""; }],
  ["a blank explanation", (t) => { t.question.explanation = ""; }],
  ["only 2 wrong_explanations", (t) => { t.question.wrong_explanations = t.question.wrong_explanations.slice(0, 2); }],
  ["a wrong_explanation with no reason", (t) => { t.question.wrong_explanations[0].why = ""; }],
  ["a hollow key_point", (t) => { t.key_point = "x"; }],
  ["only 2 board pearls", (t) => { t.board_pearls = t.board_pearls.slice(0, 2); }],
  ["a blank pearl among good ones", (t) => { t.board_pearls.push(""); }],
]) {
  const t = JSON.parse(JSON.stringify(goodBoards)); mutate(t);
  ok(rejects(t, "boards"), `boards REJECTED: ${label}`);
}

// ── 3) repair must run BEFORE judgement, or recoverable talks get thrown away ───
// The repair reconciles correct_letter against the flagged choice and fixes drifted letters. If the gate
// judged first, these would fail despite being deterministically fixable.
{
  const t = JSON.parse(JSON.stringify(goodBoards));
  t.question.correct_letter = "A";                       // disagrees with the flagged choice (C)
  ok(!rejects(t, "boards"), "a correct_letter/flag disagreement is REPAIRED, not rejected (repair precedes judgement)");
  // NOTE: these two were written as "must reject" first. They are REPAIRED, and that is correct —
  // recording it so nobody re-tightens the gate against its own repair layer.
  const tz = JSON.parse(JSON.stringify(goodBoards)); tz.question.choices[1].letter = "Z";
  ok(!rejects(tz, "boards"), "a single bogus choice letter is renormalized by position, not rejected");
  const td = JSON.parse(JSON.stringify(goodBoards)); td.question.difficulty_level = 99; td.question.difficulty_label = "";
  ok(!rejects(td, "boards"), "an out-of-range difficulty falls back to the selected level and relabels");
  // but a question the repair CANNOT fix must still fail: wrong count means no positional remap happens
  const tb = JSON.parse(JSON.stringify(goodBoards)); tb.question.choices.pop(); tb.question.choices[1].letter = "Z";
  ok(rejects(tb, "boards"), "a bogus letter the repair can't reach (choices≠5) is still REJECTED");
  const t2 = JSON.parse(JSON.stringify(goodBoards));
  t2.question.choices.forEach((c, i) => { c.letter = ["W", "X", "Y", "Z", "V"][i]; }); t2.question.correct_letter = "Y";
  t2.question.wrong_explanations.forEach((w, i) => { w.letter = ["W", "X", "Z", "V"][i]; });
  ok(!rejects(t2, "boards"), "drifted choice letters are renormalized to A–E and then accepted");
  // and the brace-drift hoist still runs first
  const t3 = { title: "T", question: { stem: goodQ.stem, choices: goodQ.choices, correct_letter: "C", explanation: goodQ.explanation, wrong_explanations: goodQ.wrong_explanations, difficulty_level: 4, difficulty_label: "Board-level", key_point: goodBoards.key_point, board_pearls: goodBoards.board_pearls, visual_memory_card: goodVmc } };
  ok(!rejects(t3, "boards"), "a brace-drifted boards talk is still hoisted out of question{} and accepted");
}

// ── 4) both gates apply the SAME bar (a critic rewrite is not held to a lower one) ─
{
  const skeleton = { title: "Example", sections: [{}], summary_points: ["x"], visual_memory_card: { top_left: "x" } };
  let viaParse = false;
  try { vm.runInContext("parseTalkStrict", ctx)(JSON.stringify(skeleton), "lecture"); } catch (e) { viaParse = e.code === "incomplete_talk"; }
  ok(viaParse, "parseTalkStrict (draft path) rejects the skeleton");
  ok(rejects(skeleton, "lecture"), "_assertCompleteTalk (critic-rewrite path) rejects the same skeleton");
  ok(/_normalizeTalkInPlace\(talk, style\)/.test(block(/^function _assertCompleteTalk\(/m)),
     "the rewrite path normalizes identically before judging — the bar can't differ by path");
}

// ── 5) EVERY release path runs the full three-stage citation audit, in order ────
// retryReview() ran verifyCitations() alone: no live PMID existence check, no DOI identity check.
{
  const order = [];
  const actx = {
    console: { warn() {} }, S: { genId: 3, talk: null, citationAuditPending: true }, render: () => {},
    document: { getElementById: () => null },
    async verifyModelPmids(t) { order.push("pmids"); return t; },
    async verifyModelDois(t) { order.push("dois"); return t; },
    async verifyCitations(t) { order.push("citations"); return Object.assign({}, t, { _audited: true }); },
  };
  vm.createContext(actx);
  // run the exact audit expression used by retryReview()
  const retrySrc = html.slice(html.indexOf("async function retryReview"));
  const auditLine = retrySrc.slice(retrySrc.indexOf("var _talkBeforeAudit = finalTalk;"), retrySrc.indexOf("})();") + 5);
  ok(auditLine.includes("verifyModelPmids"), "retryReview's audit mentions verifyModelPmids at all");
  const finalTalk = { title: "T" };
  actx.finalTalk = finalTalk; actx._agid = 3; actx.S.talk = finalTalk;
  vm.runInContext("globalThis.__go = async function(){ " + auditLine.replace("var _agid = S.genId;", "") + " };", actx);
  await vm.runInContext("__go()", actx);
  await new Promise((r) => setTimeout(r, 20));
  ok(JSON.stringify(order) === JSON.stringify(["pmids", "dois", "citations"]),
     `the audit runs PMIDs → DOIs → citations, in that order (got ${JSON.stringify(order)})`);
  ok(actx.S.talk && actx.S.talk._audited === true, "the audited talk replaces S.talk on success");

  // identity guard: a late audit must not overwrite a DIFFERENT talk the user is now reading
  order.length = 0;
  const other = { title: "a saved talk the user opened meanwhile" };
  actx.S.talk = other; actx.S.citationAuditPending = true;
  await vm.runInContext("__go()", actx);
  await new Promise((r) => setTimeout(r, 20));
  ok(actx.S.talk === other, "a late audit does NOT overwrite a different talk (identity guard, not just genId)");
}
// and the same guard exists on the other two paths
ok(/S\.talk === _talkBeforeAudit/.test(html), "generate()'s audit keeps its identity guard");
ok(/_auditGenId === S\.genId && S\.talk === finalTalk/.test(html), "the resume path's audit gained the identity guard too");
{
  // FOUR paths can put an audited talk on screen, not three: generate(), resumeAsyncJobIfAny(),
  // retryReview() and applyProofreadFeedback(). The last already had the full chain; retryReview() did not.
  const n = (html.match(/verifyCitations\(await verifyModelDois\(await verifyModelPmids\(/g) || []).length;
  ok(n === 4, `all 4 release paths use the identical three-stage chain (found ${n})`);
  for (const fn of ["async function generate(", "async function resumeAsyncJobIfAny(", "async function retryReview(", "async function applyProofreadFeedback("]) {
    const i = html.indexOf(fn);
    const body = html.slice(i, html.indexOf("\n}", i) + 2);
    ok(/verifyCitations\(await verifyModelDois\(await verifyModelPmids\(/.test(body), `${fn.replace("async function ", "").replace("(", "()")} runs the full chain`);
  }
  // Per-path, because a global count also catches unrelated guards (e.g. the catch-branch that only
  // resets citationAuditPending). What matters is that each path compares S.talk to the talk it audited
  // BEFORE applying the result — genId alone is not enough, since opening a saved talk doesn't bump it.
  for (const [fn, guard] of [
    ["async function generate(", /if\(S\.talk !== _talkBeforeAudit\) return;/],
    ["async function resumeAsyncJobIfAny(", /S\.talk === finalTalk && audited/],
    ["async function retryReview(", /S\.talk === _talkBeforeAudit && au/],
    ["async function applyProofreadFeedback(", /if\(S\.talk !== _auditTarget\) return;/],
  ]) {
    const i = html.indexOf(fn);
    const body = html.slice(i, html.indexOf("\n}", i) + 2);
    ok(guard.test(body), `${fn.replace("async function ", "").replace("(", "()")} guards on TALK IDENTITY before applying the audit`);
  }
  ok(!/var au = await verifyCitations\(finalTalk\)/.test(html), "the semantic-only audit call is gone");
}

console.log("\n" + (failures === 0 ? "✔ DEEP COMPLETENESS + AUDIT TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
