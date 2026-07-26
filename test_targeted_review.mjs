// Targeted Concise safety-review tests — the speedup must NOT weaken the medical gate.
// Verifies prompt selection, the local completeness gate, and that the withhold path is untouched.
// Run: node test_targeted_review.mjs
import { readFileSync } from "fs";
import vm from "vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

// ── 1) the targeted review is scoped to the five safety categories ─────────────
const i = html.indexOf("var SAFETY_CRITIQUE_PROMPT");
ok(i > 0, "SAFETY_CRITIQUE_PROMPT exists");
const promptSrc = html.slice(i, html.indexOf("\n", i));
for (const [needle, label] of [
  ["NUMBERS AND DOSES", "numbers/doses check present"],
  ["DRUG NAMES", "drug-name check present"],
  ["GUIDELINE ATTRIBUTION", "guideline-attribution check present"],
  ["CITATION VALIDITY", "citation-validity check present"],
  ["INTERNAL CONTRADICTIONS", "internal-contradiction check present"],
]) ok(promptSrc.includes(needle), label);
ok(/verdict\\":\\"clean|verdict\\\":\\\"clean|verdict\W{1,4}clean/.test(promptSrc), "targeted review can return the cheap {verdict:clean} fast path");
ok(/do NOT rewrite prose|Do NOT rewrite prose/i.test(promptSrc), "targeted review is told NOT to do stylistic rewriting (the slow part)");
ok(/do NOT add sections|not add sections/i.test(promptSrc), "targeted review is told NOT to expand completeness");

// ── 2) prompt SELECTION: only concise+lecture+complete gets the targeted review ─
const selSrc = html.match(/var _useTargetedReview[\s\S]{0,400}?LECTURE_CRITIQUE_PROMPT\);/);
ok(!!selSrc, "prompt-selection block found");
const sel = selSrc[0];
ok(/S\.style !== "boards"/.test(sel), "boards NEVER uses the targeted review (keeps full board verification)");
ok(/S\.depth === "concise"/.test(sel), "only Concise uses the targeted review (Detailed keeps the full review)");
ok(/_draftIsComplete\(draftTalk\)/.test(sel), "an INCOMPLETE draft falls back to the full critique (which writes missing content)");

// ── 3) the local completeness gate behaves ─────────────────────────────────────
function loadCompleteness(style) {
  const s = html.indexOf("function _draftIsComplete");
  let d = 0, j = html.indexOf("{", s);
  const start = s;
  for (; j < html.length; j++) { if (html[j] === "{") d++; else if (html[j] === "}") { d--; if (d === 0) break; } }
  const ctx = { S: { style } };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start, j + 1), ctx);
  return vm.runInContext("_draftIsComplete", ctx);
}
const isCompleteLecture = loadCompleteness("lecture");
const goodVmc = { top_left: "a", top_right: "b", bottom_left: "c", bottom_right: "d" };
const fullTalk = { sections: [{ heading: "h", points: ["p"] }], summary_points: ["a", "b", "c", "d"], visual_memory_card: goodVmc };
ok(isCompleteLecture(fullTalk) === true, "a complete lecture draft is judged complete → eligible for the fast review");
ok(isCompleteLecture({ ...fullTalk, summary_points: ["a"] }) === false, "too-few summary_points → NOT eligible (falls back to full critique)");
ok(isCompleteLecture({ ...fullTalk, visual_memory_card: { top_left: "a", top_right: "", bottom_left: "c", bottom_right: "d" } }) === false,
   "an empty VMC quadrant → NOT eligible (falls back to full critique)");
ok(isCompleteLecture({ ...fullTalk, sections: [] }) === false, "no sections → NOT eligible");
ok(isCompleteLecture(null) === false, "null draft → NOT eligible");
ok(loadCompleteness("boards")({}) === true, "boards short-circuits the lecture completeness check (has its own structural repair)");

// ── 4) THE MEDICAL GATE MUST BE UNTOUCHED ──────────────────────────────────────
ok(/for \(var _cAtt = 0; _cAtt < 2 && !critiqueOK; _cAtt\+\+\)/.test(html), "review still ALWAYS runs and still retries once");
ok(/if \(!critiqueOK\) \{/.test(html), "withhold gate still present");
ok(/S\.reviewPending = \{ draft: draftTalk/.test(html), "an unfinished review still WITHHOLDS the draft (never renders unreviewed)");
ok(html.includes("return;   // NO charge, NO S.talk"), "withheld draft still costs no credit and sets no S.talk");
ok(/S\.genPhase = "reviewing"/.test(html), "two-phase wait signal still fires before the review");
const gi = html.indexOf('S.genPhase = "reviewing"'), ci = html.indexOf("var critiqueOK");
ok(gi > 0 && ci > gi, "phase signal comes BEFORE the review loop");
ok(/S\.citationAuditPending = true/.test(html), "background PubMed citation audit still runs after render");

console.log("\n" + (failures === 0 ? "✔ TARGETED REVIEW TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
