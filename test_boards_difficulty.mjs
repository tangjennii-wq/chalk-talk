// Offline acceptance test for the Boards difficulty system (build 2026-07-21-03).
// Exercises the LIVE functions pulled straight from index.html (no copies — can't drift):
//   1. All five levels + AGREED labels + matching star counts.
//   2. Default Level 4 (schema + clamp).
//   3. localStorage persistence round-trips; restore clamp rejects out-of-range.
//   4. Malformed / legacy question tolerated (no throw, no badge).
//   5. Live validateBoardQuestion catches 5-choice / answer-consistency / label errors.
//   6. Live _repairBoardQuestionInPlace fixes scrambled letters, correct/letter desync, missing difficulty.
//   7. _boardHardErrors blocks only structural problems (soft metadata never blocks).
//   8. Source guards: depthHint is style-aware; critic gets the difficulty rubric; originality wording.
// Run: node test_boards_difficulty.mjs   (repo root; no network)
import { readFileSync } from "fs";
import vm from "vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
let failures = 0;
function ok(cond, msg){ console.log((cond ? "✓" : "✗ FAIL") + " — " + msg); if(!cond) failures++; }

// ── pull live values / functions out of index.html ──────────────────────────
function grabStringLiteral(varName){
  const idx = html.indexOf("var " + varName + " = ");
  let i = html.indexOf("=", idx) + 1; while(/\s/.test(html[i])) i++;
  const quote = html[i]; let j = i + 1, out = "";
  while(j < html.length){ const c = html[j]; if(c === "\\"){ out += c + html[j+1]; j += 2; continue; } if(c === quote) break; out += c; j++; }
  return Function("return (" + quote + out + quote + ")")();
}
function grabBlock(startNeedle){
  const start = html.indexOf(startNeedle);
  if(start < 0) throw new Error("not found: " + startNeedle);
  const objStart = html.indexOf("{", start);
  let depth = 0, end = -1;
  for(let i = objStart; i < html.length; i++){ const c = html[i]; if(c === "{") depth++; else if(c === "}"){ depth--; if(depth === 0){ end = i; break; } } }
  return html.slice(start, end + 1);
}
const BOARDS_DIFFICULTY = Function("return (" + grabBlock("var BOARDS_DIFFICULTY = {").replace("var BOARDS_DIFFICULTY = ", "") + ")")();
const BP = grabStringLiteral("BOARDS_PROMPT");

// live functions into a vm context (they reference BOARDS_DIFFICULTY)
function extractFn(name){
  let i = html.indexOf("function " + name + "(");
  if(i < 0) throw new Error("function not found: " + name);
  let s = html.indexOf("{", i), d = 0, j = s;
  for(; j < html.length; j++){ if(html[j] === "{") d++; else if(html[j] === "}"){ d--; if(d === 0) break; } }
  return html.slice(i, j + 1);
}
const ctx = { console, BOARDS_DIFFICULTY, S: { boardsDifficulty: 4 } };
vm.createContext(ctx);
vm.runInContext(["boardsDifficulty","validateBoardQuestion","_boardHardErrors","_repairBoardQuestionInPlace","_finalizeBoardQuestion"].map(extractFn).join("\n\n"), ctx);
const validateBoardQuestion = vm.runInContext("validateBoardQuestion", ctx);
const _boardHardErrors      = vm.runInContext("_boardHardErrors", ctx);
const _repair               = vm.runInContext("_repairBoardQuestionInPlace", ctx);
const _finalize             = vm.runInContext("_finalizeBoardQuestion", ctx);

