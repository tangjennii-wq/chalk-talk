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

function block(re) {
  const m = html.match(re); if (!m) throw new Error("not found: " + re);
  const i = m.index, e = /\n\};?/.exec(html.slice(i));
  return html.slice(i, i + e.index + e[0].length);
}
const line = (re) => (html.match(re) || [""])[0];

const ctx = { console: { warn() {} } };
vm.createContext(ctx);
vm.runInContext([
  block(/^function fixJSON\(/m),
  line(/^var _BOARD_TOPLEVEL_FIELDS = .*$/m),
  block(/^function _hoistMisplacedBoardFields\(/m),
  line(/^var _REQUIRED_LECTURE_FIELDS = .*$/m),
  line(/^var _REQUIRED_BOARDS_FIELDS  = .*$/m),
  block(/^function _missingTalkFields\(/m),
  block(/^function parseTalkStrict\(/m),
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
const goodBoards = { title: "T", question: { stem: "x" }, key_point: "kp", board_pearls: ["a"], visual_memory_card: { top_left: "a" } };
let okB = true; try { parseTalkStrict(JSON.stringify(goodBoards), "boards"); } catch { okB = false; }
ok(okB, "a COMPLETE boards talk parses (the gate does not over-reject)");

const goodLecture = { title: "T", sections: [{ heading: "h", points: ["p"] }], summary_points: ["a"], visual_memory_card: { top_left: "a" } };
let okL = true; try { parseTalkStrict(JSON.stringify(goodLecture), "lecture"); } catch { okL = false; }
ok(okL, "a COMPLETE lecture talk parses");

// a talk whose fields exist but are EMPTY counts as missing — an empty array renders as nothing
ok(missingFields({ title: "T", question: {}, key_point: "", board_pearls: [], visual_memory_card: {} }, "boards").length >= 4,
   "empty-but-present fields count as MISSING (an empty array renders as nothing)");
ok(missingFields(null, "lecture").length === 1, "null talk is reported missing, not crashed on");

// ── 4) the brace-drift recovery still runs BEFORE the completeness judgement ────
// A boards talk whose top-level fields were nested inside `question` must be RECOVERED and accepted,
// not rejected — otherwise the strict gate would throw away a talk the app can legitimately repair.
const drifted = JSON.stringify({ title: "T", question: { stem: "x", key_point: "kp", board_pearls: ["a", "b"], visual_memory_card: { top_left: "a" } } });
let recovered = null;
try { recovered = parseTalkStrict(drifted, "boards"); } catch { recovered = null; }
ok(!!recovered, "a brace-drifted boards talk is RECOVERED by the hoist and then accepted");
ok(recovered && recovered.key_point === "kp" && recovered.board_pearls.length === 2,
   "the hoisted fields are present at top level after recovery");

// ── 5) the draft path must actually use the strict parser ───────────────────────
ok(/var draftTalk = parseTalkStrict\(txt, S\.style\);/.test(html), "generate() parses the draft with parseTalkStrict");
ok(!/var draftTalk = JSON\.parse\(fixJSON\(txt\)\);/.test(html), "the old unchecked JSON.parse(fixJSON(...)) draft path is gone");


// ── 6) EVERY path that can become S.talk must be gated (Codex 2026-07-26) ───────
// The first pass only covered the synchronous draft. These were the holes: the RESUMED async draft
// parsed raw, and the critic's replacement talk on all three review paths was accepted on nothing more
// than `parsed.title || parsed.question` — so a rewrite carrying only a title would have rendered.
ok(/function _assertCompleteTalk\(/.test(html), "_assertCompleteTalk() exists for non-draft candidates");

// (a) resumed async draft
const resumeSrc = html.slice(html.indexOf("async function resumeAsyncJobIfAny"), html.indexOf("async function resumeAsyncJobIfAny") + 4000);
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
  const actx = { console: { warn() {} } };
  vm.createContext(actx);
  vm.runInContext([
    line(/^var _REQUIRED_LECTURE_FIELDS = .*$/m),
    line(/^var _REQUIRED_BOARDS_FIELDS  = .*$/m),
    block(/^function _missingTalkFields\(/m),
    block(/^function _assertCompleteTalk\(/m),
  ].join("\n"), actx);
  const assertComplete = vm.runInContext("_assertCompleteTalk", actx);
  let thrown = null;
  try { assertComplete({ title: "only a title" }, "boards", "critic rewrite"); } catch (e) { thrown = e; }
  ok(!!thrown && thrown.code === "incomplete_talk", "a rewrite carrying ONLY a title is rejected (the old weak test passed it)");
  ok(thrown && /critic rewrite/.test(thrown.message), "the error names WHICH candidate was incomplete");
  const full = { title: "T", question: { stem: "x" }, key_point: "k", board_pearls: ["a"], visual_memory_card: { top_left: "a" } };
  let okFull = true; try { assertComplete(full, "boards", "x"); } catch { okFull = false; }
  ok(okFull, "a complete rewrite passes (no over-rejection)");
}

console.log("\n" + (failures === 0 ? "✔ STRICT PARSE TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
