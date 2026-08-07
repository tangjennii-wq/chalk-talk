// BEHAVIOURAL tests for patch-based review. Run: node test_patch_review.mjs
//
// The critic used to re-emit the whole corrected talk. That is most of the 3-4 minute wait, and it is how
// a rewrite silently dropped key_point/board_pearls in the 2026-07-26 benchmark — a model re-emitting
// everything can omit anything. Now it returns only corrections.
//
// The safety claim being tested: a patch set is applied to a COPY, all-or-nothing, and the SAME whole-talk
// schema gate then runs on the result. Patching buys no exemption. If these tests pass, patch review is
// strictly safer than the rewrite it replaces, not merely faster.
import { readFileSync } from "fs";
import vm from "vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
function block(re) { const m = html.match(re); if (!m) throw new Error("not found: " + re); const i = m.index, e = /\n\};?/.exec(html.slice(i)); return html.slice(i, i + e.index + e[0].length); }
const line = (re) => { const m = html.match(re); if (!m) throw new Error("line not found: " + re); return m[0]; };
const objLit = (n) => { const i = html.indexOf("var " + n + " = {"); const e = /\n\};?/.exec(html.slice(i)); return html.slice(i, i + e.index + e[0].length); };

const ctx = { console: { warn() {}, info() {} }, S: { boardsDifficulty: 4 }, JSON, parseInt, String, Array, Object, Error };
vm.createContext(ctx);
vm.runInContext([
  block(/^function fixJSON\(/m),
  objLit("BOARDS_DIFFICULTY"), line(/^function boardsDifficulty\(.*$/m),
  block(/^function _repairBoardQuestionInPlace\(/m),
  line(/^var _BOARD_TOPLEVEL_FIELDS = .*$/m), block(/^function _hoistMisplacedBoardFields\(/m),
  line(/^var _MIN_MEANINGFUL = .*$/m), line(/^var _MIN_BOARD_PEARLS = .*$/m),
  line(/^function _meaningful\(.*$/m), block(/^function _meaningfulList\(/m),
  line(/^var _VMC_QUADRANTS = .*$/m), block(/^function _vmcIncomplete\(/m),
  line(/^var _REQUIRED_LECTURE_FIELDS = .*$/m), line(/^var _REQUIRED_BOARDS_FIELDS  = .*$/m),
  block(/^function _missingTalkFields\(/m), block(/^function _normalizeTalkInPlace\(/m),
  block(/^function _assertCompleteTalk\(/m),
  block(/^function _assertRefinePreservesCompleteness\(/m),
  line(/^var PATCH_MAX_COUNT = .*$/m), line(/^var PATCH_MAX_TOTAL_CHARS = .*$/m), line(/^var _PATCH_PATH_RE = .*$/m),
  block(/^function _resolvePatchPath\(/m), block(/^function applyTalkPatches\(/m),
  "function deepCleanCitations(t){ return t; }",
  block(/^function acceptCritique\(/m),
].join("\n"), ctx);
const apply = vm.runInContext("applyTalkPatches", ctx);
const accept = vm.runInContext("acceptCritique", ctx);
const preserveRefine = vm.runInContext("_assertRefinePreservesCompleteness", ctx);

const VMC = () => ({ top_left: "Na <120", top_right: "Check urine osm", bottom_left: "SIADH", bottom_right: "Correct <8/24h" });
const talk = () => ({
  title: "Hyponatremia", subtitle: "Water handling",
  sections: [
    { heading: "Physiology", points: ["ADH drives free water retention", "Correct at 12 mEq/L/24h"], teaching_pearl: "You must drink to become hyponatremic" },
    { heading: "Treatment", points: ["3% saline for seizures"] },
  ],
  summary_points: ["Correct slowly to avoid ODS"], visual_memory_card: VMC(),
  references: [{ id: 1, source: "KDIGO", year: 2024 }, { id: 2, source: "Unused ref", year: 2020 }],
});

// ── 1) the point of the whole exercise: a wrong NUMBER is fixed by one small patch ──
{
  const t = talk();
  const r = apply(t, [{ op: "replace", path: "sections[0].points[1]", value: "Correct at no more than 8 mEq/L/24h" }], "lecture");
  ok(r.ok, `a single numeric correction applies${r.ok ? "" : " — " + r.error}`);
  ok(r.talk.sections[0].points[1].includes("8 mEq/L"), "the dangerous number is corrected");
  ok(r.talk.sections[0].points[0] === "ADH drives free water retention", "…and the untouched bullet is byte-identical");
  ok(r.talk.sections[1].points.length === 1 && r.talk.summary_points.length === 1,
     "…and nothing else in the talk moved (a patch cannot drop what it never names — the rewrite bug)");
  ok(t.sections[0].points[1] === "Correct at 12 mEq/L/24h", "the ORIGINAL talk is not mutated (applied to a copy)");
}

// ── 2) every op works on the paths the prompt advertises ───────────────────────
{
  const r = apply(talk(), [
    { op: "replace", path: "visual_memory_card.top_left", value: "Na <125" },
    { op: "replace", path: "title", value: "Hyponatremia and SIADH" },
    { op: "append", path: "summary_points", value: "Check urine osmolality before treating" },
    { op: "delete", path: "references[1]" },
  ], "lecture");
  ok(r.ok, `replace + append + delete all apply together${r.ok ? "" : " — " + r.error}`);
  ok(r.talk.visual_memory_card.top_left === "Na <125", "nested object path resolves");
  ok(r.talk.summary_points.length === 2, "append adds to an array");
  ok(r.talk.references.length === 1 && r.talk.references[0].source === "KDIGO", "delete removes the right array item");
}

// ── 3) A PATCH SET CANNOT BE A REWRITE IN DISGUISE ─────────────────────────────
{
  const many = Array.from({ length: 41 }, (_, i) => ({ op: "replace", path: "title", value: "x" + i }));
  const r1 = apply(talk(), many, "lecture");
  ok(!r1.ok && /too many patches/.test(r1.error), `41 patches is REJECTED as a rewrite (${r1.error || ""})`);

  const huge = [{ op: "replace", path: "title", value: "y".repeat(12001) }];
  const r2 = apply(talk(), huge, "lecture");
  ok(!r2.ok && /payload too large/.test(r2.error), "an oversized payload is REJECTED as a rewrite");
}

// ── 4) malformed patches are rejected, ATOMICALLY ──────────────────────────────
for (const [label, patches, expect] of [
  ["a path that doesn't exist", [{ op: "replace", path: "sections[9].heading", value: "x" }], /unresolvable|does not exist/],
  ["a nonsense path", [{ op: "replace", path: "sections..points", value: "x" }], /unresolvable/],
  ["an unknown op", [{ op: "rewrite", path: "title", value: "x" }], /unknown op/],
  ["deleting past the end of an array", [{ op: "delete", path: "summary_points[7]" }], /out of range/],
  ["appending to a non-array", [{ op: "append", path: "title", value: "x" }], /not an array/],
  ["replacing a string with an object", [{ op: "replace", path: "title", value: { a: 1 } }], /type mismatch/],
  ["prototype pollution via __proto__", [{ op: "replace", path: "__proto__.polluted", value: "x" }], /unresolvable/],
  ["prototype pollution via constructor", [{ op: "replace", path: "constructor.prototype", value: "x" }], /unresolvable/],
]) {
  const t = talk();
  const r = apply(t, patches, "lecture");
  ok(!r.ok && expect.test(r.error || ""), `REJECTED: ${label} (${(r.error || "").slice(0, 60)})`);
  ok(JSON.stringify(t) === JSON.stringify(talk()), `…and ${label} left the original talk untouched`);
}
ok(({}).polluted === undefined, "no prototype was polluted by the attempted patches");

// ── 5) ONE bad patch rejects the WHOLE set — no partial application ────────────
{
  const r = apply(talk(), [
    { op: "replace", path: "title", value: "Fixed title" },
    { op: "replace", path: "sections[99].heading", value: "boom" },
  ], "lecture");
  ok(!r.ok, "a set containing one bad patch is rejected entirely");
  ok(!r.talk, "…and no partially-patched talk is returned (a half-corrected medical talk is unknown-state)");
}

// ── 6) THE WHOLE-TALK GATE STILL RUNS AFTER PATCHING ──────────────────────────
// This is the safety claim. Patches are not exempt from the completeness rules.
{
  const r = apply(talk(), [{ op: "replace", path: "visual_memory_card.bottom_right", value: "" }], "lecture");
  ok(!r.ok && /incomplete/.test(r.error), "a patch that BLANKS a required field is rejected by the schema gate");
  const r2 = apply(talk(), [{ op: "delete", path: "sections[0]" }, { op: "delete", path: "sections[0]" }], "lecture");
  ok(!r2.ok, "a patch set that empties sections[] is rejected");
}

// ── 6b) LEGACY SAVED TALKS CAN BE EDITED WITHOUT WAIVING SAFETY ──────────────
// Old library rows can pre-date summary_points and the memory card. A surgical correction must not be
// rejected merely because those gaps already existed, but it still cannot damage a field that was sound.
{
  const legacy = {
    title: "Old hyponatremia talk",
    sections: [{ heading: "Treatment", points: ["Correct sodium slowly"] }],
  };
  const corrected = JSON.parse(JSON.stringify(legacy));
  corrected.sections[0].points[0] = "Correct sodium by no more than 8 mEq/L in 24 hours";
  let legacyError = null;
  try { preserveRefine(legacy, corrected, "lecture", "legacy refine"); } catch(e) { legacyError = e; }
  ok(!legacyError, "a valid surgical edit lands on a legacy talk with pre-existing schema gaps");

  const damaged = JSON.parse(JSON.stringify(legacy));
  damaged.sections[0].points = [];
  let damageError = null;
  try { preserveRefine(legacy, damaged, "lecture", "legacy refine"); } catch(e) { damageError = e; }
  ok(damageError && /sections\[0\]/.test((damageError.missing || []).join(",")),
     "a legacy edit is still rejected when it creates a new completeness gap");

  const current = talk();
  const brokenCurrent = JSON.parse(JSON.stringify(current));
  brokenCurrent.visual_memory_card.bottom_right = "";
  let currentError = null;
  try { preserveRefine(current, brokenCurrent, "lecture", "current refine"); } catch(e) { currentError = e; }
  ok(currentError && /visual_memory_card/.test((currentError.missing || []).join(",")),
     "current-schema talks retain the full completeness bar");
}

// ── 7) acceptCritique(): the three shapes, one path ───────────────────────────
{
  const d = talk();
  const clean = accept('{"verdict":"clean"}', d, "lecture", "t");
  ok(clean.talk === d && clean.rewrote === false, '"clean" returns the DRAFT untouched and records no rewrite');

  const patched = accept(JSON.stringify({ verdict: "corrected", patches: [{ op: "replace", path: "title", value: "Fixed" }] }), d, "lecture", "t");
  ok(patched.talk.title === "Fixed" && patched.patched === true && patched.rewrote === true,
     "a patch set is applied and recorded as a rewrite (so the critic counts as a writer for provenance)");
  ok(patched.patchCount === 1, "the patch count is reported (for the console/telemetry)");

  const full = Object.assign(talk(), { title: "Whole-talk rewrite" });
  const fell = accept(JSON.stringify(full), d, "lecture", "t");
  ok(fell.talk.title === "Whole-talk rewrite" && fell.patched === false,
     "a FULL talk is still accepted — an older Worker's critique keeps working");

  let threw = null;
  try { accept(JSON.stringify({ verdict: "corrected", patches: [{ op: "replace", path: "nope", value: "x" }] }), d, "lecture", "t"); }
  catch (e) { threw = e; }
  ok(threw && threw.code === "bad_patch", "a bad patch set THROWS (callers treat it as a failed review → retry → withhold)");

  let threw2 = null;
  try { accept('{"something":"else"}', d, "lecture", "t"); } catch (e) { threw2 = e; }
  ok(threw2 && /unrecognized/.test(threw2.message), "an unrecognized shape still throws");

  // a full-talk fallback must still meet the completeness bar
  let threw3 = null;
  try { accept(JSON.stringify({ title: "only a title" }), d, "lecture", "t"); } catch (e) { threw3 = e; }
  ok(threw3 && threw3.code === "incomplete_talk", "a SKELETAL full-talk rewrite is still rejected by the gate");
}

// ── 8) boards patches reach the nested question ───────────────────────────────
{
  const b = {
    title: "DKA", key_point: "Close the anion gap before stopping insulin",
    board_pearls: ["Check K before insulin", "Anion gap closure ends the DKA", "Dextrose when glucose <200"],
    visual_memory_card: VMC(),
    question: {
      stem: "A 24-year-old with DKA...", correct_letter: "C", explanation: "Potassium must be replaced first.",
      choices: ["A", "B", "C", "D", "E"].map((l) => ({ letter: l, text: "option " + l, correct: l === "C" })),
      wrong_explanations: ["A", "B", "D", "E"].map((l) => ({ letter: l, why: "wrong because " + l })),
      difficulty_level: 4, difficulty_label: "Board-level",
    },
  };
  const r = apply(b, [
    { op: "replace", path: "question.choices[1].text", value: "Give insulin before checking potassium" },
    { op: "replace", path: "question.wrong_explanations[0].why", value: "Insulin before K risks fatal hypokalemia" },
  ], "boards");
  ok(r.ok, `boards question internals are patchable${r.ok ? "" : " — " + r.error}`);
  ok(r.talk.question.choices[1].text.includes("hypokalemia") === false && r.talk.question.choices[1].text.includes("insulin"),
     "the choice text is corrected");
  ok(r.talk.question.choices.filter((c) => c.correct).length === 1, "exactly one correct answer survives");
}

// ── 9) all three review sites share ONE acceptance path ───────────────────────
{
  ok((html.match(/function acceptCritique\(/g) || []).length === 1, "acceptCritique() is defined exactly once");
  for (const fn of ["async function generate(", "async function resumeAsyncJobIfAny(", "async function retryReview("]) {
    const i = html.indexOf(fn);
    const body = html.slice(i, html.indexOf("\n}", html.indexOf("S.talk = ", i)) + 2);
    ok(/acceptCritique\(/.test(body), `${fn.replace("async function ", "").replace("(", "()")} goes through acceptCritique()`);
  }
  ok((html.match(/var CRITIQUE_OUTPUT_CONTRACT = /g) || []).length === 1, "the output contract is written once, not three times");
  ok((html.match(/CRITIQUE_OUTPUT_CONTRACT;/g) || []).length === 3, "…and all three critique prompts use it");
}

console.log("\n" + (failures === 0 ? "✔ PATCH REVIEW TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
