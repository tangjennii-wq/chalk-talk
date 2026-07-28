// The correct answer's POSITION must be assigned in code, never derived from its wording.
// Run: node test_choice_shuffle.mjs
//
// WHY THIS EXISTS. BOARDS_PROMPT used to mandate alphabetical choice order to kill position bias. It did
// not kill it — it relocated it. Alphabetical order ties the answer's slot deterministically to its text,
// and the model composed distractors that sort ahead of the correct answer. Measured over the first 11
// generated items: correct_letter was C, D or E every single time and A or B never once (p ~ 0.36% under
// uniform placement). A resident who learns "never A or B" is rewarded for letter-guessing.
//
// Codex, 2026-07-28: "preserve the correct option by stable ID, apply a code-controlled random shuffle
// after generation, and recompute correct_letter after shuffling. Test that every option can occupy A-E
// and that the correct option's identity survives the shuffle."
import { readFileSync } from "fs";
import vm from "vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const block = (re) => { const m = html.match(re); if (!m) throw new Error("not found: " + re); const i = m.index, e = /\n\}/.exec(html.slice(i)); return html.slice(i, i + e.index + 2); };
const line  = (re) => { const m = html.match(re); if (!m) throw new Error("line not found: " + re); return m[0]; };
const objLit = (n) => { const i = html.indexOf("var " + n + " = {"); const e = /\n\};?/.exec(html.slice(i)); return html.slice(i, i + e.index + e[0].length); };

