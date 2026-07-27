// The drug-name detector decides whether a model gets DISQUALIFIED for fabricating a drug, so its false
// positives are as costly as its misses. Run: node rag/test_drug_detector.mjs
//
// 2026-07-26 run: gpt-5.6-sol was flagged for "nonheparin" — but "non-heparin anticoagulant" is standard
// HIT phrasing, an adjective, not a drug name. RxNorm rightly doesn't know it. That is a detector defect,
// not a model defect, and it sat next to a REAL one ("nvancomycin") in the same report. These tests pin
// both behaviours so the fix for the false positive can never quietly weaken the true positive.
import { readFileSync } from "fs";
import vm from "vm";

const src = readFileSync(new URL("./eval_gemini_quality.mjs", import.meta.url), "utf8");
let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

// take each declaration by its own terminator; several are long multi-line literals
function decl(name) {
  const i = src.indexOf("const " + name + " = ");
  if (i < 0) throw new Error("not found: " + name);
  const e = /;\n/.exec(src.slice(i));
  return src.slice(i, i + e.index + 1);
}
function fnSrc(name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error("fn not found: " + name);
  const e = /\n\}/.exec(src.slice(i));
  return src.slice(i, i + e.index + 2);
}

const ctx = { console: { log() {}, warn() {} }, Set, String, Array, Math, RegExp, Infinity };
vm.createContext(ctx);
vm.runInContext([
  decl("DRUGS"), decl("NOT_DRUGS"), decl("DRUGSET"), decl("SUFFIX_OK"), decl("DRUG_SUFFIX"),
  fnSrc("editDistance"), fnSrc("findDrugMisspellings"),
].join("\n"), ctx);
const find = vm.runInContext("findDrugMisspellings", ctx);
const flags = (t) => find(t).map((x) => x.found);

// ── TRUE POSITIVES must survive the false-positive fix ─────────────────────────
ok(flags("give nvancomycin 15 mg/kg IV q12h").includes("nvancomycin"),
   'a mangled real drug ("nvancomycin") is still FLAGGED — this was a genuine gpt-5.6-sol failure');
ok(flags("start apixiban 5 mg BID").includes("apixiban"), 'a near-miss misspelling ("apixiban") is still flagged');
ok(flags("rivarelbaxaban for stroke prevention").length > 0, "an invented anticoagulant is still flagged");

// ── FALSE POSITIVES the 2026-07-26 run produced ────────────────────────────────
ok(!flags("a nonheparin anticoagulant such as argatroban is preferred").includes("nonheparin"),
   '"nonheparin" is NOT flagged — it is an adjective whose stem is a real drug (the actual HIT phrasing)');
ok(!flags("non-heparin agents are preferred in HIT").includes("non-heparin"), '"non-heparin" (hyphenated) is not flagged');
ok(!flags("nonwarfarin options include the DOACs").includes("nonwarfarin"), '"nonwarfarin" is not flagged either — same construction');

// The rule must be STEM-CONDITIONAL, not a blanket "non" pass. Asserted against the source because the
// end-to-end case can't distinguish "exempted" from "never detected": the detector's edit-distance reach
// doesn't span "non" + a mangled stem anyway, so a passing string would prove nothing.
{
  const i = src.indexOf('const stem = tok.replace(/^non-?/');
  ok(i > 0, "the non- exemption exists");
  const rule = src.slice(i, i + 220);
  ok(/DRUGSET\.has\(stem\)/.test(rule), "…and it only applies when the STEM is a confirmable drug");
  ok(/stem !== tok/.test(rule), "…and only when the prefix was actually present (no accidental blanket pass)");
}

// ── previously-fixed false positives stay fixed ────────────────────────────────
for (const [txt, word] of [
  ["the patient took insult at the suggestion", "insult"],
  ["hearing loss was noted", "hearing"],
  ["a vaptan may be considered", "vaptan"],
]) {
  ok(!flags(txt).includes(word), `"${word}" is not flagged at all (regression from earlier false-positive rounds)`);
}

// TWO-LAYER DESIGN, easy to misread: a real drug that simply isn't in the local list is NOT a false
// positive here — it is returned as a CANDIDATE (needsCheck) and RxNorm clears it in verifyDrugFlags().
// The local list is a pre-filter, not the authority. Asserting "not flagged" at this layer would be
// testing the wrong thing, and would break the moment the list changed.
for (const [txt, word] of [["atenolol 25 mg daily", "atenolol"], ["vericiguat added per VICTORIA", "vericiguat"]]) {
  const c = find(txt).find((x) => x.found === word);
  ok(!!c && c.needsCheck === true, `"${word}" is a CANDIDATE for RxNorm, not an asserted misspelling`);
  ok(!!c && c.distance === null, `…and carries no edit-distance claim (it isn't a near-miss of anything)`);
}

console.log("\n" + (failures === 0 ? "✔ DRUG DETECTOR TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
