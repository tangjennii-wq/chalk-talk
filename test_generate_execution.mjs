// EXECUTION test for generate()'s review → finalize path. Run: node test_generate_execution.mjs
//
// Why this file exists (Codex, 2026-07-26): 13 green suites missed a launch-blocking regression because
// they inspected SOURCE PATTERNS rather than running the code. The finalization block read
// `_critiqueRewroteTalk` and `_critiqueModel`, but a botched edit dropped their `var` declaration —
// `_critiqueRewroteTalk` survived as an implicit global only when the rewrite branch happened to run,
// and `_critiqueModel` was never assigned at all. Result: a ReferenceError at finalization on EVERY
// successful generation, including the common "verdict: clean" case. Every regex in the suite passed,
// because the identifiers were all present in the source — just never declared.
//
// So this suite EXECUTES the real extracted block against stubs and asserts the talk comes out the far
// side. Anything that throws at runtime fails here, whatever the source looks like.
import { readFileSync } from "fs";
import vm from "vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
function block(re) { const m = html.match(re); if (!m) throw new Error("not found: " + re); const i = m.index, e = /\n\};?/.exec(html.slice(i)); return html.slice(i, i + e.index + e[0].length); }
const line = (re) => { const m = html.match(re); if (!m) throw new Error("line not found: " + re); return m[0]; };
const objLit = (n) => { const i = html.indexOf("var " + n + " = {"); const e = /\n\};?/.exec(html.slice(i)); return html.slice(i, i + e.index + e[0].length); };

const VMC = { top_left: "Na <120", top_right: "Check urine osm", bottom_left: "SIADH", bottom_right: "Correct <8/24h" };
const goodLecture = () => ({
  title: "Hyponatremia", subtitle: "A practical approach",
  sections: [{ heading: "Physiology", points: ["ADH drives free water retention"] }],
  summary_points: ["Correct slowly to avoid osmotic demyelination"],
  visual_memory_card: JSON.parse(JSON.stringify(VMC)), references: [],
});

// Extract generate()'s review loop through the provenance stamp — the exact span that crashed.
const g = html.slice(html.indexOf("async function generate(){"));
const start = g.indexOf("var finalTalk = null;");
const end = g.indexOf("finalTalk._citationsVerified", start) >= 0
  ? g.indexOf("\n", g.indexOf("});", g.indexOf("_stampProvenance(finalTalk", start)))
  : g.indexOf("\n", g.indexOf("});", g.indexOf("_stampProvenance(finalTalk", start)));
