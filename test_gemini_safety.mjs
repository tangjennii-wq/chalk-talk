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
const ctx = { S: { geminiFreeFlow: false }, GEN_GEMINI_FREE_MODEL: FREE, GEN_GEMINI_BYOK_MODEL: BYOK, console };
vm.createContext(ctx);
vm.runInContext(fnSrc("activeGeminiModel") + "\n" + fnSrc("_provenanceChips"), ctx);
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
ok(chips(claudeSearched, false).some(c => /Searched current sources/.test(c)), "web-search chip shown when a search actually ran");
ok(!chips(claudeNoSearch, false).some(c => /Searched current sources/.test(c)), "NO web-search chip when no search ran (toggle-on but _webSearched false)");
const gemini = { _reviewStatus:"reviewed", _writtenBy:"gemini", _webSearched:false, _guidelinesLoaded:true, _ragCount:0 };
ok(!chips(gemini, false).some(c => /Searched current sources/.test(c)), "Gemini never claims a web search");
ok(chips(gemini, false).some(c => /Written by Gemini/.test(c)), "writer chip reflects Gemini");

// ---- 3) grounding claimed ONLY when a guideline matched and/or RAG hit -------
const noGrounding = { _reviewStatus:"reviewed", _writtenBy:"claude", _guidelinesLoaded:false, _ragCount:0 };
ok(!chips(noGrounding, false).some(c => /Grounded/.test(c)), "NO grounding claim when no guideline matched and RAG returned nothing");
ok(chips({ _reviewStatus:"reviewed", _guidelinesLoaded:true, _ragCount:0 }, false).some(c => /Grounded in society guidelines/.test(c)), "guideline-only grounding label");
ok(chips({ _reviewStatus:"reviewed", _guidelinesLoaded:false, _ragCount:3 }, false).some(c => /Grounded in 3 retrieved sources/.test(c)), "RAG-only grounding label");
ok(chips({ _reviewStatus:"reviewed", _guidelinesLoaded:true, _ragCount:2 }, false).some(c => /Grounded in guidelines \+ 2 retrieved sources/.test(c)), "guideline + RAG grounding label");

// ---- citations distinct from review; legacy talks get no chips --------------
ok(chips({ _reviewStatus:"reviewed", _citationsVerified:false }, true).some(c => /Checking citations/.test(c)), "citations 'checking' while audit pending");
ok(!chips({ _reviewStatus:"reviewed", _citationsVerified:false }, false).some(c => /Citations checked/.test(c)), "review-complete does NOT imply citations checked");
ok(chips({}, false).length === 0, "legacy talk (no _reviewStatus) shows no provenance chips");
ok(chips(claudeSearched, false).some(c => /AI-reviewed/.test(c)), "a shown talk is labeled AI-reviewed");

// ---- source-guards: behaviors that live in the generate/render flow ---------
ok(/web_search_tool_result/.test(html) && /opts\.__webSearched\s*=\s*true/.test(html), "callAPI detects an actual web_search event (not the toggle)");
ok(/webSearched:\s*!!modelOpts\.__webSearched/.test(html), "callAPIWithFallback returns the real webSearched signal");
ok(/S\.reviewPending\.charged/.test(html) && /retrying the review won/.test(html), "withheld-draft copy is conditional on whether a credit was already charged");
ok(/charged:\s*!!_useAsync/.test(html), "async (Worker-reserved credit) is tracked as charged on the withheld draft");
ok(/if\s*\(\s*genUsesFreeTier\(\)\s*&&\s*!rp\.charged\s*\)/.test(html), "retry does NOT re-charge a credit");
ok(/_guidelinesLoaded\s*=\s*!!glRef/.test(html), "_guidelinesLoaded is derived from an actual guideline match");

console.log("\n" + (failures === 0 ? "✔ GEMINI/SAFETY TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
