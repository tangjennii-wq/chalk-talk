// NEVER DISPLAY PARTIALLY PARSED MEDICAL CONTENT (Codex 2026-07-26).
// Regression fixtures are REAL model outputs from the 20-row benchmark that failed to parse
// (rag/fixtures_unparseable_talks.json). The fix for a truncated talk is a retry, NOT a more permissive
// fixJSON — so these assertions exist to stop anyone "fixing" the failures by lowering the bar.
// Run: node test_parse_strict.mjs
import { readFileSync } from "fs";
import vm from "vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const F = JSON.parse(readFileSync(new URL("./rag/fixtures_unparseable_talks.json", import.meta.url), "utf8"));
let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

// Slice a whole function by its real end (a column-0 "\n}"), never by a magic character count —
// a fixed-length window silently stops covering the tail of the function as soon as anyone adds a line.
function fnBody(name){
  const i = html.indexOf(name);
  if(i < 0) throw new Error("not found: " + name);
  const e = /\n\}/.exec(html.slice(i));
  return html.slice(i, e ? i + e.index + 2 : html.length);
}

function block(re) {
  const m = html.match(re); if (!m) throw new Error("not found: " + re);
  const i = m.index, e = /\n\};?/.exec(html.slice(i));
  return html.slice(i, i + e.index + e[0].length);
}
const line = (re) => (html.match(re) || [""])[0];