const REGION = g.slice(start, end);
ok(REGION.length > 500, "located generate()'s review → finalize region");
ok(/_stampProvenance\(finalTalk/.test(REGION), "the region includes the provenance stamp (where it threw)");

function runRegion({ verdict, useAsync, asyncCritModel, syncCritModel }) {
  const rendered = [];
  const ctx = {
    console: { warn() {}, info() {} },
    S: { style: "lecture", depth: "detailed", genCancelled: false, genId: 5, genProvider: "claude", ragChunks: [{ pmid: "1" }, { pmid: "2" }], reviewPending: null, loading: true, loadMsg: "", citationAuditPending: false, topic: "Hyponatremia" },
    render: () => rendered.push(1),
    JSON, Error, String, Array, Object, Boolean, parseInt, setTimeout, Promise, Date,
    // draft already produced upstream
    draftTalk: goodLecture(),
    _myGenId: 5, _useAsync: useAsync, _asyncCritTxt: useAsync ? JSON.stringify(critiquePayload(verdict)) : "",
    _asyncCritModel: asyncCritModel || "", _draftModel: "claude-opus-5", _draftWebSearched: true,
    critiqueSystem: "SYS", critiquePrefix: "PFX", critiqueInput: "IN", critMaxTok: 4096, criticModels: ["claude-opus-5"],
    glRef: { context: "KDIGO" }, loadTimer: null, clearInterval: () => {},
    _saveReviewPending: () => {},
    async callAPIWithFallback() { return { txt: JSON.stringify(critiquePayload(verdict)), modelUsed: syncCritModel || "claude-opus-5" }; },
    deepCleanCitations: (t) => t, pruneFakeReferences: (t) => t, _normalizeInlinePmids: (t) => t, _finalizeBoardQuestion: (t) => t,
  };
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
    line(/^var PATCH_MAX_COUNT = .*$/m), line(/^var PATCH_MAX_TOTAL_CHARS = .*$/m), line(/^var _PATCH_PATH_RE = .*$/m),
    block(/^function _resolvePatchPath\(/m), block(/^function applyTalkPatches\(/m),
    block(/^function acceptCritique\(/m),
    objLit("WRITER_BENCHMARK_CLEARED"),   // multi-line object: take it whole, never by line()
    line(/^function writerIsBenchmarked\(.*$/m), line(/^function writerModelKnown\(.*$/m),
    block(/^function talkWriterModels\(/m), block(/^function talkHasUnverifiedWriter\(/m),
    block(/^function _stampProvenance\(/m),
    "globalThis.__run = async function(){ " + REGION + " ; return finalTalk; };",
  ].join("\n"), ctx);
  return vm.runInContext("__run()", ctx).then((t) => ({ talk: t, S: ctx.S }));
}
function critiquePayload(verdict) {
  if (verdict === "clean") return { verdict: "clean" };
  const t = goodLecture(); t.title = "Hyponatremia (corrected)"; return t;   // a REWRITE
}

// ── 1) THE REGRESSION: a clean verdict must finalize without throwing ───────────
{
  let err = null, out = null;
  try { out = await runRegion({ verdict: "clean", useAsync: false, syncCritModel: "claude-opus-5" }); } catch (e) { err = e; }
  ok(!err, `a CLEAN review finalizes without throwing${err ? " — " + err.message : ""}`);
  ok(out && out.talk && out.talk.title === "Hyponatremia", "the DRAFT is what gets shown on a clean verdict");
  ok(out && out.talk._reviewStatus === "reviewed", "provenance is stamped");
  ok(out && out.talk._writerModel === "claude-opus-5", "the drafting model is recorded");
  ok(out && out.talk._ragCount === 2 && out.talk._guidelinesLoaded === true, "grounding provenance is carried through");
}

// ── 2) a REWRITE must finalize AND record the critic as a writer ────────────────
{
  let err = null, out = null;
  try { out = await runRegion({ verdict: "rewrite", useAsync: false, syncCritModel: "claude-opus-5" }); } catch (e) { err = e; }
  ok(!err, `a REWRITTEN review finalizes without throwing${err ? " — " + err.message : ""}`);
  ok(out && out.talk && /corrected/.test(out.talk.title), "the CRITIC's corrected talk is what gets shown");
  const models = (out && out.talk._writerModels) || [];
  ok(models.indexOf("claude-opus-5") >= 0, "the critic's model is recorded among the writers");
}

// ── 3) the async path reuses the Worker's critique AND its model id ─────────────
{
  let err = null, out = null;
  try { out = await runRegion({ verdict: "rewrite", useAsync: true, asyncCritModel: "claude-opus-5" }); } catch (e) { err = e; }
  ok(!err, `the ASYNC path finalizes without throwing${err ? " — " + err.message : ""}`);
  ok(out && (out.talk._writerModels || []).length >= 1, "the async rewrite records a writer model");
}

// ── 4) an INCOMPLETE critic rewrite must withhold, not crash and not render ─────
{
  const ctxErr = [];
  let out = null, err = null;
  try {
    out = await (async () => {
      const r = await runRegionWithPayload({ title: "only a title" });
      return r;
    })();
  } catch (e) { err = e; ctxErr.push(e); }
  ok(!err, `a partial critic rewrite does not CRASH the generation${err ? " — " + err.message : ""}`);
  ok(out && out.talk == null, "…and nothing is returned to render");
  ok(out && out.S.reviewPending && out.S.reviewPending.draft, "…the draft is WITHHELD for retry instead");
}
async function runRegionWithPayload(payload) {
  const rendered = [];
  const ctx = {
    console: { warn() {}, info() {} },
    S: { style: "lecture", depth: "detailed", genCancelled: false, genId: 5, genProvider: "claude", ragChunks: [], reviewPending: null, loading: true, loadMsg: "", citationAuditPending: false, topic: "Hyponatremia" },
    render: () => rendered.push(1), JSON, Error, String, Array, Object, Boolean, parseInt, setTimeout, Promise, Date,
    draftTalk: goodLecture(), _myGenId: 5, _useAsync: false, _asyncCritTxt: "", _asyncCritModel: "",
    _draftModel: "claude-opus-5", _draftWebSearched: false,
    critiqueSystem: "SYS", critiquePrefix: "PFX", critiqueInput: "IN", critMaxTok: 4096, criticModels: ["claude-opus-5"],
    glRef: null, loadTimer: null, clearInterval: () => {}, _saveReviewPending: () => {},
    async callAPIWithFallback() { return { txt: JSON.stringify(payload), modelUsed: "claude-opus-5" }; },
    deepCleanCitations: (t) => t, pruneFakeReferences: (t) => t, _normalizeInlinePmids: (t) => t, _finalizeBoardQuestion: (t) => t,
  };
  vm.createContext(ctx);
  vm.runInContext([
    block(/^function fixJSON\(/m), objLit("BOARDS_DIFFICULTY"), line(/^function boardsDifficulty\(.*$/m),
    block(/^function _repairBoardQuestionInPlace\(/m), line(/^var _BOARD_TOPLEVEL_FIELDS = .*$/m),
    block(/^function _hoistMisplacedBoardFields\(/m), line(/^var _MIN_MEANINGFUL = .*$/m), line(/^var _MIN_BOARD_PEARLS = .*$/m),
    line(/^function _meaningful\(.*$/m), block(/^function _meaningfulList\(/m),
    line(/^var _VMC_QUADRANTS = .*$/m), block(/^function _vmcIncomplete\(/m),
    line(/^var _REQUIRED_LECTURE_FIELDS = .*$/m), line(/^var _REQUIRED_BOARDS_FIELDS  = .*$/m),
    block(/^function _missingTalkFields\(/m), block(/^function _normalizeTalkInPlace\(/m),
    block(/^function _assertCompleteTalk\(/m),
    line(/^var PATCH_MAX_COUNT = .*$/m), line(/^var PATCH_MAX_TOTAL_CHARS = .*$/m), line(/^var _PATCH_PATH_RE = .*$/m),
    block(/^function _resolvePatchPath\(/m), block(/^function applyTalkPatches\(/m),
    block(/^function acceptCritique\(/m), objLit("WRITER_BENCHMARK_CLEARED"),
    line(/^function writerIsBenchmarked\(.*$/m), line(/^function writerModelKnown\(.*$/m),
    block(/^function talkWriterModels\(/m), block(/^function talkHasUnverifiedWriter\(/m), block(/^function _stampProvenance\(/m),
    "globalThis.__run2 = async function(){ " + REGION + " ; return finalTalk; };",
  ].join("\n"), ctx);
  const talk = await vm.runInContext("__run2()", ctx);
  return { talk, S: ctx.S };
}

// ── 5) no identifier in this region may be read without being declared ──────────
// The specific failure was an undeclared local. Strict mode turns that class into a load-time error.
{
  let strictErr = null;
  try { new Function('"use strict";' + REGION.replace(/await /g, "")); } catch (e) { strictErr = e; }
  ok(!strictErr || !/is not defined/.test(String(strictErr)), "the region has no obviously undeclared identifiers");
  const assigned = [...REGION.matchAll(/^\s*_([a-zA-Z]\w*)\s*=/gm)].map((m) => "_" + m[1]);
  const undeclared = [...new Set(assigned)].filter((v) => !new RegExp("var\\s[^;]*\\b" + v + "\\b").test(REGION) && !new RegExp("\\b" + v + "\\b").test(html.slice(0, html.indexOf("async function generate(){"))));
  ok(undeclared.length === 0, `no implicit globals created in the review path${undeclared.length ? " — found " + undeclared.join(", ") : ""}`);
}

console.log("\n" + (failures === 0 ? "✔ GENERATE EXECUTION TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