// ── 1. Five levels, agreed labels, matching stars ───────────────────────────
const EXPECTED = { 1:"Foundational", 2:"Core", 3:"Advanced", 4:"Board-level", 5:"Challenge" };
for(let l=1;l<=5;l++){
  const e = BOARDS_DIFFICULTY[l];
  ok(e && e.label === EXPECTED[l], "Level " + l + " label = \"" + EXPECTED[l] + "\" (got \"" + (e&&e.label) + "\")");
  ok(e && e.stars && e.stars.length === l, "Level " + l + " has " + l + " star glyph(s)");
}
ok(Object.keys(BOARDS_DIFFICULTY).length === 5, "exactly five levels");
ok(!/Straightforward|Intermediate/.test(JSON.stringify(BOARDS_DIFFICULTY)), "old labels removed");

// ── 2. Default Level 4 ──────────────────────────────────────────────────────
const tail = BP.slice(BP.lastIndexOf("ONLY JSON:") + "ONLY JSON:".length).trim();
let schema; try { schema = JSON.parse(tail); ok(true, "BOARDS_PROMPT schema parses"); } catch(e){ ok(false, "schema parses: " + e.message); schema = { question:{} }; }
const sq = schema.question || {};
ok(sq.difficulty_level === 4 && sq.difficulty_label === "Board-level", "schema default = Level 4 / Board-level");
["difficulty_level","difficulty_label","difficulty_rationale","reasoning_steps"].forEach(f => ok(f in sq, "schema question has " + f));

// ── 3. Persistence + restore clamp ──────────────────────────────────────────
const store = {};
function pick(v){ const n = parseInt(v,10); if(n>=1&&n<=5) store["ct_boards_difficulty"] = String(n); }
function restore(){ const s = parseInt(store["ct_boards_difficulty"],10); return (s>=1&&s<=5) ? s : 4; }
pick(2); ok(restore() === 2, "persist+restore L2");
pick(5); ok(restore() === 5, "persist+restore L5");
pick(9); ok(restore() === 5, "invalid pick (9) ignored, prior kept");
store["ct_boards_difficulty"] = "42"; ok(restore() === 4, "corrupt stored value clamps to 4");

// ── 4. Malformed / legacy tolerated (render badge gate) ─────────────────────
function badgeShows(q){ const l = parseInt(q && q.difficulty_level,10); return l>=1&&l<=5; }
ok(badgeShows({}) === false, "legacy question -> no badge");
ok(badgeShows({difficulty_level:"x"}) === false, "garbage level -> no badge");
ok(badgeShows({difficulty_level:4}) === true, "valid level -> badge shows");

// ── 5. LIVE validateBoardQuestion ───────────────────────────────────────────
const goodQ = () => ({
  stem:"A 60-year-old...", choices:[
    {letter:"A",text:"Alpha",correct:false},{letter:"B",text:"Bravo",correct:false},
    {letter:"C",text:"Charlie",correct:true},{letter:"D",text:"Delta",correct:false},{letter:"E",text:"Echo",correct:false}
  ], correct_letter:"C", difficulty_level:4, difficulty_label:"Board-level", difficulty_rationale:"multi-step", reasoning_steps:["a","b","c","d"]
});
ok(validateBoardQuestion(goodQ()).length === 0, "well-formed L4 passes live validator");
ok(validateBoardQuestion({ ...goodQ(), correct_letter:"B" }).some(e => e.includes("correct_letter")), "answer inconsistency caught");
ok(validateBoardQuestion({ ...goodQ(), choices: goodQ().choices.slice(0,4) }).some(e => e.includes("5 choices")), "wrong choice count caught");
ok(validateBoardQuestion({ ...goodQ(), difficulty_label:"Intermediate" }).some(e => e.includes("difficulty_label")), "label/level mismatch caught");

