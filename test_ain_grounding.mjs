// AIN GROUNDING — run: node test_ain_grounding.mjs
//
// Nephrology held NOTHING on acute interstitial nephritis — zero occurrences of "interstitial
// nephritis", "eosinophil", "proton pump", "IFTA" or "checkpoint" anywhere in the specialty. Every
// number in an AIN card came from model memory.
//
// The review supplied plenty of numbers. NONE was read here against a primary source, so this entry is
// mostly RESTRICTIONS: it states the one conceptual correction that is safe to assert, and then names
// each withheld figure so the model cannot quietly supply it again. An entry that says "no figure is
// given here" is doing more work than an entry that guesses one.
//
// The load-bearing assertions in this suite are therefore NEGATIVE. If a percentage appears in this
// entry, something has gone wrong.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const G = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;
const e = (G.Nephrology.guidelines || []).find(x => /Interstitial Nephritis/.test(x.name));
ok(!!e, "the AIN entry exists in Nephrology");
const k = e.keys;

// ── the one correction that is safe to assert ───────────────────────────────────────────────────────
ok(/STEROIDS ARE CONTESTED, NOT SUPPORTED/.test(k), "steroid benefit is framed as contested…");
ok(/CONFLICTING RETROSPECTIVE DATA plus weak randomised\s+evidence/.test(k),
   "…with the actual shape of the evidence named, not just 'observational'");
ok(/evidence is insufficient/.test(k), "…including that systematic review found it insufficient");
ok(/It may\s+not say the data support them/.test(k),
   "…and the entry states the boundary: commonly given, benefit unproven, not 'supported'");
ok(/STOPPING THE CULPRIT DRUG IS THE INTERVENTION EVERYONE AGREES ON/.test(k),
   "…while keeping the emphasis on the intervention nobody disputes");

// ── NO PERCENTAGES. This is the point of the entry. ─────────────────────────────────────────────────
ok(!/\d\s*(?:-\s*\d+\s*)?(?:percent|%)/.test(k),
   "NO percentage appears anywhere in the entry — every figure the review supplied is withheld");
ok(!/AUC/.test(k) || !/0\.9/.test(k), "…including a biomarker AUC");
ok(!/\bESRD in\b/.test(k) && !/76|86|69|39|27\b/.test(k),
   "…and none of the recovery, ESRD or biopsy-share numbers slipped in");

// Each withheld class is NAMED, so the absence is deliberate rather than an oversight.
for (const [label, re] of [
  ["recovery proportions", /recovery percentages \(complete or partial\)/],
  ["ESRD / non-recovery", /ESRD or non-recovery proportions/],
  ["the steroid duration ceiling", /ceiling\s+beyond which further steroid duration adds nothing/],
  ["AIN share of AKI biopsies", /share of AKI biopsies that are AIN/],
  ["biomarker AUCs", /urinary biomarker AUCs/],
  ["ICI rechallenge recurrence", /recurrence rate after checkpoint-inhibitor rechallenge/],
]) ok(re.test(k), `${label} is named as deliberately absent`);
ok(/Cite the study you are using or give no figure/.test(k), "…with the instruction that replaces them");

// ── prognosis: the qualitative point survives, the numbers do not ───────────────────────────────────
ok(/tracks CHRONICITY ON BIOPSY and the need for dialysis\s+more than it tracks peak creatinine/.test(k),
   "the prognosis POINT is kept — outcome tracks chronicity and dialysis need, not peak creatinine");
ok(/attach no percentage to it here/.test(k), "…explicitly without a number attached");

// ── biomarkers: direction of travel, not a test to order ────────────────────────────────────────────
ok(/They are NOT in any guideline/.test(k), "urinary biomarkers are marked as not in any guideline…");
ok(/never as\s+a test to order/.test(k), "…and barred from being taught as something to order");

// ── ICI-AIN: the NCCN specifics stay out until the pages are read ───────────────────────────────────
ok(/have NOT been read into this entry/.test(k), "the ICI-AIN specifics are marked as not read…");
ok(/Do not\s+present an escalation list or a rechallenge rule as guideline-derived/.test(k),
   "…and neither an escalation list nor a rechallenge rule may be presented as guideline-derived");
ok(/What is safe: ICI-AIN is managed with the culprit drug held and specialist nephrology input/.test(k),
   "…while what IS safe is stated, so the section is not merely a wall of refusals");

// ── the standing rule still holds: no hedged actionables ────────────────────────────────────────────
ok(!/\bnot\b[^.;]{0,32}?\bverified\b/i.test(k) && !/\bunverified\b/i.test(k),
   "the entry asserts nothing it admits it has not checked");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ AIN GROUNDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