const ctx = { console: { warn() {} }, S: { boardsDifficulty: 4 }, parseInt, String, Array, Object, JSON };
vm.createContext(ctx);
const objLiteral = (name) => { const i = html.indexOf("var " + name + " = {"); const e = /\n\};?/.exec(html.slice(i)); return html.slice(i, i + e.index + e[0].length); };
vm.runInContext([
  block(/^function fixJSON\(/m),
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
  line(/^var _REQUIRED_LECTURE_FIELDS = .*$/m),
  line(/^var _REQUIRED_BOARDS_FIELDS  = .*$/m),
  block(/^function _missingTalkFields\(/m),
  block(/^function _normalizeTalkInPlace\(/m),
  block(/^function parseTalkStrict\(/m),
  block(/^function _assertCompleteTalk\(/m),
].join("\n"), ctx);
const parseTalkStrict = vm.runInContext("parseTalkStrict", ctx);
const missingFields = vm.runInContext("_missingTalkFields", ctx);

// ── 1) the real captured failures must be REJECTED, not salvaged ────────────────
ok(F.cases.length >= 2, `fixtures present (${F.cases.length} real unparseable outputs captured)`);
for (const c of F.cases) {
  let threw = false;
  try { parseTalkStrict(c.raw, c.style); } catch { threw = true; }
  ok(threw, `${c.model} [${c.style}] "${c.topic.slice(0, 26)}" is REJECTED → generation fails, nothing rendered`);
}
// both fixtures are the same defect class — record it so a future reader doesn't treat them as unrelated
ok(/brace-drift/.test(F.note), "the fixture file records the SHARED defect (brace drift at the nested→top-level boundary)");
ok(/Do NOT fix by loosening fixJSON/.test(F.note), "the fixture file warns against loosening fixJSON as the fix");

// ── 2) a SALVAGEABLE-but-partial talk must also be rejected ─────────────────────
// This is the dangerous case: fixJSON's backward walk succeeds, yielding a prefix that parses but has
// lost the teaching payload. Observed for real earlier the same day (title..question kept, key_point /
// board_pearls / visual_memory_card silently dropped).
const partialBoards = JSON.stringify({ title: "T", subtitle: "s", references: [], question: { stem: "x", choices: [] } });
let e1 = null;
try { parseTalkStrict(partialBoards, "boards"); } catch (e) { e1 = e; }
ok(!!e1 && e1.code === "incomplete_talk", "a partial BOARDS talk throws incomplete_talk (not rendered)");
ok(e1 && /key_point/.test(String(e1.message)), "the error names WHICH fields were missing");

const partialLecture = JSON.stringify({ title: "T", sections: [{ heading: "h", points: ["p"] }] });
let e2 = null;
try { parseTalkStrict(partialLecture, "lecture"); } catch (e) { e2 = e; }
ok(!!e2 && e2.code === "incomplete_talk", "a partial LECTURE talk throws incomplete_talk (missing summary/VMC)");

// ── 3) complete talks must still pass (no false rejections) ─────────────────────
// These fixtures used to be {question:{stem:"x"}, board_pearls:["a"], visual_memory_card:{top_left:"a"}} —
// which the DEEP gate now rejects, correctly: that renders an unanswerable question and 3 blank quadrants.
// A "does not over-reject" test is only meaningful against a talk a reader would actually accept. (2026-07-26)
const VMC = { top_left: "Na <120", top_right: "Check urine osm", bottom_left: "SIADH", bottom_right: "Correct <8/24h" };
const goodBoards = { title: "T", key_point: "Symptomatic hyponatremia needs hypertonic saline",
  board_pearls: ["Correct <8 mEq/L/24h", "Check urine osmolality", "Treat symptoms, not the number"],
  visual_memory_card: VMC,
  question: { stem: "A 62-year-old with confusion and Na 112 mEq/L...", correct_letter: "C",
    explanation: "Hypertonic saline is indicated when seizure risk is present.",
    choices: [ { letter: "A", text: "Fluid restriction alone", correct: false }, { letter: "B", text: "Isotonic saline", correct: false },
               { letter: "C", text: "3% hypertonic saline", correct: true }, { letter: "D", text: "Tolvaptan", correct: false },
               { letter: "E", text: "Desmopressin", correct: false } ],
    wrong_explanations: [ { letter: "A", why: "Too slow when symptomatic" }, { letter: "B", why: "Can worsen Na in SIADH" },
                          { letter: "D", why: "Not first line acutely" }, { letter: "E", why: "Worsens water retention" } ],
    difficulty_level: 4, difficulty_label: "Board-level" } };
let okB = true; try { parseTalkStrict(JSON.stringify(goodBoards), "boards"); } catch { okB = false; }
ok(okB, "a COMPLETE boards talk parses (the gate does not over-reject)");

const goodLecture = { title: "T", sections: [{ heading: "Physiology", points: ["ADH drives free water retention"] }],
  summary_points: ["Correct slowly to avoid ODS"], visual_memory_card: VMC };
let okL = true; try { parseTalkStrict(JSON.stringify(goodLecture), "lecture"); } catch { okL = false; }
ok(okL, "a COMPLETE lecture talk parses");

// a talk whose fields exist but are EMPTY counts as missing — an empty array renders as nothing
ok(missingFields({ title: "T", question: {}, key_point: "", board_pearls: [], visual_memory_card: {} }, "boards").length >= 4,
   "empty-but-present fields count as MISSING (an empty array renders as nothing)");
ok(missingFields(null, "lecture").length === 1, "null talk is reported missing, not crashed on");

// ── 4) the brace-drift recovery still runs BEFORE the completeness judgement ────
// A boards talk whose top-level fields were nested inside `question` must be RECOVERED and accepted,
// not rejected — otherwise the strict gate would throw away a talk the app can legitimately repair.
const drifted = JSON.stringify({ title: "T", question: Object.assign({}, goodBoards.question,
  { key_point: goodBoards.key_point, board_pearls: goodBoards.board_pearls, visual_memory_card: VMC }) });
let recovered = null;
try { recovered = parseTalkStrict(drifted, "boards"); } catch { recovered = null; }
ok(!!recovered, "a brace-drifted boards talk is RECOVERED by the hoist and then accepted");
ok(recovered && /hypertonic saline/.test(recovered.key_point) && recovered.board_pearls.length === 3,
   "the hoisted fields are present at top level after recovery");

// ── 5) the draft path must actually use the strict parser ───────────────────────
// (the single bare call became a bounded retry loop — see section 9 for the bound itself)
ok(/draftTalk = parseTalkStrict\(txt, S\.style\)/.test(html), "generate() parses the draft with parseTalkStrict");
ok(!/var draftTalk = JSON\.parse\(fixJSON\(txt\)\);/.test(html), "the old unchecked JSON.parse(fixJSON(...)) draft path is gone");


// ── 6) EVERY path that can become S.talk must be gated (Codex 2026-07-26) ───────
// The first pass only covered the synchronous draft. These were the holes: the RESUMED async draft
// parsed raw, and the critic's replacement talk on all three review paths was accepted on nothing more
// than `parsed.title || parsed.question` — so a rewrite carrying only a title would have rendered.
ok(/function _assertCompleteTalk\(/.test(html), "_assertCompleteTalk() exists for non-draft candidates");

// (a) resumed async draft
const resumeSrc = fnBody("async function resumeAsyncJobIfAny");
ok(/parseTalkStrict\(txt, S\.style\)/.test(resumeSrc), "the RESUMED async draft goes through parseTalkStrict");
ok(!/var draftTalk = pruneFakeReferences\(deepCleanCitations\(JSON\.parse\(fixJSON\(txt\)\)\)\)/.test(html),
   "the resumed draft's raw JSON.parse path is gone");
ok(/_assertCompleteTalk\(parsed, S\.style, "resumed critic rewrite"\)/.test(resumeSrc),
   "the resumed CRITIC rewrite is asserted complete before it is accepted");

// (b) generate()'s critic
ok(/_assertCompleteTalk\(parsed, S\.style, "critic rewrite"\)/.test(html),
   "generate()'s critic rewrite is asserted complete (a partial rewrite fails the review → retry → withhold)");
// (c) retryReview()'s critic
ok(/_assertCompleteTalk\(parsed, rp\.style \|\| S\.style, "retried critic rewrite"\)/.test(html),
   "retryReview()'s critic rewrite is asserted complete (partial stays withheld)");
// the weak old acceptance test must no longer stand alone anywhere
const weakAccepts = (html.match(/else if \(?parsed\.title \|\| parsed\.question\)? \{ finalTalk = parsed/g) || []).length;
ok(weakAccepts === 0, "no critic path still accepts a rewrite on `title || question` alone");

// (d) full-talk refine replacements
for (const [needle, what] of [
  ['_assertCompleteTalk(JSON.parse(fixJSON(txt)), S.style, "restructured talk")', "restructureTalk"],
  ['_assertCompleteTalk(JSON.parse(fixJSON(txt)), S.style, "compressed talk")', "compressTalk"],
  ['_assertCompleteTalk(JSON.parse(fixJSON(txt)), S.style, "expanded talk")', "expandTalk"],
]) ok(html.includes(needle), `${what} validates its full-talk replacement before display`);

// (e) PATCH merges — the merged RESULT is what the reader sees
ok(/_assertCompleteTalk\(revised, S\.style, "proofread-merged talk"\)/.test(html),
   "the proofread-merged talk is validated before assignment");
ok(/_assertCompleteTalk\(merge\.talk, S\.style, "weave-merged talk"\)/.test(html),
   "the weave-merged talk is validated before assignment");
// and a rejected merge must keep the original rather than blanking the talk
const revIdx = html.indexOf('"proofread-merged talk"');
ok(/kept your original untouched/.test(html.slice(revIdx, revIdx + 700)),
   "a rejected proofread merge KEEPS the original talk (no blank screen)");

// (f) the assertion itself behaves
{
  // reuse the shared sandbox — a second minimal one silently missed the normalizer the gate now needs
  const assertComplete = vm.runInContext("_assertCompleteTalk", ctx);
  let thrown = null;
  try { assertComplete({ title: "only a title" }, "boards", "critic rewrite"); } catch (e) { thrown = e; }
  ok(!!thrown && thrown.code === "incomplete_talk", "a rewrite carrying ONLY a title is rejected (the old weak test passed it)");
  ok(thrown && /critic rewrite/.test(thrown.message), "the error names WHICH candidate was incomplete");
  const full = JSON.parse(JSON.stringify(goodBoards));   // a REAL complete talk, not a title + one pearl
  let okFull = true; try { assertComplete(full, "boards", "x"); } catch { okFull = false; }
  ok(okFull, "a complete rewrite passes (no over-rejection)");
}


// ── 7) THE ASYNC/RESUME PATH MUST WITHHOLD, NOT SHOW AN UNREVIEWED DRAFT ────────
// Codex 2026-07-26: the resume path previously fell back to displaying the draft whenever the Worker's
// server-side critique was missing/malformed/incomplete — silently weaker than the synchronous path,
// which retries once then WITHHOLDS. Most mobile generations complete via this path.
{
  const rs = fnBody("async function resumeAsyncJobIfAny");
  ok(/parseTalkStrict\(txt, S\.style\)/.test(rs), "resume: draft parsed with the strict gate");
  ok(/function _acceptCritique\(/.test(rs), "resume: a single acceptance helper decides clean-vs-rewrite");
  ok(/_assertCompleteTalk\(parsed, S\.style, "resumed critic rewrite"\)/.test(rs),
     "resume: a critic REWRITE must be schema-complete to be accepted");
  ok(/_acceptCritique\(critTxt\)/.test(rs), "resume: the Worker's existing critique is tried first (no wasted call)");
  ok(/callAPIWithFallback\(_spec\.sys, _critInput, _spec\.maxTok, _spec\.models\)/.test(rs),
     "resume: exactly ONE bounded client-side retry when the server critique is unusable");
  // the retry must be bounded — no loop
  ok((rs.match(/callAPIWithFallback\(_spec\.sys/g) || []).length === 1, "resume: the retry is bounded to a single attempt (no loop)");
  ok(/if\(!finalTalk\)\{/.test(rs), "resume: there is an explicit no-review branch");
  ok(/S\.reviewPending = \{ draft: draftTalk/.test(rs), "resume: an unreviewable draft is WITHHELD, not rendered");
  ok(/return;   \/\/ NO S\.talk/.test(rs), "resume: the withhold branch returns without assigning S.talk");
  ok(/charged: true/.test(rs), "resume: charged:true prevents a double charge (the async job billed server-side)");
  ok(/_saveReviewPending\(\)/.test(rs), "resume: the withheld draft is persisted so a reload keeps it");
  ok(/critiqueSystem: _spec\.sys/.test(rs) && /criticModels: _spec\.models/.test(rs),
     "resume: the withheld draft carries the critique spec, so the card's Retry button actually works");
  // and it must NOT silently keep the draft any more
  ok(!/keep the VALIDATED draft, never a partial rewrite/.test(html),
     "the old 'swallow the error and show the draft' fallback is gone");
}
// the spec builder must be shared, not duplicated — and must respect the writer gate
ok(/function buildCritiqueSpec\(/.test(html), "buildCritiqueSpec() exists at module scope");
ok(/models: writeAllowedModels\(/.test(html), "the critique spec only ever uses BENCHMARK-CLEARED models");
{
  const iSpec = html.indexOf("function buildCritiqueSpec("), iGen = html.indexOf("async function generate(){");
  ok(iSpec > 0 && iSpec < iGen, "the critique prompts/spec are hoisted ABOVE generate() so the resume path can use them");
}
ok((html.match(/var LECTURE_CRITIQUE_PROMPT = /g) || []).length === 1, "the lecture critique prompt is declared exactly once (no drifting copy)");

// ── 8) SCHEMA FIELD ORDER: THE BIG NESTED STRUCTURE MUST COME LAST ──────────────
// Both captured fixtures failed the same way: a brace slip deep inside sections[]/question{} orphaned
// every top-level field that came AFTER it, so the *teaching payload* was the part lost. Emitting the
// short top-level fields first means each is already written and closed before the long nesting starts,
// so the same slip can only orphan trailing nesting. NOT schema-constrained output — the Anthropic
// request supplies no schema and enforces nothing; this is a prompt-side mitigation only. It does not
// replace parseTalkStrict, it reduces how much a slip can cost.
{
  const schemaOf = (name) => {
    const i = html.indexOf("var " + name + " = ");
    const end = html.indexOf("\n", i);
    const src = html.slice(i, end === -1 ? undefined : end);
    const j = src.lastIndexOf("ONLY JSON:");
    ok(j > 0, `${name}: the schema is introduced by "ONLY JSON:"`);
    return src.slice(j);
  };
  const orderOk = (name, big, mustPrecede) => {
    const s = schemaOf(name);
    const iBig = s.indexOf('"' + big + '":');
    ok(iBig > 0, `${name}: schema still declares ${big}`);
    for (const f of mustPrecede) {
      const iF = s.indexOf('"' + f + '":');
      ok(iF > 0 && iF < iBig, `${name}: ${f} is emitted BEFORE ${big} (a slip inside ${big} cannot orphan it)`);
    }
    // nothing of substance may trail the big structure
    const after = s.slice(iBig).replace(/^"[a-z_]+":/, "");
    const trailingTop = [...after.matchAll(/,"([a-z_]+)":/g)].map((m) => m[1]);
    ok(trailingTop.length === 0 || !["summary_points", "visual_memory_card", "key_point", "board_pearls", "teaching_points"].some((f) => trailingTop.includes(f)),
       `${name}: no teaching field trails ${big}`);
  };
  orderOk("LECTURE_PROMPT", "sections", ["title", "summary_points", "visual_memory_card"]);
  orderOk("BOARDS_PROMPT", "question", ["title", "key_point", "board_pearls", "teaching_points", "summary_points", "visual_memory_card"]);
  // and the model must be told WHY, or a future prompt edit will "tidy" the order back
  ok((html.match(/FIELD ORDER \(matters for reliability\)/g) || []).length === 2,
     "both prompts explain WHY the order matters (so a future edit doesn't silently undo it)");
}

// ── 9) THE SYNCHRONOUS DRAFT GETS EXACTLY ONE BOUNDED REPAIR RETRY ──────────────
// Codex: "prefer structured-output enforcement and a bounded repair retry over increasingly permissive
// JSON repair." The bound is the safety property — an unbounded repair loop burns Opus tokens and can
// still end in a partial render.
{
  const g = html.slice(html.indexOf("async function generate(){"));
  const draftBlock = g.slice(g.indexOf("var draftTalk = null"), g.indexOf("var draftTalk = null") + 2200);
  ok(draftBlock.length > 100, "generate(): the bounded draft-repair loop exists");
  ok(/_dAtt < 2/.test(draftBlock), "generate(): the repair loop is bounded to 2 attempts = exactly ONE retry");
  ok(/S\.genCancelled \|\| _myGenId !== S\.genId/.test(draftBlock),
     "generate(): the retry re-checks cancel + generation identity before spending a second call");
  ok(/incomplete_talk/.test(draftBlock) && /missing required top-level fields/.test(draftBlock),
     "generate(): the corrective note tells the model WHICH failure occurred (missing fields vs bad JSON)");
  ok(/unbalanced brace or bracket/.test(draftBlock), "generate(): the invalid-JSON branch names the likely cause");
  ok(/if \(!draftTalk\) throw \(_draftParseErr/.test(draftBlock),
     "generate(): after the single retry it THROWS — it never renders an unparsed draft");
  ok(!/JSON\.parse\(fixJSON\(txt\)\)/.test(draftBlock), "generate(): the draft is never parsed with the loose path");
  // the whole point of the retry is to avoid loosening the parser
  ok(/parseTalkStrict\(txt, S\.style\)/.test(draftBlock), "generate(): each attempt is validated by the STRICT gate");
}

console.log("\n" + (failures === 0 ? "✔ STRICT PARSE TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
