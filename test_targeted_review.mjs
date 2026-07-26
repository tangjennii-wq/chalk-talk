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
  ["PHYSIOLOGY AND PHARMACOLOGY", "physiology/pharmacology check present (Codex 2026-07-26)"],
  ["OUTDATED TREATMENT RECOMMENDATIONS", "outdated-treatment check present (Codex 2026-07-26)"],
  ["WRONG LANDMARK-TRIAL ATTRIBUTION", "landmark-trial attribution check present (Codex 2026-07-26)"],
  ["DRUG NAMES", "drug-name check present"],
  ["GUIDELINE ATTRIBUTION", "guideline-attribution check present"],
  ["CITATION VALIDITY", "citation-validity check present"],
  ["INTERNAL CONTRADICTIONS", "internal-contradiction check present"],
]) ok(promptSrc.includes(needle), label);
ok(/verdict\\":\\"clean|verdict\\\":\\\"clean|verdict\W{1,4}clean/.test(promptSrc), "targeted review can return the cheap {verdict:clean} fast path");
ok(/do NOT rewrite prose|Do NOT rewrite prose/i.test(promptSrc), "targeted review is told NOT to do stylistic rewriting (the slow part)");
ok(/do NOT add sections|not add sections/i.test(promptSrc), "targeted review is told NOT to expand completeness");
ok(/MEDICAL-SAFETY check, not a style check/.test(promptSrc), "the broadened checks are framed as safety, not style");
ok(/eight things/.test(promptSrc) && /eight checks/.test(promptSrc), "the count is consistent after broadening (eight checks)");

// ── 2) prompt SELECTION: only concise+lecture+complete gets the targeted review ─
const selSrc = html.match(/var _useTargetedReview[\s\S]{0,300}?_draftIsComplete\(draftTalk\);/);
ok(!!selSrc, "prompt-selection block found");
const sel = selSrc ? selSrc[0] : "";
ok(/S\.style !== "boards"/.test(sel), "boards NEVER uses the targeted review (keeps full board verification)");
ok(/S\.depth === "concise"/.test(sel), "only Concise uses the targeted review (Detailed keeps the full review)");
ok(/_draftIsComplete\(draftTalk\)/.test(sel), "an INCOMPLETE draft falls back to the full critique (which writes missing content)");
ok(/!_useAsync/.test(sel), "async path is excluded (its full critique spec was already submitted server-side)");
ok(/critiqueSystem = SAFETY_CRITIQUE_PROMPT/.test(html), "the targeted prompt is actually assigned to critiqueSystem");

// ── 2b) REGRESSION: the var-hoisting bug that made this whole feature dead code ──
// _useTargetedReview called _draftIsComplete(draftTalk) ~60 lines BEFORE `var draftTalk` was declared.
// Hoisting made it undefined, _draftIsComplete(undefined) returned false, and the targeted review never
// ran once. Assert the declaration precedes the use. (Same bug class as the _draftWebSearched hoist.)
const iDraftDecl = html.indexOf("var draftTalk = JSON.parse(fixJSON(txt));");
const iUse = html.indexOf("var _useTargetedReview");
ok(iDraftDecl > 0 && iUse > 0, "found both the draftTalk declaration and the _useTargetedReview use");
ok(iDraftDecl < iUse, "draftTalk is DECLARED BEFORE _useTargetedReview reads it (no var-hoisting undefined)");
// critiqueSystem must still hold a valid prompt at the async submit, which happens before the draft
const iCritDecl = html.indexOf("var critiqueSystem =");
const iAsyncSubmit = html.indexOf("critique: { sys: critiqueSystem");
ok(iCritDecl > 0 && iAsyncSubmit > iCritDecl, "critiqueSystem is initialised before the async submit sends it");
ok(iAsyncSubmit < iUse, "async submit happens before the targeted swap → async is always FULLY reviewed");

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

// ── 5) audit must not overwrite a DIFFERENT talk (identity guard, not just genId) ─
// S.genId is bumped only by generate() and the async resume, so opening a talk from the Library, a
// shared talk, or an instant depth swap left it unchanged — and the in-flight audit then replaced the
// talk on screen with the PREVIOUS talk's audited content. Found independently by two audits.
const auditBlock = html.slice(html.indexOf("async function runBackgroundAudit"), html.indexOf("async function runBackgroundAudit") + 1400);
ok(auditBlock.includes("if(S.talk !== _talkBeforeAudit) return;"),
   "background audit bails when S.talk is no longer the talk it audited (identity guard)");
const iIdent = auditBlock.indexOf("S.talk !== _talkBeforeAudit"), iAssign = auditBlock.indexOf("S.talk = auditedTalk");
ok(iIdent > 0 && iAssign > iIdent, "the identity guard runs BEFORE the audit result is assigned");

// ── 6) cancel flag: stale check must precede consuming the shared S.genCancelled ──
// S.genCancelled is one global. When a superseded generation consumed+reset it first, a NEWER
// generation never saw the user's Cancel and rendered + charged for a cancelled talk.
const cancelIdx = html.indexOf("if (_myGenId !== S.genId) return;\n    if (S.genCancelled) { S.genCancelled = false; return; }");
ok(cancelIdx > 0, "stale-gen check comes BEFORE consuming S.genCancelled (a stale gen can't eat a newer gen's cancel)");

console.log("\n" + (failures === 0 ? "✔ TARGETED REVIEW TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
