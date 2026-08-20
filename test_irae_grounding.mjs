// irAE GROUNDING — run: node test_irae_grounding.mjs
//
// Five review points, split by verification into three groups. The split is the whole value, and this
// suite exists to keep the withheld group withheld.
//
// VERIFIED AND INGESTED: the CheckMate 067 four-year figures (with the right LABEL), the CheckMate 8HW
// figures, and the true design of the myocarditis cohort.
//
// CONCEPT RIGHT, NUMBERS WITHHELD: there is no universal grade-to-dose steroid grid — that correction
// stands and the grid is gone — but the per-organ NCCN doses are NOT in the entry, because an accessible
// v1.2026-derived table gives grade 3-4 hepatitis at 1 mg/kg/day rather than the proposed 0.5-1 range.
// Removing a wrong grid does not license writing in unverified numbers.
//
// OVERPHRASED, DOWNGRADED: abatacept + ruxolitinib. The 3.4% vs 60% mortality came from a nonrandomised
// before-and-after cohort where the later 30 patients received an entire BUNDLE — respiratory-muscle
// screening, ventilation, personalised high-dose abatacept, ruxolitinib — against the first 10. The
// authors call it hypothesis-generating.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const G = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;
const k = (G.Oncology.guidelines || []).find(x => /Immune-Related/.test(x.name)).keys;

// ── the steroid grid is GONE, and no replacement numbers crept in ───────────────────────────────────
ok(/THERE IS NO UNIVERSAL GRADE-TO-DOSE GRID/.test(k), "the entry says outright there is no universal grid");
ok(!/Grade 2 - HOLD the drug, start prednisone 0\.5-1 mg\/kg/.test(k),
   "…and the old 'Grade 2 = 0.5-1 mg/kg' line is gone from the source sentence");
ok(!/methylprednisolone 1-2 mg\/kg/.test(k), "…as is 'Grade 3 = 1-2 mg/kg'");
ok(/steroid dosing in irAEs is ORGAN-SPECIFIC/.test(k), "…replaced by the principle that dosing is organ-specific");
// THE WITHHOLDING IS THE POINT. Unverified per-organ doses must not have replaced the grid.
// A NUMBER attached to mg/kg, not the bare unit. The first version of this assertion caught my own
// draft quoting the withdrawn doses verbatim to explain that they were withdrawn — true, and still
// putting the numbers in front of the model, which is the adjacency trap that produced the
// ELITE-Symphony error. The entry now describes the old grid without restating it.
ok(!/\d\s*(?:-\s*\d\s*)?mg\/kg/.test(k),
   "NO mg/kg FIGURE appears anywhere — the grid was removed, not swapped for unread numbers, and not quoted back");
ok(/The old ranges are deliberately not repeated here/.test(k),
   "…and the entry says why it does not restate them");
ok(!/1 g\/day/.test(k) && !/pulse/.test(k), "…and no myocarditis pulse dose either");
ok(/NO NUMERIC\s+PER-ORGAN TABLE IS GIVEN HERE/.test(k), "…and the absence is stated so it is not filled in from memory");

// ── CheckMate 067: right numbers, and right LABEL ───────────────────────────────────────────────────
ok(/59 percent with nivolumab plus ipilimumab versus 22 percent with\s+nivolumab alone/.test(k),
   "the four-year figures are 59 vs 22…");
ok(/PMID 30361170/.test(k), "…citing the four-year paper");
ok(/TREATMENT-RELATED ADVERSE EVENTS, NOT irAE RATES/.test(k),
   "…and labelled treatment-related AEs, which is what the paper reports — not the same denominator");
ok(/55 PERCENT VERSUS 16 PERCENT PAIR IS THE 2015 ORIGINAL REPORT/.test(k),
   "the superseded 2015 pair is named so it is recognised rather than repeated");

// THE RETRIEVAL TRAP. The landmark index resolves CheckMate 067 to the 2015 paper, so the abstract
// fetched alongside this entry carries the OLD figures. The entry has to say so or it loses to the
// abstract sitting next to it.
const trials = JSON.parse(readFileSync(new URL("./landmark_pmids.json", import.meta.url), "utf8")).trials;
ok(trials.CHECKMATE067 && trials.CHECKMATE067.pmid === "26027431",
   "the index really does resolve CheckMate 067 to the 2015 report…");
ok(/the abstract fetched alongside this entry carries the OLD figures/.test(k),
   "…and the entry warns that the retrieved abstract disagrees with the figures above");

// ── CheckMate 8HW: denominator and comparator ───────────────────────────────────────────────────────
ok(/22 percent with nivolumab plus ipilimumab versus 14 percent with\s+nivolumab alone/.test(k),
   "CheckMate 8HW carries 22 vs 14…");
ok(/MSI-H\/dMMR colorectal cancer/.test(k), "…named to its tumour type");
ok(/23 percent for the\s+combination versus chemotherapy/.test(k), "…and the separate chemo comparison is distinguished");
ok(/Always state the denominator and the comparator/.test(k), "…with the general rule stated");
ok(!!trials.CHECKMATE8HW && trials.CHECKMATE8HW.pmid === "39874977",
   "and CheckMate 8HW is in the landmark index, so its abstract is retrievable");

// ── refractory colitis: not promoted ────────────────────────────────────────────────────────────────
ok(/SALVAGE CASE REPORTS; do not teach them as a routine next\s+tier/.test(k),
   "tofacitinib and ustekinumab are kept at case-report level, not promoted to a tier");

// ── myocarditis: bundled, nonrandomised, hypothesis-generating ──────────────────────────────────────
ok(/corticosteroids remain first-line/.test(k), "steroids are still first-line for myocarditis");
ok(/NONRANDOMISED BEFORE-AND-AFTER cohort/.test(k), "…and the abatacept/ruxolitinib result is labelled by its design");
ok(/later 30 patients\s+received a whole package/.test(k) && /first 10 patients/.test(k),
   "…including that it was a BUNDLE of 30 versus the first 10, not a drug comparison");
ok(/Do not attribute the difference to those two drugs/.test(k),
   "…and the entry forbids attributing the mortality difference to the two drugs");
ok(/hypothesis-generating/.test(k) && /INVESTIGATIONAL/.test(k), "…and calls it what the authors call it");

// ── provenance, and the standing rule ───────────────────────────────────────────────────────────────
ok(/verified by Jenni against the primary records on 20 Aug 2026/.test(k), "provenance names who verified, and when");
ok(!/\bnot\b[^.;]{0,32}?\bverified\b/i.test(k) && !/\bunverified\b/i.test(k),
   "the entry asserts nothing it admits it has not checked");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ irAE GROUNDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
