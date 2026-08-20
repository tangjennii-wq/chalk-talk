// PD PERITONITIS GROUNDING — run: node test_pd_peritonitis_grounding.mjs
//
// The Nephrology corpus had NOTHING on peritoneal dialysis: no ISPD guideline, and zero occurrences of
// peritonitis, dialysate or vancomycin anywhere in the specialty. So every figure in a PD talk came from
// model memory — the same shape as DKA (no entry) and pericarditis (221 characters).
//
// VERIFICATION CONTRADICTED THE REVIEW ON A DOSE. The review gave continuous intraperitoneal vancomycin
// as "load 20 mg/kg, then 25–50 mg/L each dwell". The ISPD 2022 guideline says LD 20–25 mg/kg, MD
// 25 mg/L. A maintenance range twice the guideline ceiling is not a nuance, it is a dosing error, and it
// is the fifth relayed review in a row to contain a claim the primary source does not support.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const G = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;
const e = (G.Nephrology.guidelines || []).find(x => /ISPD Peritonitis/.test(x.name));
ok(!!e, "the ISPD 2022 peritonitis entry exists in Nephrology");
const k = e.keys;

// ── the two quality targets, verbatim ───────────────────────────────────────────────────────────────
ok(/NO MORE THAN 0\.40\s+EPISODES PER YEAR AT RISK/.test(k), "the peritonitis rate target is 0.40 episodes per year at risk");
ok(/LESS THAN 15 PERCENT of all episodes/.test(k), "…and culture-negative peritonitis under 15 percent");
ok(/An older benchmark of 0\.5 episodes per patient-year is\s+superseded by 0\.40/.test(k),
   "…with the superseded 0.5 benchmark named, so it is not taught as current");
// A target is not a description of practice — the distinction the review was right about.
ok(/TARGETS a programme is measured against, not descriptions of typical practice/.test(k),
   "both are framed as targets rather than as typical achieved performance");

// ── vancomycin: the highest-harm numbers in the entry ───────────────────────────────────────────────
ok(/15-30 mg\/kg every\s+5-7 days for CAPD/.test(k) && /15 mg\/kg every 4 days for APD/.test(k),
   "intermittent dosing is present and NOT presented as abandoned");
ok(/LOADING DOSE\s+20-25 mg\/kg, MAINTENANCE 25 mg\/L in each dwell/.test(k),
   "continuous dosing carries the guideline figures: LD 20-25 mg/kg, MD 25 mg/L");
ok(/THE MAINTENANCE FIGURE IS 25 mg\/L/.test(k),
   "…and the maintenance figure is stated unambiguously");
ok(/25-50 mg\/L circulates in review material and\s+is NOT what this guideline gives/.test(k),
   "…with the circulating 25-50 mg/L range named as NOT from this guideline");
// The negative that matters: the wrong dose must not appear as an instruction anywhere.
ok(!/MAINTENANCE 25-50/.test(k) && !/25-50 mg\/L in each dwell/.test(k),
   "the 25-50 mg/L range is never rendered as a dosing instruction");

// ── serum levels: a practice point, not a recommendation ────────────────────────────────────────────
ok(/below 10\.1 mg\/L on\s+DAY 5 was associated with worse outcomes/.test(k), "the day-5 level finding is recorded…");
ok(/consensus on the optimal monitoring strategy\s+remains unclear/.test(k),
   "…alongside the guideline saying consensus on monitoring is unclear");
ok(/not a guideline\s+recommendation/.test(k),
   "…so 'check a level on day 5' is marked a practice point, not a recommendation");

// ── attribution discipline: right teaching, wrong source ────────────────────────────────────────────
// The metronidazole/imaging/surgery bundle is good clinical teaching and is NOT in this guideline.
// Teaching it is fine; attributing it to ISPD is not.
ok(/MULTIPLE ORGANISMS, particularly both\s+gram-positive AND gram-negative, is highly suggestive of an ENTERIC source/.test(k),
   "what the guideline DOES say about enteric peritonitis is recorded");
ok(/is NOT spelled out as such in this guideline, so do not attribute it to\s+ISPD/.test(k),
   "…and the surgical bundle is marked as not attributable to ISPD, though it is sound teaching");
ok(/N-ACETYLCYSTEINE for aminoglycoside ototoxicity is not a recommendation of this guideline/.test(k),
   "N-acetylcysteine is excluded as a recommendation rather than softly included");
ok(/must not be presented as standard care/.test(k), "…and explicitly barred from being taught as standard care");

// ── provenance, and no hedged actionables ───────────────────────────────────────────────────────────
ok(/PMID 35264029/.test(k) && /read directly in the ISPD 2022 peritonitis guideline/.test(k),
   "the entry records which document was read, and when");
ok(!/\bnot\b[^.;]{0,32}?\bverified\b/i.test(k) && !/\bunverified\b/i.test(k),
   "the entry asserts nothing it admits it has not checked");

// ── routing already reaches it, and must not be widened to reach it ─────────────────────────────────
// "peritoneal" is already a Nephrology keyword. Adding "peritonitis" would drag SPONTANEOUS BACTERIAL
// peritonitis — a GI/Hepatology topic — into Nephrology, so it is deliberately not a keyword.
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const nephKw = html.slice(html.indexOf('"Nephrology": ['), html.indexOf("]", html.indexOf('"Nephrology": [')) + 1);
ok(/"peritoneal"/.test(nephKw), "'peritoneal' is a Nephrology keyword, so the topic already reaches this entry");
ok(!/"peritonitis"/.test(nephKw),
   "…and 'peritonitis' is NOT a bare keyword, because it would route spontaneous bacterial peritonitis here");
// "PD peritonitis" is common and DID route to nothing. Fixed with a full-phrase rule rather than by
// widening a keyword — see COMPOUND_ROUTES and test_routing_coverage.mjs for the regression pair.
ok(html.includes('pd[- ]?(?:associated') && html.includes('spec: "Nephrology"'),
   "…and the gap is closed by a narrow full-phrase compound rule instead");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ PD PERITONITIS GROUNDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
