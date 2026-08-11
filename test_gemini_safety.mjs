// Focused safety/provenance tests for the free-Gemini tier + withheld-review system.
// Exercises the LIVE functions from index.html so they can't drift. Run: node test_gemini_safety.mjs
import { readFileSync } from "fs";
import vm from "vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
let failures = 0;
function ok(cond, msg){ console.log((cond ? "✓" : "✗ FAIL") + " — " + msg); if(!cond) failures++; }

function fnSrc(name){
  const i = html.indexOf("function " + name + "(");
  if(i < 0) throw new Error("fn not found: " + name);
  let s = html.indexOf("{", i), d = 0;
  for(let j = s; j < html.length; j++){ if(html[j] === "{") d++; else if(html[j] === "}"){ d--; if(d === 0) return html.slice(i, j + 1); } }
  throw new Error("unbalanced: " + name);
}
function constLine(name){ const m = html.match(new RegExp("var\\s+" + name + '\\s*=\\s*"([^"]*)"')); if(!m) throw new Error("const not found: " + name); return m[1]; }

// ---- live values into a vm ---------------------------------------------------
const FREE = constLine("GEN_GEMINI_FREE_MODEL");
const BYOK = constLine("GEN_GEMINI_BYOK_MODEL");
const ctx = { S: { geminiFreeFlow: false }, GEN_GEMINI_FREE_MODEL: FREE, GEN_GEMINI_BYOK_MODEL: BYOK, console, esc: (x) => String(x) };
vm.createContext(ctx);
// _provenanceChips now calls writerLabel/writerIsBenchmarked (unverified-writer warning, 2026-07-26),
// so the writer-benchmark table and those helpers must be in the sandbox too.
const _writerBlock = html.slice(html.indexOf("var WRITER_BENCHMARK_CLEARED"), html.indexOf("function _provenanceChips"));
vm.runInContext(_writerBlock + "\n" + fnSrc("activeGeminiModel") + "\n" + fnSrc("_provenanceChips"), ctx);
const activeGeminiModel = vm.runInContext("activeGeminiModel", ctx);
const chips = vm.runInContext("_provenanceChips", ctx);

// ---- 1) Gemini model constants + free/BYOK switch ---------------------------
ok(FREE === "gemini-3.6-flash", "free Gemini model is gemini-3.6-flash (stable)");
ok(BYOK === "gemini-3.6-flash", "BYOK Gemini model is gemini-3.6-flash");
ok(!/preview/i.test(FREE) && !/preview/i.test(BYOK), "neither Gemini model is a preview (retirement-prone)");
ctx.S.geminiFreeFlow = false; ok(activeGeminiModel() === BYOK, "activeGeminiModel → BYOK model when not in free flow");
ctx.S.geminiFreeFlow = true;  ok(activeGeminiModel() === FREE, "activeGeminiModel → FREE model in the free-continue flow");
ctx.S.geminiFreeFlow = false;

// ---- 2) web-search label reflects an ACTUAL search, not the toggle ----------
const claudeSearched = { _reviewStatus:"reviewed", _writtenBy:"claude", _webSearched:true, _guidelinesLoaded:true, _ragCount:2, _citationsVerified:true };
const claudeNoSearch = { ...claudeSearched, _webSearched:false };
ok(chips(claudeSearched, false).some(c => /Also searched the web/.test(c)), "web-search chip shown when a search actually ran");
ok(!chips(claudeNoSearch, false).some(c => /Also searched the web/.test(c)), "NO web-search chip when no search ran (toggle-on but _webSearched false)");
const gemini = { _reviewStatus:"reviewed", _writtenBy:"gemini", _webSearched:false, _guidelinesLoaded:true, _ragCount:0 };
ok(!chips(gemini, false).some(c => /Also searched the web/.test(c)), "Gemini never claims a web search");
ok(chips(gemini, false).some(c => /Gemini/.test(c)), "the writer label still names Gemini (chip text shortened 2026-07-26)");

// ---- 3) grounding claimed ONLY when a guideline matched and/or RAG hit -------
const noGrounding = { _reviewStatus:"reviewed", _writtenBy:"claude", _guidelinesLoaded:false, _ragCount:0 };
ok(!chips(noGrounding, false).some(c => /\bpaper|guideline/i.test(c)), "NO grounding claim when no guideline matched and RAG returned nothing");
ok(chips({ _reviewStatus:"reviewed", _guidelinesLoaded:true, _ragCount:0 }, false).some(c => /Society guidelines on hand/.test(c)), "guideline-only grounding label");
ok(chips({ _reviewStatus:"reviewed", _guidelinesLoaded:false, _ragCount:3 }, false).some(c => /3 papers found to cite from/.test(c)), "RAG-only grounding label");
ok(chips({ _reviewStatus:"reviewed", _guidelinesLoaded:true, _ragCount:2 }, false).some(c => /2 papers found to cite from/.test(c)), "guideline + RAG grounding label");