const ctx = { console: { warn() {}, info() {} }, Math, Array, Object, JSON, String, parseInt };
vm.createContext(ctx);
vm.runInContext([
  objLit("BOARDS_DIFFICULTY"),
  block(/^function _shuffleBoardChoicesInPlace\(/m),
  block(/^function _repairBoardQuestionInPlace\(/m),
].join("\n"), ctx);
const shuffle = vm.runInContext("_shuffleBoardChoicesInPlace", ctx);
const repair  = vm.runInContext("_repairBoardQuestionInPlace", ctx);

const mk = (correctIdx = 2) => ({
  stem: "stem",
  choices: ["alpha option", "bravo option", "charlie option", "delta option", "echo option"]
    .map((t, i) => ({ letter: "ABCDE"[i], text: t, correct: i === correctIdx })),
  correct_letter: "ABCDE"[correctIdx],
  wrong_explanations: "ABCDE".split("").filter((_, i) => i !== correctIdx).map(l => ({ letter: l, why: "because " + l })),
  difficulty_level: 4, difficulty_label: "Board-level",
});

// ── 1 · every option can reach every slot ─────────────────────────────────────
{
  const seen = {};                      // text -> Set of letters it has occupied
  const keyLetters = {};                // correct_letter frequency
  for (let n = 0; n < 4000; n++) {
    const q = mk(2);
    shuffle(q);
    q.choices.forEach(c => { (seen[c.text] = seen[c.text] || new Set()).add(c.letter); });
    keyLetters[q.correct_letter] = (keyLetters[q.correct_letter] || 0) + 1;
  }
  const texts = Object.keys(seen);
  ok(texts.length === 5, "all five options observed");
  ok(texts.every(t => seen[t].size === 5), "EVERY option occupied EVERY slot A-E across runs");
  const letters = ["A", "B", "C", "D", "E"];
  ok(letters.every(l => keyLetters[l] > 0), "the correct answer landed on every letter including A and B");
  // 4000 draws, expect ~800 each; anything outside 600-1000 is a broken permutation, not variance
  const bad = letters.filter(l => keyLetters[l] < 600 || keyLetters[l] > 1000);
  ok(bad.length === 0, `correct-answer placement is uniform (${letters.map(l => l + ":" + keyLetters[l]).join(" ")})`);
}

// ── 2 · identity survives — the flagged option is still the flagged option ────
{
  for (let n = 0; n < 500; n++) {
    const q = mk(2);
    shuffle(q);
    const flagged = q.choices.filter(c => c.correct === true);
    if (flagged.length !== 1) { ok(false, "exactly one option stays flagged correct"); break; }
    if (flagged[0].text !== "charlie option") { ok(false, "the flagged option is still the ORIGINAL correct text"); break; }
    if (q.correct_letter !== flagged[0].letter) { ok(false, "correct_letter names the flagged option"); break; }
    if (n === 499) {
      ok(true, "exactly one option stays flagged correct");
      ok(true, "the flagged option is still the ORIGINAL correct text — identity travels with the object");
      ok(true, "correct_letter is recomputed from the flag, not carried across");
    }
  }
}

// ── 3 · wrong_explanations follow their options ──────────────────────────────
{
  let allGood = true;
  for (let n = 0; n < 500; n++) {
    const q = mk(2);
    const before = {};                                    // original letter -> its text
    q.choices.forEach(c => { before[c.letter] = c.text; });
    const whyByOriginalText = {};
    q.wrong_explanations.forEach(w => { whyByOriginalText[before[w.letter]] = w.why; });
    shuffle(q);
    // after the shuffle, each wrong explanation must point at the letter now held by its ORIGINAL text
    for (const w of q.wrong_explanations) {
      const nowHolding = q.choices.find(c => c.letter === w.letter);
      if (!nowHolding || whyByOriginalText[nowHolding.text] !== w.why) { allGood = false; break; }
    }
    if (!allGood) break;
  }
  ok(allGood, "each wrong_explanation still points at the option it was written about");
  const q = mk(2); shuffle(q);
  ok(q.wrong_explanations.length === 4 && !q.wrong_explanations.some(w => w.letter === q.correct_letter),
     "no wrong_explanation points at the correct answer after shuffling");
}

// ── 4 · idempotent — the answer must not move between draft and final ────────
{
  const q = mk(1);
  shuffle(q);
  const first = q.correct_letter, order = q.choices.map(c => c.text).join("|");
  shuffle(q); shuffle(q);
  ok(q.correct_letter === first && q.choices.map(c => c.text).join("|") === order,
     "shuffling twice is a no-op — the answer cannot move between the draft preview and the final talk");
  ok(q._choicesShuffled === true, "…guarded by an explicit marker, not by luck");
}

// ── 5 · the repair path applies it, on every route ───────────────────────────
{
  const q = mk(0);
  repair(q, 4);
  ok(q._choicesShuffled === true, "_repairBoardQuestionInPlace shuffles — so parse, critique and resume all get it");
  const flagged = q.choices.filter(c => c.correct === true);
  ok(flagged.length === 1 && q.correct_letter === flagged[0].letter, "…and the key survives the repair path intact");
}

// ── 6 · malformed sets are left to the repair logic, not mangled ─────────────
{
  const q = { choices: [{ letter: "A", text: "only one", correct: true }], correct_letter: "A" };
  shuffle(q);
  ok(!q._choicesShuffled && q.choices.length === 1, "a malformed choice set is left alone rather than half-shuffled");
}

// ── 7 · nothing may re-impose alphabetical order ─────────────────────────────
{
  ok(!/ORDER THEM ALPHABETICALLY/.test(html), "the writer prompt no longer mandates alphabetical order");
  ok(!/sorted alphabetically/.test(html), "the CRITIC prompt no longer tells the reviewer to re-sort the choices");
  ok(/DO NOT ORDER THEM AT ALL/.test(html), "…the writer is told ordering is discarded");
  ok(/do NOT reorder the choices/.test(html), "…and the critic is told not to reorder");
  // this is the one that actually bites: a critic that re-sorts silently undoes the shuffle
  ok(/re-sorting here would be undone/.test(html), "…and is told WHY, so nobody re-adds the sort");
}

console.log("\n" + (failures === 0 ? "✔ CHOICE SHUFFLE TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
