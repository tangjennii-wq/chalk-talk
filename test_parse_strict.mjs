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

console.log("\n" + (failures === 0 ? "✔ STRICT PARSE TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