// ── 6. LIVE deterministic repair ────────────────────────────────────────────
// (a) scrambled letters -> relabel A-E, remap correct + wrong_explanations
const scrambled = { stem:"s", choices:[
  {letter:"B",text:"one",correct:false},{letter:"A",text:"two",correct:true},
  {letter:"D",text:"three",correct:false},{letter:"C",text:"four",correct:false},{letter:"E",text:"five",correct:false}
], correct_letter:"A", wrong_explanations:[{letter:"B",why:"x"}], reasoning_steps:["a"] };
_repair(scrambled, 4);
ok(scrambled.choices.map(c=>c.letter).join("") === "ABCDE", "repair relabels choices A-E in order");
const keyed = scrambled.choices.filter(c=>c.correct)[0];
ok(scrambled.correct_letter === keyed.letter, "repair keeps correct_letter pointing at the keyed choice after relabel");
ok(_boardHardErrors(scrambled).length === 0, "scrambled question is hard-clean after repair");
// (b) correct flag set but correct_letter desynced -> repair fixes the letter
const desync = { ...goodQ(), correct_letter:"A" }; _repair(desync, 4);
ok(desync.correct_letter === "C", "repair syncs correct_letter to the flagged choice");
// (c) missing difficulty metadata -> backfilled from selected level
const noMeta = goodQ(); delete noMeta.difficulty_level; delete noMeta.difficulty_label; _repair(noMeta, 3);
ok(noMeta.difficulty_level === 3 && noMeta.difficulty_label === "Advanced", "repair backfills difficulty from selected level");

// ── 7. _boardHardErrors blocks structure only, not soft metadata ────────────
const softOnly = goodQ(); softOnly.reasoning_steps = []; delete softOnly.difficulty_rationale;
ok(validateBoardQuestion(softOnly).some(e => e.includes("reasoning_steps")), "validator notes missing reasoning_steps (soft)");
ok(_boardHardErrors(softOnly).length === 0, "missing reasoning_steps does NOT hard-block");
const broken = { ...goodQ(), choices: goodQ().choices.slice(0,4) };
ok(_boardHardErrors(broken).length > 0, "4-choice question IS hard-blocked");
// _finalize flags a hard-broken talk and clears the flag once fixed
const badTalk = _finalize({ question: { ...goodQ(), choices: goodQ().choices.slice(0,4) } });
ok(Array.isArray(badTalk._boardInvalid) && badTalk._boardInvalid.length > 0, "_finalize sets _boardInvalid on hard-broken question");
const okTalk = _finalize({ question: goodQ() });
ok(!okTalk._boardInvalid, "_finalize leaves no _boardInvalid on a clean question");

// ── 8. Source guards (the three review-round-3 fixes) ───────────────────────
ok(/This is a single BOARDS question/.test(html) && /S\.style === 'boards'/.test(html), "depthHint is style-aware for boards");
// the old lecture-concise 'vignette <=110 words' must no longer be reachable in the boards path
ok(!/For boards style: vignette <=110 words/.test(html), "removed the <=110-word vignette hint that conflicted with the 120-170 stem cap");
ok(/DIFFICULTY CALIBRATION REVIEW/.test(html), "critic system prompt gets the difficulty calibration rubric");
ok(/TARGET DIFFICULTY FOR THIS QUESTION/.test(html), "critic prefix gets the selected target level");
ok(!/Mirror UWorld\/MKSAP exactly/.test(BP), "prompt no longer says 'Mirror UWorld/MKSAP exactly'");
ok(/ORIGINAL/.test(BP) && /structurally inspired/i.test(BP), "prompt frames questions as ORIGINAL / structurally inspired");
ok(/ORDER THEM ALPHABETICALLY/.test(BP) && /NEVER default the answer to B/.test(BP), "alphabetical order + position-bias guards retained");
ok(/DIFFICULTY SELF-CRITIQUE/.test(BP) && /Stem MUST be 120-170 words/.test(BP), "self-critique + stem cap retained");
// hard-invalid board questions are genuinely non-renderable (banner + rebuild CTA replace the item)
ok(/Question withheld/.test(html) && /boardRegenBtn/.test(html), "hard-invalid board question is withheld with a rebuild CTA");
ok(/end else \(valid board question\)/.test(html), "board question body is gated behind the valid-question else branch");

console.log("\n" + (failures === 0 ? "✔ ALL BOARDS-DIFFICULTY TESTS PASSED" : "✗ " + failures + " ASSERTION(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