// ---- citations distinct from review; legacy talks get no chips --------------
ok(chips({ _reviewStatus:"reviewed", _citationsVerified:false }, true).some(c => /Checking the references/.test(c)), "citations 'checking the references' while audit pending");
ok(!chips({ _reviewStatus:"reviewed", _citationsVerified:false }, false).some(c => /Citations checked/.test(c)), "review-complete does NOT imply citations checked");
ok(chips({}, false).length === 0, "legacy talk (no _reviewStatus) shows no provenance chips");
// "AI-reviewed" chip REMOVED 2026-07-26 (Jenni). An unreviewed draft is WITHHELD and never reaches the
// talk view, so the chip had exactly one possible value and carried no information. The invariant it was
// standing in for is enforced elsewhere and asserted properly: a talk without a completed review does not
// render at all (test_parse_strict §7, test_generate_execution §4).
ok(!chips(claudeSearched, false).some(c => /AI-reviewed/.test(c)), "the redundant AI-reviewed chip is gone");
ok(chips({}, false).length === 0, "…and a talk with no review status still shows NO provenance at all");

// ---- source-guards: behaviors that live in the generate/render flow ---------
ok(/web_search_tool_result/.test(html) && /opts\.__webSearched\s*=\s*true/.test(html), "callAPI detects an actual web_search event (not the toggle)");
ok(/webSearched:\s*!!modelOpts\.__webSearched/.test(html), "callAPIWithFallback returns the real webSearched signal");
ok(/S\.reviewPending\.charged/.test(html) && /retrying the review won/.test(html), "withheld-draft copy is conditional on whether a credit was already charged");
ok(/charged:\s*!!_useAsync/.test(html), "async (Worker-reserved credit) is tracked as charged on the withheld draft");
// SUPERSEDED: this asserted the guard `genUsesFreeTier() && !rp.charged`, which stopped a review retry
// from charging a SECOND credit. Retrying a review now charges nothing at all — it re-reviews a draft the
// user already paid for — so the guard it was checking is gone along with the charge. The stronger property
// (no refinement path consumes a credit anywhere) is asserted in test_refine_is_free.mjs.
ok(!/consumeFreeTier\("talk"\)/.test(html.slice(html.indexOf("async function retryReview()"),
                                                html.indexOf("async function retryReview()") + 3000)),
   "retry does not charge a credit at all, let alone re-charge one");
ok(/guidelinesLoaded: !!glRef/.test(html), "_guidelinesLoaded is derived from an actual guideline match (passed to the provenance stamp)");

// ---- Worker → browser web-search propagation (Codex 2026-07) ----------------
const worker = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
ok(/web_search_tool_result/.test(worker) && /webSearched\s*=\s*true/.test(worker), "worker.js detects an ACTUAL web_search event (stream + non-stream)");
ok(/return \{ text, modelUsed: models\[i\], usage, webSearched \}/.test(worker), "worker streaming path returns webSearched");
ok(/usage: d\.usage \|\| \{\}, webSearched \}/.test(worker), "worker non-streaming path returns webSearched");
// THIS ASSERTION USED TO PIN THE BUG. It required exactly `webSearched: !!draft.webSearched`, which is
// structurally false forever — callDraft passes tools:null by design (920773e), so only the CRITIQUE can
// search. The suite was green the whole time the free tier could not report a live check, because the
// pattern it demanded WAS the defect. It now asserts the contract instead of the current text.
// (Behaviour is executed in test_live_check_propagation.mjs; this is the worker-side shape.)
ok(/webSearched:\s*!!\(draft\.webSearched \|\| critSearched\)/.test(worker),
   "worker runGeneration reports webSearched from EITHER call — the critique is the one that searches");
ok(/_draftWebSearched\s*=\s*!!\(_res\s*&&\s*_res\.webSearched\)/.test(html), "client sets _draftWebSearched from the async Worker result");
// _draftWebSearched must be DECLARED before the async read, or a later `var` would reset it to false.
const _declIdx = html.indexOf("_useAsync = false, _draftWebSearched = false");
const _asyncReadIdx = html.indexOf("_draftWebSearched = !!(_res");
ok(_declIdx > 0 && _asyncReadIdx > _declIdx, "_draftWebSearched declared before the async read (not reset by a later var)");
ok(!/var _draftWebSearched = false;\s*\n\s*if \(!_useAsync\)/.test(html), "no stray `var _draftWebSearched=false` reset before the sync branch");
// end-to-end propagation logic: Worker result → client flag → provenance chip
function clientWebSearchedFromResult(res, provider){ return (provider === "claude") && !!(res && res.webSearched); }
ok(clientWebSearchedFromResult({ draftText:"x", webSearched:true }, "claude") === true, "propagation: Worker webSearched:true → client flag true (Claude)");
ok(clientWebSearchedFromResult({ draftText:"x", webSearched:false }, "claude") === false, "propagation: Worker webSearched:false → client flag false");
const asyncChip = { _reviewStatus:"reviewed", _writtenBy:"claude", _webSearched: clientWebSearchedFromResult({ webSearched:true }, "claude"), _guidelinesLoaded:true, _ragCount:1 };
ok(chips(asyncChip, false).some(c => /Also searched the web/.test(c)), "propagation: async web search surfaces the 'Also searched the web' chip");

console.log("\n" + (failures === 0 ? "✔ GEMINI/SAFETY TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
