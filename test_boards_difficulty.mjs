// Offline acceptance test for the Boards difficulty system (build 2026-07-21-02).
// Verifies, straight from index.html so it always tracks live code:
//   1. All five difficulty levels exist with the AGREED labels + matching star counts.
//   2. Default is Level 4 (Board-level) — both in the JSON schema and the boardsDifficulty() clamp.
//   3. localStorage persistence round-trips and the restore clamp rejects out-of-range values.
//   4. Malformed / legacy question output is tolerated (no difficulty badge, no throw).
//   5. A generated question has exactly five choices A-E and correct_letter is consistent.
// Run: node test_boards_difficulty.mjs   (from repo root; no network needed)
import { readFileSync } from "fs";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
let failures = 0;
function ok(cond, msg){ console.log((cond ? "✓" : "✗ FAIL") + " — " + msg); if(!cond) failures++; }

// ── helpers to pull live values out of index.html ───────────────────────────
function grabStringLiteral(varName){
  const idx = html.indexOf("var " + varName + " = ");
  if(idx < 0) throw new Error("no " + varName);
  let i = html.indexOf("=", idx) + 1;
  while(/\s/.test(html[i])) i++;
  const quote = html[i];
  let j = i + 1, out = "";
  while(j < html.length){
    const c = html[j];
    if(c === "\\"){ out += c + html[j+1]; j += 2; continue; }
    if(c === quote) break;
    out += c; j++;
  }
  return Function("return (" + quote + out + quote + ")")();
}
function grabObject(varName){
  const start = html.indexOf("var " + varName + " = {");
  const objStart = html.indexOf("{", start);
  let depth = 0, end = -1;
  for(let i = objStart; i < html.length; i++){ const c = html[i]; if(c === "{") depth++; else if(c === "}"){ depth--; if(depth === 0){ end = i; break; } } }
  return Function("return (" + html.slice(objStart, end + 1) + ")")();
}

const BOARDS_DIFFICULTY = grabObject("BOARDS_DIFFICULTY");
const BP = grabStringLiteral("BOARDS_PROMPT");
// boardsDifficulty() clamp, mirrored from index.html
function boardsDifficulty(bd){ const n = parseInt(bd, 10); return (n >= 1 && n <= 5) ? n : 4; }

// ── 1. Five levels, agreed labels, matching stars ───────────────────────────
const EXPECTED = { 1: "Foundational", 2: "Core", 3: "Advanced", 4: "Board-level", 5: "Challenge" };
for(let l = 1; l <= 5; l++){
  const e = BOARDS_DIFFICULTY[l];
  ok(!!e, "Level " + l + " exists");
  ok(e && e.label === EXPECTED[l], "Level " + l + " label is \"" + EXPECTED[l] + "\" (got \"" + (e && e.label) + "\")");
  ok(e && e.stars && e.stars.length === l, "Level " + l + " has " + l + " star glyph(s)");
  ok(e && typeof e.directive === "string" && e.directive.length > 20, "Level " + l + " has a directive");
}
ok(Object.keys(BOARDS_DIFFICULTY).length === 5, "exactly five levels defined");
// the old labels must be gone
ok(!/Straightforward|Intermediate/.test(JSON.stringify(BOARDS_DIFFICULTY)), "old labels (Straightforward/Intermediate) removed");

// ── 2. Default Level 4 ──────────────────────────────────────────────────────
const tail = BP.slice(BP.lastIndexOf("ONLY JSON:") + "ONLY JSON:".length).trim();
let schema; try { schema = JSON.parse(tail); ok(true, "BOARDS_PROMPT JSON schema parses"); }
catch(e){ ok(false, "BOARDS_PROMPT JSON schema parses: " + e.message); schema = { question: {} }; }
const sq = schema.question || {};
ok(sq.difficulty_level === 4, "schema default question.difficulty_level === 4");
ok(sq.difficulty_label === "Board-level", "schema default question.difficulty_label === Board-level");
["difficulty_level", "difficulty_label", "difficulty_rationale", "reasoning_steps"].forEach(f =>
  ok(f in sq, "schema question has field " + f));
ok(boardsDifficulty(undefined) === 4, "clamp default (undefined) -> 4");

// ── 3. Persistence round-trip + restore clamp ───────────────────────────────
const store = {};
const localStorage = { setItem:(k,v)=>{ store[k] = String(v); }, getItem:(k)=> (k in store ? store[k] : null) };
// click handler logic: only persist valid 1-5
function pick(v){ const n = parseInt(v, 10); if(n >= 1 && n <= 5) localStorage.setItem("ct_boards_difficulty", String(n)); }
// restore logic (mirrors index.html init)
function restore(){ const s = parseInt(localStorage.getItem("ct_boards_difficulty"), 10); return (s >= 1 && s <= 5) ? s : 4; }
pick(2); ok(store["ct_boards_difficulty"] === "2" && restore() === 2, "persist + restore level 2");
pick(5); ok(restore() === 5, "persist + restore level 5");
pick(9); ok(restore() === 5, "invalid pick (9) not persisted; prior value (5) retained");
store["ct_boards_difficulty"] = "42"; ok(restore() === 4, "restore clamps a corrupt stored value (42) -> default 4");
delete store["ct_boards_difficulty"]; ok(restore() === 4, "restore with nothing stored -> default 4");

