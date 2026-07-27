// Launch-decision tests (2026-07-26):
//   A. Gemini is DEVELOPER-ONLY — no user-facing entry point may be reachable without the dev flag.
//   B. DOIs are trust-but-verified like PMIDs — a fabricated DOI must be dropped, not rendered.
// Run: node test_gemini_gate_and_doi.mjs
import { readFileSync } from "fs";
import vm from "vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
let failures = 0;
const ok = (c, m) => { console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

// ── A. Gemini dev gate ─────────────────────────────────────────────────────────
ok(/function geminiEnabled\(\)/.test(html), "geminiEnabled() gate exists");
ok(/ct_dev_gemini/.test(html), "gate keys off the ct_dev_gemini dev flag");
const gates = (html.match(/geminiEnabled\(\)/g) || []).length;
ok(gates >= 8, `every Gemini entry point is gated (${gates} references)`);

// the free CTA must be inside the gate
const ctaIdx = html.indexOf('id="freeGeminiBtn"');
ok(ctaIdx > 0, "found the free-Gemini CTA");
const beforeCta = html.slice(Math.max(0, ctaIdx - 700), ctaIdx);
ok(/if \(geminiEnabled\(\)\) \{/.test(beforeCta), "the 'Continue free with Gemini' CTA is behind the dev gate");

// provider picker must refuse gemini
ok(/if\(p==="gemini" && !geminiEnabled\(\)\) return;/.test(html), "the provider picker refuses to switch to Gemini when disabled");
// a previously-saved gemini preference must not silently persist
ok(/if\(_gp==="gemini" && !geminiEnabled\(\)\) _gp = "claude";/.test(html), "a stored gemini provider preference falls back to Claude at boot");
// review-switch button: both render and handler gated
ok(/if\(_rpProv!=="gemini" && geminiEnabled\(\)\)/.test(html), "the 'Review with Gemini' button is not rendered when disabled");
ok(/rvGemini\.onclick=function\(\)\{ if\(!geminiEnabled\(\)\) return;/.test(html), "the 'Review with Gemini' handler is gated too (defence in depth)");
// the out-of-credits copy must not promise Gemini when it is hidden
const copyOk = /geminiEnabled\(\)[\s\S]{0,400}?free with Gemini[\s\S]{0,400}?:\s*'/.test(html);
ok(copyOk, "the out-of-credits copy only promises 'free with Gemini' when the CTA is actually shown");
// the decision + evidence must be recorded in-code for the next reader
ok(/EMPA-SIADH/.test(html) && /sPESI/.test(html), "the rationale records the specific evidence (fabricated trial, sPESI scoring error)");
ok(/Gemini drafts, Claude reviews" was considered and rejected/.test(html), "records WHY the draft-with-Gemini/review-with-Claude option was rejected");

// ── B. DOI verification ────────────────────────────────────────────────────────
ok(/async function verifyModelDois\(/.test(html), "verifyModelDois() exists");
ok((html.match(/verifyCitations\(await verifyModelDois\(await verifyModelPmids\(/g) || []).length === 3,
   "DOI verification runs in ALL THREE audit paths, before verifyCitations");
ok(/return any \? out : null;/.test(html), "a total network failure returns null → FAIL OPEN (drops nothing)");
const vmdSrc = html.slice(html.indexOf("async function verifyModelDois("), html.indexOf("async function verifyModelDois(") + 4000);
ok(/if\(!map\) return talk;/.test(vmdSrc), "network failure leaves the talk untouched");
ok(/_stripChipIds\(talk, dropIds\)/.test(vmdSrc), "a fabricated DOI's inline [n] chips are stripped from the body");
ok(/if\(r\.pmid && \/\^\\d\{6,9\}\$\/\.test\(String\(r\.pmid\)\)\) return;/.test(vmdSrc),
   "refs already handled by the PMID path are skipped (no double work)");
ok(/if\(!r \|\| r\.src_verified\) return;/.test(vmdSrc), "already-verified refs (retrieved/paste/pubmed) are left alone");

// ── B2. _extractDoi behaviour (pure) ───────────────────────────────────────────
const ctx = {}; vm.createContext(ctx);
vm.runInContext(html.slice(html.indexOf("function _extractDoi("), html.indexOf("async function _crossrefBatch(")), ctx);
const extractDoi = vm.runInContext("_extractDoi", ctx);
ok(extractDoi({ doi: "10.1056/NEJMoa2205982" }) === "10.1056/NEJMoa2205982", "reads a bare doi field");
ok(extractDoi({ url: "https://doi.org/10.1056/NEJMoa2205982" }) === "10.1056/NEJMoa2205982", "extracts a DOI from a doi.org URL");
ok(extractDoi({ url: "https://dx.doi.org/10.1016/S0140-6736(19)31881-1" }) === "10.1016/S0140-6736(19)31881-1", "handles dx.doi.org and parenthesised DOIs");
ok(extractDoi({ doi: "doi: 10.1001/jama.2016.5148" }) === "10.1001/jama.2016.5148", "strips a 'doi:' prefix");
ok(extractDoi({ url: "https://doi.org/10.1056/NEJMoa2205982." }) === "10.1056/NEJMoa2205982", "trims trailing punctuation");
// REGRESSION: Lancet-style DOIs contain parentheses. Truncating one makes Crossref 404, which would
// have made verifyModelDois delete a REAL reference as fabricated.
ok(extractDoi({ doi: "10.1016/S0140-6736(22)00581-5" }) === "10.1016/S0140-6736(22)00581-5",
   "keeps parentheses inside a Lancet DOI (truncation would drop a real citation)");
ok(extractDoi({ url: "see https://doi.org/10.1016/S2213-2600(21)00097-7)" }) === "10.1016/S2213-2600(21)00097-7",
   "drops only an UNBALANCED trailing paren, keeping the DOI's own parens");
ok(extractDoi({ url: "https://www.kidney.org/guidelines" }) === "", "a society landing page yields no DOI (nothing to verify)");
ok(extractDoi({}) === "" && extractDoi(null) === "", "missing/!null input is safe");


// ── B3. DOI IDENTITY: a real DOI for the WRONG paper must be dropped, not relabelled ──
// Crossref confirming "this DOI exists" is not "this DOI is the paper the model cited". Overwriting our
// metadata with Crossref's would silently relabel an unrelated article and award it a trusted chip.
ok(/IDENTITY CHECK \(Codex 2026-07-26\)/.test(html), "the identity check is present and documented");
ok(/_titleSimilar\(claimedTitle, v\.title\) < 0\.5/.test(vmdSrc), "compares the model's claimed TITLE against Crossref's");
ok(/Math\.abs\(claimedYear - v\.year\) > 1/.test(vmdSrc), "compares the claimed YEAR against Crossref's");
ok(/!_journalAgree\(claimedJournal, v\.journal\)/.test(vmdSrc), "compares the claimed JOURNAL against Crossref's");
const idxMismatch = vmdSrc.indexOf("mismatch.length >= 1"), idxAdopt = vmdSrc.indexOf('x.ref.src_verified = "crossref"');
ok(idxMismatch > 0 && idxAdopt > idxMismatch, "the comparison happens BEFORE adopting Crossref metadata (no silent relabelling)");
ok(/if\(r\.src_verified === "crossref"\) return \["high", "doi_identity_verified"\]/.test(html),
   'the label is "doi_identity_verified" — it does NOT claim the source supports the claim');
ok(!/"doi_verified"/.test(html), "the misleading 'doi_verified' label is gone");

// the comparison helpers must not accuse when data is missing (fail safe, not fail loud)
const hctx = {}; vm.createContext(hctx);
vm.runInContext(html.slice(html.indexOf("var _TSTOP ="), html.indexOf("function _extractDoi(")), hctx);
const tSim = vm.runInContext("_titleSimilar", hctx), jAgree = vm.runInContext("_journalAgree", hctx);
ok(tSim("", "Anything") === 1 && tSim("Anything", "") === 1, "missing title → similarity 1 (never accuse on absent data)");
ok(jAgree("", "NEJM") === true && jAgree("NEJM", "") === true, "missing journal → agrees (never accuse on absent data)");
ok(tSim("Dapagliflozin in Patients with Heart Failure and Reduced Ejection Fraction",
        "Dapagliflozin in patients with heart failure and reduced ejection fraction") >= 0.5, "same paper → similar");
ok(tSim("Tolvaptan for Hyponatremia", "Colchicine for Acute Pericarditis") < 0.5, "unrelated papers → NOT similar (would be dropped)");
ok(jAgree("N Engl J Med", "New England Journal of Medicine") === true, "journal abbreviation matches full name");
ok(jAgree("Blood", "BMJ") === false, "different journals disagree");


// ── C. UNVERIFIED-WRITER WARNING (Jenni 2026-07-26) ───────────────────────────
// Only Claude has cleared the frozen benchmark. ChatGPT BYOK is LIVE and untested; Gemini Pro passed
// safety but lost 0-6 on quality. A reader cannot tell any of that from the talk, so it must be said.
ok(/var WRITER_BENCHMARK_CLEARED = /.test(html), "WRITER_BENCHMARK_CLEARED table exists");
ok(/function writerIsBenchmarked\(/.test(html), "writerIsBenchmarked() exists");
ok(/function writerWarningHtml\(/.test(html), "writerWarningHtml() exists");
ok(/h \+= writerWarningHtml\(t\);/.test(html), "the warning is rendered into the talk view");
{
  const wctx = { esc: (x) => String(x) };
  vm.createContext(wctx);
  vm.runInContext(html.slice(html.indexOf("var WRITER_BENCHMARK_CLEARED"), html.indexOf("function _provenanceChips")), wctx);
  const cleared = vm.runInContext("WRITER_BENCHMARK_CLEARED", wctx);
  const isB = vm.runInContext("writerIsBenchmarked", wctx);
  const warn = vm.runInContext("writerWarningHtml", wctx);

  // KEYED BY EXACT MODEL ID (Codex 2026-07-26). Provider-level keying vouched for claude-opus-4-8,
  // Sonnet 4 and Haiku 4.5 — none of which were benchmarked — because they are all "Claude".
  ok(cleared["claude-opus-5"] === true, "claude-opus-5 (the benchmarked reference arm) is cleared");
  ok(cleared["claude-opus-4-8"] === false, "production MODEL_MAIN claude-opus-4-8 is NOT cleared (untested)");
  ok(cleared["claude-sonnet-4-20250514"] === false, "the Sonnet overload fallback is NOT cleared");
  ok(cleared["claude-haiku-4-5-20251001"] === false, "the Haiku overload fallback is NOT cleared");
  ok(cleared["gpt-5"] === false, "gpt-5 (live ChatGPT BYOK default) is NOT cleared");
  ok(cleared["gemini-3.6-flash"] === false && cleared["gemini-3.1-pro-preview"] === false, "neither Gemini is cleared");
  ok(!("claude" in cleared) && !("openai" in cleared), "no PROVIDER-level keys remain (that was the bug)");

  ok(isB("claude-opus-5") === true, "writerIsBenchmarked passes the cleared model");
  ok(isB("claude-opus-4-8") === false, "writerIsBenchmarked rejects the untested production model");
  ok(isB("some-future-model") === false, "an UNKNOWN model id fails CLOSED (a model swap can't inherit a badge)");
  ok(isB("") === false && isB(null) === false, "empty/absent model id is not cleared");

  // MODEL_MAIN must actually appear in the table, or a future bump silently escapes labelling
  const mainModel = (html.match(/var MODEL_MAIN = "([^"]+)"/) || [])[1];
  ok(!!mainModel, "found MODEL_MAIN in index.html");
  ok(Object.prototype.hasOwnProperty.call(cleared, mainModel),
     `production MODEL_MAIN (${mainModel}) is listed in WRITER_BENCHMARK_CLEARED`);

  ok(warn({ _writtenBy: "claude", _writerModel: "claude-opus-5" }) === "", "no warning on a talk written by the cleared model");
  ok(warn({ _writtenBy: "claude", _writerModel: "" }) === "", "no warning when the model is UNRECORDED (legacy talk — don't accuse)");
  ok(warn({}) === "" && warn(null) === "", "no warning on absent/null talk");
  const wProd = warn({ _writtenBy: "claude", _writerModel: "claude-opus-4-8" });
  ok(wProd.length > 200, "the untested PRODUCTION model does warn");
  ok(/claude-opus-4-8/.test(wProd), "the warning names the exact model id, not just the provider");
  const wOai = warn({ _writtenBy: "openai", _writerModel: "gpt-5" }), wGem = warn({ _writtenBy: "gemini", _writerModel: "gemini-3.1-pro-preview" });
  ok(/ChatGPT/.test(wOai) && /gpt-5/.test(wOai), "ChatGPT warning names provider AND model");
  ok(/Gemini/.test(wGem) && /gemini-3.1-pro-preview/.test(wGem), "Gemini warning names provider AND model");
  for (const [needle, why] of [
    ["not verified", "says plainly it is unverified"],
    ["more strongly than the guideline", "names guideline overstatement (the observed pattern)"],
    ["wrong guideline", "names misattribution"],
    ["mechanism errors", "names mechanism errors"],
    ["primary source", "tells the reader what to actually do about it"],
  ]) ok(wOai.includes(needle), `warning ${why}`);
}

// the exact model must be CAPTURED from both generation paths, not inferred
// Declared together with the other draft flags — this file has produced two var-hoisting bugs, so the
// point is that the declaration exists at the top of generate(), not its exact spelling.
ok(/var txt, _asyncCritTxt = null,[^;]*_draftModel = ""/.test(html),
   "_draftModel is declared with the other draft flags (no var-hoisting trap)");
ok(/_draftModel = \(_res && _res\.modelUsed\) \|\| "";/.test(html), "async/Worker path captures modelUsed");
ok(/_draftModel = mainResult\.modelUsed \|\| "";/.test(html), "sync path captures modelUsed (incl. an overload fallback)");
// Provenance now goes through ONE helper (three hand-rolled copies had drifted, and the resume path had
// none at all), so assert the model reaches that helper rather than a specific assignment line.
ok(/_stampProvenance\(finalTalk, \{\s*\n\s*writerModel: _draftModel/.test(html),
   "the exact drafting model is passed to the provenance stamp");
ok(/writerModels: \[_draftModel \|\| ""\]\.concat\(_critiqueRewroteTalk/.test(html),
   "a critic REWRITE records the critic's model too — it wrote the text on screen");
ok(/writerModel: _draftModel/.test(html), "a WITHHELD draft remembers which model wrote it");
ok(/writerModel: rp\.writerModel \|\| ""/.test(html), "a review retry restores the original writer model (it never re-drafts)");

ok(/\(unverified model\)/.test(html), "the 'Written by' chip marks an unverified model too (defence in depth)");


// ── D. ONLY BENCHMARKED MODELS MAY WRITE (launch option B, 2026-07-26) ────────
ok(/function writeAllowedModels\(/.test(html), "writeAllowedModels() gate exists");
ok(/var WRITER_UNAVAILABLE_MSG = /.test(html), "an honest availability message exists");
ok(/var mainModels = writeAllowedModels\(/.test(html), "the DRAFT chain is filtered to benchmarked models");
ok(/var criticModels = writeAllowedModels\(/.test(html), "the CRITIC chain is filtered too (a critique that returns a corrected talk WRITES)");
ok(/S\.error = WRITER_UNAVAILABLE_MSG/.test(html), "an empty chain surfaces the availability error instead of writing");
{
  const gctx = { console: { warn() {} } };
  vm.createContext(gctx);
  vm.runInContext(html.slice(html.indexOf("var WRITER_BENCHMARK_CLEARED"), html.indexOf("function _provenanceChips")), gctx);
  const allow = vm.runInContext("writeAllowedModels", gctx);
  const MAIN = (html.match(/var MODEL_MAIN = "([^"]+)"/) || [])[1];
  const SON = (html.match(/var MODEL_SONNET_FALLBACK = "([^"]+)"/) || [])[1];
  const HAI = (html.match(/var MODEL_CRITIC = "([^"]+)"/) || [])[1];
  // Updated 2026-07-26: TWO models are now cleared (Opus 5 + Sonnet 5), so the filter keeps both and the
  // leader is whichever the chain puts first. Haiku is still barred, so an all-Haiku chain yields nothing.
  // Reverted 2026-07-26: Sonnet 5 is a PILOT, not cleared, so exactly one writer survives.
  ok(allow([MAIN, SON, HAI]).length === 1 && allow([MAIN, SON, HAI])[0] === MAIN,
     `only the fully-benchmarked writer survives (${MAIN}); a 6-row pilot does not count`);
  ok(!allow([MAIN, SON, HAI]).includes(HAI) && !allow([MAIN, SON, HAI]).includes(SON),
     "both the uncleared Haiku and the PILOT Sonnet are filtered OUT of the chain");
  ok(allow([HAI]).length === 0, "a chain of only-uncleared models yields NOTHING (forces the honest error)");
  ok(allow([]).length === 0 && allow(null).length === 0, "empty/null input is safe");
  // MODEL_MAIN itself must be benchmarked, or the app cannot write at all
  const isB = vm.runInContext("writerIsBenchmarked", gctx);
  ok(isB(MAIN) === true, `MODEL_MAIN (${MAIN}) is benchmarked — otherwise generation is dead on arrival`);
}
// worker.js must ALLOW the model the client now asks for, or every free-tier call 400s
{
  const worker = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  const MAIN = (html.match(/var MODEL_MAIN = "([^"]+)"/) || [])[1];
  const SON = (html.match(/var MODEL_SONNET_FALLBACK = "([^"]+)"/) || [])[1];
  ok(worker.includes(`"${MAIN}"`), `worker ALLOWED_MODELS includes MODEL_MAIN (${MAIN}) — it rejects anything unlisted`);
  ok(worker.includes(`"${SON}"`), `worker ALLOWED_MODELS includes the Sonnet fallback (${SON})`);
  // and price it, or the spend cap mis-counts
  const priceBlock = worker.slice(worker.indexOf("const MODEL_PRICES"), worker.indexOf("const IMAGE_FLAT_CENTS"));
  ok(priceBlock.includes(`"${MAIN}"`), `MODEL_PRICES has an entry for ${MAIN} (the $250 cap depends on it)`);
  ok(/"claude-opus-5":\s*\{ in: 5\.0,\s*out: 25\.0/.test(priceBlock), "Opus priced at the REAL $5/$25, not the old $15/$75");
  ok(/"claude-haiku-4-5-20251001":\s*\{ in: 1\.0,\s*out: 5\.0/.test(priceBlock), "Haiku 4.5 priced at the real $1/$5");
  ok(!/in: 15\.0, out: 75\.0/.test(priceBlock), "the 3x-overstated Opus price is gone (it was throttling the cap early)");
}


// ── E. A FAILED candidate stays barred; the WORKER fails closed (Codex 2026-07-26) ────
{
  const rctx = { console: { warn() {} } };
  vm.createContext(rctx);
  const MAIN = (html.match(/var MODEL_MAIN = "([^"]+)"/) || [])[1];
  const SON = (html.match(/var MODEL_SONNET_FALLBACK = "([^"]+)"/) || [])[1];
  const HAI = (html.match(/var MODEL_CRITIC = "([^"]+)"/) || [])[1];
  rctx.MODEL_MAIN = MAIN; rctx.MODEL_SONNET_FALLBACK = SON; rctx.MODEL_CRITIC = HAI;
  vm.runInContext(html.slice(html.indexOf("var WRITER_BENCHMARK_CLEARED"), html.indexOf("function _provenanceChips")), rctx);
  const allow = vm.runInContext("writeAllowedModels", rctx);
  const isB = vm.runInContext("writerIsBenchmarked", rctx);
  const refine = vm.runInContext("refineWriterModel", rctx);

  // A 6-row pilot is NOT benchmark clearance — the frozen suite is 20 rows.
  ok(isB(SON) === false, `${SON} is NOT cleared — it FAILED the full 20-row benchmark (bars 2/5/6)`);
  ok(isB(HAI) === false, "Haiku is not cleared");
  ok(allow([MAIN, SON, HAI]).length === 1 && allow([MAIN, SON, HAI])[0] === MAIN,
     "only the fully-benchmarked writer survives the filter");
  ok(allow([SON, MAIN, HAI])[0] === MAIN, "the lecture chain self-corrects to the cleared model now that Sonnet failed");
  ok(allow([SON, HAI]).length === 0, "a chain of FAILED/uncleared models yields NOTHING (honest error, no silent downgrade)");
  ok(isB(refine()) === true, `the refine writer (${refine()}) is cleared — editing cannot un-verify a talk`);

  // the reference model must not get a free pass: its absolute failures are recorded in-code
  const tableSrc = html.slice(html.indexOf("var WRITER_BENCHMARK_CLEARED"), html.indexOf("function writerIsBenchmarked"));
  ok(/ON NOTICE/.test(tableSrc), "the reference model is marked ON NOTICE, not automatically passed");
  ok(/Universal Definition/.test(tableSrc) && /invalid JSON/.test(tableSrc),
     "the reference model's own ABSOLUTE failures (fabricated dated guideline, invalid JSON) are recorded");
  ok(/FAILED the full 20-row benchmark/.test(tableSrc),
     "Sonnet 5's FULL 20-row failure is recorded in-code (the 6-row pilot looked fine; the full suite did not)");
  ok(/intermediate-HIGH/.test(tableSrc) && /MRA/.test(tableSrc),
     "the disqualifying bedside-actionable findings (PE misclassification, withholding an MRA) are named");
  ok(/TIED Opus on every automated check/.test(tableSrc),
     "records that the automated layer could NOT separate the two models — only the judge did");
}
ok(!/model: *"claude-sonnet-4-6"/.test(html) && !/model:"claude-sonnet-4-6"/.test(html),
   "no refine path hardcodes the unbenchmarked claude-sonnet-4-6 any more");
ok((html.match(/refineWriterModel\(\)/g) || []).length >= 6, "all refine call sites route through refineWriterModel()");

// ── F. WORKER fails closed and stays in sync with the client ──────────────────
{
  const worker = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
  ok(/const WRITER_CLEARED = \[/.test(worker), "worker declares a WRITER_CLEARED list separate from ALLOWED_MODELS");
  const genSrc = worker.slice(worker.indexOf("async function callAnthropicText"), worker.indexOf("async function runGeneration"));
  ok(/WRITER_CLEARED\.indexOf\(m\) >= 0/.test(genSrc), "generation filters models against WRITER_CLEARED, not the broad allowlist");
  ok(/throw err;/.test(genSrc) && /no_cleared_writer/.test(genSrc), "an empty chain THROWS instead of substituting a fallback");
  ok(!/if \(!models\.length\) models = \[/.test(genSrc),
     "the hardcoded fallback to unverified models is GONE (it silently defeated the writer restriction)");

  // the two cleared-lists must agree, or the worker rejects what the client sends (or worse, permits more)
  const clientCleared = [...html.matchAll(/^\s*"([a-z0-9.\-]+)":\s*true,/gm)].map((m) => m[1]).sort();
  const wBlock = worker.slice(worker.indexOf("const WRITER_CLEARED"), worker.indexOf("const ALLOWED_TOOL_TYPES"));
  const workerCleared = [...wBlock.matchAll(/^\s*"([a-z0-9.\-]+)",/gm)].map((m) => m[1]).sort();
  ok(JSON.stringify(clientCleared) === JSON.stringify(workerCleared),
     `client and worker cleared-writer lists are IN SYNC (client: [${clientCleared}], worker: [${workerCleared}])`);
  ok(workerCleared.length >= 1, "at least one cleared writer exists, or generation is impossible");
}

console.log("\n" + (failures === 0 ? "✔ GEMINI GATE + DOI TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
