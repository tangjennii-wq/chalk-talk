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
ok(/if\(r\.src_verified === "crossref"\) return \["high", "doi_verified"\]/.test(html),
   "a Crossref-verified DOI earns high confidence (same tier as a PubMed-verified PMID)");
ok(/return any \? out : null;/.test(html), "a total network failure returns null → FAIL OPEN (drops nothing)");
const vmdSrc = html.slice(html.indexOf("async function verifyModelDois("), html.indexOf("async function verifyModelDois(") + 1800);
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

console.log("\n" + (failures === 0 ? "✔ GEMINI GATE + DOI TESTS PASSED" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
