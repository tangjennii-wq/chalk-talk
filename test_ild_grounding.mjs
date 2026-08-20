// ILD / PH-ILD GROUNDING — run: node test_ild_grounding.mjs
//
// A review of an ILD card raised four points. Verification split them three ways, and the split is the
// reason this suite exists:
//
//   WRONG REVIEW, CORRECT CARD. The review said guidelines STRONGLY recommend nintedanib for PPF and
//   that pirfenidone is the conditional one. The 2022 ATS/ERS/JRS/ALAT guideline made a CONDITIONAL
//   recommendation for nintedanib and NO formal recommendation for pirfenidone — only a call for further
//   research. The card already said "conditionally recommended" and was right. Applying that correction
//   would have introduced an error into correct teaching, so the corpus now states the strengths
//   explicitly and names both wrong directions.
//
//   CORPUS WRONG. The entry said "Group 3 (lung disease): treat the underlying disease, do NOT use PAH
//   drugs" — a blanket that the card faithfully repeated. Inhaled treprostinil has been FDA-approved for
//   PH-ILD since April 2021 on INCREASE.
//
//   CORPUS UNREACHABLE. SSc-ILD agents were filed only under Rheumatology, which an ILD topic does not
//   route to. Restated in the Pulmonary entry rather than by widening routing, which is frozen.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const G = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;
const find = (spec, re) => (G[spec].guidelines || []).find(e => re.test(e.name || ""));
const ipf = find("Pulmonary", /IPF \+ Progressive PF/).keys;
const ph  = find("Pulmonary", /Pulmonary Hypertension/).keys;

// ── 1. recommendation STRENGTH, and both wrong directions named ─────────────────────────────────────
ok(/CONDITIONAL recommendation\s+for NINTEDANIB in PPF/.test(ipf),
   "nintedanib in PPF is recorded as a CONDITIONAL recommendation, which is what the guideline says");
ok(/PIRFENIDONE it made NO formal recommendation at all/.test(ipf),
   "…and pirfenidone as having NO formal recommendation, only a call for research");
ok(/Nintedanib is not strongly recommended and pirfenidone is not conditionally\s+recommended/.test(ipf),
   "…with BOTH wrong directions named, because the review asserted the inverse of each");

// ── 2. the blanket Group 3 statement is corrected AT SOURCE, not annotated later ────────────────────
ok(!/Group 2 \(left heart\) and Group 3 \(lung disease\): treat the underlying disease, do NOT use PAH drugs\./.test(ph),
   "the blanket 'Group 3: do NOT use PAH drugs' sentence is GONE from the source, not contradicted below it");
ok(/Group 2 \(left heart\): treat the underlying disease, do NOT use PAH drugs\./.test(ph),
   "…while Group 2 keeps the statement that is still true of it");
ok(/INHALED TREPROSTINIL IN PH-ILD/.test(ph) && /April 2021/.test(ph),
   "inhaled treprostinil is named as the PH-ILD exception, with its approval date");
ok(/ORAL PAH MONOTHERAPY IS NOT SUPPORTED IN GROUP 3, INHALED TREPROSTINIL IS THE SPECIFIC EXCEPTION/.test(ph),
   "…and the teaching line carries BOTH halves, since either alone is wrong");
ok(/Do not teach either half alone/.test(ph), "…and says so outright");

// ── 3. INCREASE carries real numbers, from the primary record ───────────────────────────────────────
ok(/31\.12 m/.test(ph) && /16\.85 to 45\.39/.test(ph) && /P below 0\.001/.test(ph),
   "INCREASE carries the least-squares mean difference with its CI and p value");
ok(/326 patients randomised\s+163\/163/.test(ph),
   "…and the randomised n, not the enrolled n a secondary source gave");
ok(/PMID 33440084/.test(ph) && /N Engl J Med 2021;384:325-334/.test(ph), "…with a citable identifier");

// The trial index must be able to fetch it, or the talk still recites from memory.
const trials = JSON.parse(readFileSync(new URL("./landmark_pmids.json", import.meta.url), "utf8")).trials;
ok(!!trials.INCREASE && trials.INCREASE.pmid === "33440084",
   "INCREASE is in the landmark index, so the abstract is retrievable rather than recalled");

// The entry TEACHES INCREASE, so the topic must REQUEST it. gatherTrialEvidence resolves from the
// specialty trials list; without INCREASE there it is only picked up when the model happens to name the
// acronym in its draft, which makes the grounding a coin flip and the canary gate meaningless.
const pulmTrials = G.Pulmonary.trials || [];
ok(pulmTrials.includes("INCREASE"),
   "INCREASE is in the Pulmonary trials list, so the abstract is REQUESTED rather than hoped for");

// ── 4. the PANTHER boundary — a scope claim, not a treatment claim ──────────────────────────────────
ok(/AVOID steroids\/immunosuppression in IPF \(PANTHER harm\)/.test(ipf), "the IPF steroid warning survives…");
ok(/IPF-SPECIFIC AND DOES NOT\s+TRANSFER/.test(ipf),
   "…bounded to IPF, because PANTHER studied IPF and is not evidence about CTD-ILD");
ok(/over-reading a trial past its population/.test(ipf), "…naming the error the card actually made");

// ── 5. CTD-ILD agents reach an ILD talk ─────────────────────────────────────────────────────────────
ok(/MYCOPHENOLATE, NINTEDANIB\s+\(SENSCIS\) and TOCILIZUMAB \(focuSSced\)/.test(ipf),
   "SSc-ILD agents are restated in the PULMONARY entry, which an ILD topic actually reaches");
ok(/MMF is not the\s+only first-line answer/.test(ipf), "…and the point the card missed is stated plainly");
ok(/Do not attach an FVC percentage to tocilizumab without checking focuSSced\s+directly/.test(ipf),
   "…while the unverified FVC figure is refused rather than repeated");

// ── 6. provenance, and no hedged actionables ────────────────────────────────────────────────────────
ok(/read directly in the\s+2022 ATS\/ERS\/JRS\/ALAT guideline on 19 Aug 2026/.test(ipf),
   "the entry records which document was read, and when");
for (const [label, txt] of [["IPF", ipf], ["PH", ph]])
  ok(!/\bnot\b[^.;]{0,32}?\bverified\b/i.test(txt) && !/\bunverified\b/i.test(txt),
     `${label}: asserts nothing it admits it has not checked`);

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ ILD GROUNDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