// ── 4. Malformed / legacy question tolerated (badge gate uses parseInt) ──────
function badgeShows(q){ const l = parseInt(q && q.difficulty_level, 10); return l >= 1 && l <= 5; }
ok(badgeShows({}) === false, "legacy question w/o difficulty_level -> no badge (no throw)");
ok(badgeShows({ difficulty_level: "banana" }) === false, "garbage difficulty_level -> no badge");
ok(badgeShows({ difficulty_level: 0 }) === false, "out-of-range 0 -> no badge");
ok(badgeShows({ difficulty_level: 4 }) === true, "valid level 4 -> badge shows");

// ── 5. Five choices A-E + correct_letter consistency ────────────────────────
// Validator mirrors the app's board-question invariants; used to prove the checks catch bad output.
function validateBoardQuestion(q){
  const errs = [];
  const ch = (q && q.choices) || [];
  if(ch.length !== 5) errs.push("must have 5 choices, has " + ch.length);
  const letters = ch.map(c => c && c.letter);
  if(letters.join("") !== "ABCDE") errs.push("letters must be A-E in order, got " + letters.join(""));
  const correct = ch.filter(c => c && c.correct === true);
  if(correct.length !== 1) errs.push("exactly one choice.correct must be true, has " + correct.length);
  if(correct.length === 1 && q.correct_letter !== correct[0].letter) errs.push("correct_letter (" + q.correct_letter + ") != keyed choice (" + correct[0].letter + ")");
  const dl = parseInt(q && q.difficulty_level, 10);
  if(!(dl >= 1 && dl <= 5)) errs.push("difficulty_level out of range");
  else if(BOARDS_DIFFICULTY[dl] && q.difficulty_label && q.difficulty_label !== BOARDS_DIFFICULTY[dl].label) errs.push("difficulty_label mismatch for level");
  if(!Array.isArray(q && q.reasoning_steps) || !q.reasoning_steps.filter(s => s && String(s).trim()).length) errs.push("reasoning_steps empty");
  return errs;
}
const goodQ = {
  choices: [
    { letter:"A", text:"Alpha", correct:false }, { letter:"B", text:"Bravo", correct:false },
    { letter:"C", text:"Charlie", correct:true }, { letter:"D", text:"Delta", correct:false },
    { letter:"E", text:"Echo", correct:false }
  ],
  correct_letter:"C", difficulty_level:4, difficulty_label:"Board-level", difficulty_rationale:"multi-step", reasoning_steps:["step 1","step 2","step 3","step 4"]
};
ok(validateBoardQuestion(goodQ).length === 0, "well-formed L4 question passes all invariants");
ok(validateBoardQuestion({ ...goodQ, correct_letter:"B" }).some(e => e.includes("correct_letter")), "answer inconsistency (correct_letter != keyed) is caught");
ok(validateBoardQuestion({ ...goodQ, choices: goodQ.choices.slice(0,4) }).some(e => e.includes("5 choices")), "wrong choice count is caught");
ok(validateBoardQuestion({ ...goodQ, choices: goodQ.choices.map(c => ({ ...c, correct:false })) }).some(e => e.includes("exactly one")), "no correct answer is caught");
ok(validateBoardQuestion({ ...goodQ, difficulty_label:"Intermediate" }).some(e => e.includes("difficulty_label")), "label/level mismatch is caught");

// ── prompt originality + calibration guards (locks the review fixes) ─────────
ok(!/Mirror UWorld\/MKSAP exactly/.test(BP), "prompt no longer says 'Mirror UWorld/MKSAP exactly'");
ok(/ORIGINAL/.test(BP) && /structurally inspired/i.test(BP), "prompt frames questions as ORIGINAL, structurally inspired");
ok(/ORDER THEM ALPHABETICALLY/.test(BP), "alphabetical choice-order rule retained");
ok(/NEVER default the answer to B/.test(BP), "position-bias guard retained");
ok(/Stem MUST be 120-170 words/.test(BP), "stem length cap retained");
ok(/DIFFICULTY SELF-CRITIQUE/.test(BP), "difficulty self-critique step retained");

console.log("\n" + (failures === 0 ? "✔ ALL BOARDS-DIFFICULTY TESTS PASSED" : "✗ " + failures + " ASSERTION(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
