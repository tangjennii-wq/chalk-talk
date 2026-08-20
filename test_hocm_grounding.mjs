// HOCM / OBSTRUCTIVE HCM GROUNDING — run: node test_hocm_grounding.mjs
//
// The entry read, in full: "Sarcomeric mutations cause LVH, diastolic dysfunction, LVOT obstruction; SCD
// risk. Genetic testing + CMR risk stratification; ICD for SCD prevention. Disopyramide / verapamil for
// symptoms; mavacamten (cardiac myosin inhibitor) reduces LVOT gradient (EXPLORER-HCM)."
//
// Nothing in it is false. It is nonetheless the source of five separate errors an OpenEvidence review
// found in a generated HOCM deck, and each has its own failure class:
//
//   CORPUS-STALE   — aficamten was FDA-approved on 19 Dec 2025 (MYQORZO). The 2024 guideline predates it
//                    and the entry names only mavacamten, so the deck taught a class of one.
//   ADJACENCY      — "Disopyramide / verapamil for symptoms" puts them side by side as interchangeable
//                    symptom drugs. Disopyramide is vagolytic and ENHANCES AV nodal conduction; the
//                    guideline gives it only "in combination with an AV nodal blocking agent". The pairing
//                    is a safety requirement and the slash hides it.
//   CORPUS-SILENT  — no gradient threshold, so the deck invented one; no myectomy/ASA criteria, so the
//                    deck reached for "ablation for higher-risk anatomy", which INVERTS the real split.
//   CORPUS-SILENT  — nothing on AF anticoagulation, where HCM is a named exception to CHA2DS2-VASc.
//
// Five of the six review points verified as written. ONE DID NOT, and it is asserted here as a negative:
// the review said LVEF <50% occurred in "5.7% attributable to drug (up to 7-10% with cofactors)". The
// label reports 7 of 123 (6%) REVERSIBLE reductions and apportions no causation, and the 7-10% figure
// could not be sourced at all. It is withheld. The review also missed the April 2025 Camzyos label
// revision, which is the part of its own monitoring point that had actually changed.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const doc = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8"));
const G = doc.specialties;
const entry = (G.Cardiovascular.guidelines || []).find(x => /2024 AHA\/ACC HCM/.test(x.name));
ok(!!entry, "sanity: the HCM entry is present in Cardiovascular");
const k = entry.keys;

// ── THE OLD ONE-LINE ENTRY IS GONE, NOT APPENDED TO ────────────────────────────────────────────────
// Corrections were twice appended after the sentence carrying the error, leaving the entry asserting
// both the old claim and its correction. The old sentences must be absent, not merely outnumbered.
ok(!/Disopyramide \/ verapamil for symptoms/.test(k),
   "the 'Disopyramide / verapamil' slash is GONE — it was the adjacency that hid the AV-nodal pairing");
ok(!/mavacamten \(cardiac myosin inhibitor\) reduces LVOT gradient \(EXPLORER-HCM\)\./.test(k),
   "…and the single-drug myosin-inhibitor sentence is gone, not left standing beside its correction");

// ── 1. DISOPYRAMIDE IS NEVER GIVEN ALONE ───────────────────────────────────────────────────────────
ok(/in combination with an\s+atrioventricular nodal blocking agent/.test(k),
   "the guideline's own wording is quoted, so the pairing is not a paraphrase that can drift");
ok(/vagolytic and ENHANCES AV nodal conduction/.test(k),
   "…with the MECHANISM, which is the half that makes it stick");
ok(/if AF develops the ventricular response\s+can be dangerously rapid/.test(k),
   "…and the consequence, so the requirement is not an arbitrary rule");
ok(/safety requirement, not background therapy/.test(k),
   "…framed as a requirement, correcting the deck's 'added to a beta blocker'");

// ── 2. THE MYOSIN INHIBITORS ARE A CLASS OF TWO ────────────────────────────────────────────────────
ok(/aficamten/.test(k), "aficamten is named at all — the entry was a class of one");
ok(/FDA-approved 19 Dec 2025/.test(k), "…with the approval date, which is what makes the 2024 guideline stale here");
ok(/MYQORZO/.test(k), "…and the brand it was approved under, because that is how the approval is searchable");
ok(/SEQUOIA-HCM/.test(k), "…and its own pivotal trial, so the claim is citable rather than asserted");
ok(/EXPLORER-HCM/.test(k), "…while mavacamten keeps its own trial");
// THE ADJACENCY GUARD. Two drugs and two trials in one paragraph is exactly the shape that let a card
// credit finerenone with non-diabetic evidence. The mapping has to be explicit, and the entry has to
// say so, or a later editor tidies the two names back into one list.
ok(/NEVER carry a figure from\s+one drug's trial across to the other/.test(k),
   "…and cross-attribution between the two drugs is forbidden in words, not left to adjacency");
ok(/every number below is bound to the drug it came from/.test(k),
   "…with the binding rule stated, so the paragraph cannot be re-compressed into a list");
// The prompt has a named evidence-status category for exactly this state. Use its vocabulary.
ok(/FDA-approved but not yet guideline-named/.test(k),
   "aficamten is labelled with the prompt's own 'approved but not in the guideline' status…");
ok(/neither upgraded to a guideline recommendation nor dismissed/.test(k),
   "…and both directions of the error are named, since residents get this wrong both ways");
ok(/2024 AHA\/ACC guideline PREDATES that approval/.test(k),
   "…and the reason the guideline is silent is stated rather than left as an absence");

// ── 3. THE SAFETY MACHINERY, BOUND TO THE RIGHT DRUG ───────────────────────────────────────────────
ok(/BOXED WARNING for heart failure/.test(k) && /REMS/.test(k),
   "both inhibitors are marked as boxed-warning, REMS-restricted drugs");
ok(/7 of 123 patients \(6%\) had a REVERSIBLE fall in LVEF <50%/.test(k),
   "the LVEF figure is the label's own, with its denominator and its reversibility");
// THE POINT THE REVIEW GOT WRONG. Asserted as a negative so it cannot be quietly reinstated.
ok(!/5\.7%/.test(k),
   "the review's '5.7% attributable to drug' is NOT in the entry — the label apportions no causation");
ok(!/7-10%/.test(k) && !/7–10%/.test(k),
   "…nor its unsourced '7-10% with cofactors', which could not be verified at all");
ok(/does not apportion causation/.test(k),
   "…and the entry says why, so the figure is not re-added by someone reading the same review");
// The April 2025 label revision — the part the review itself missed.
ok(/April 2025 label revision/.test(k),
   "the April 2025 Camzyos revision is captured — the monitoring point the review stated in its old form");
ok(/every 12 weeks\s+to every 6 months/.test(k),
   "…including the actual change to maintenance echocardiography");
ok(/strong CYP2C19 inhibitors remain CONTRAINDICATED/.test(k),
   "…while the interaction that did NOT change is kept, so the downgrade is not over-generalised");
ok(/DOWNGRADED moderate CYP2C19 inhibitors and strong CYP3A4 inhibitors from\s+contraindications to managed interactions/.test(k),
   "…and the two that did change are named individually");
ok(/AFICAMTEN: do not initiate if LVEF <55%/.test(k),
   "aficamten's thresholds are bound to aficamten by name, not shared with mavacamten");
ok(/reduce the dose if LVEF falls to\s+40-<50%; interrupt if <40%/.test(k),
   "…with both action thresholds, which is what makes it teachable");

// ── 4. SRT: THE GRADIENT CRITERION AND THE NYHA II EXCEPTION ───────────────────────────────────────
ok(/>=50 mmHg AT REST OR\s+WITH PHYSIOLOGIC PROVOCATION/.test(k),
   "the criterion is rest OR provocation — a resting-only reading under-treats the provokable patient");
ok(/not resting gradient alone/.test(k), "…said explicitly, because that is the error being corrected");
ok(/usually\s+NYHA III-IV, refractory to guideline-directed medical therapy/.test(k),
   "…paired with the symptom criterion, since the gradient alone is not an indication");
ok(/EARLIER \(NYHA II\) surgical myectomy[\s\S]{0,80}is COR 2b/.test(k),
   "the NYHA II case is present AND carries its class — 2b is not the same permission as 1");
ok(/ONLY with additional clinical factors/.test(k), "…gated on the additional factors rather than open");
ok(/pulmonary hypertension attributed to LVOTO/.test(k), "…factor 1: pulmonary hypertension from LVOTO/MR");
ok(/LA enlargement with >=1 episode of\s+symptomatic AF/.test(k), "…factor 2: LA enlargement with symptomatic AF");
ok(/poor functional capacity attributable to LVOTO on exercise testing/.test(k), "…factor 3: exercise testing");
ok(/young adults with very high resting gradients \(>100 mmHg\)/.test(k), "…factor 4: >100 mmHg in the young");

// ── 5. MYECTOMY vs ASA — THE INVERSION ─────────────────────────────────────────────────────────────
// The deck said "ablation for higher-risk anatomy". Anatomy is the myectomy argument; ASA is the
// surgical-RISK argument. Getting this backwards sends the patient with an elongated leaflet to ablation.
ok(/ANATOMY FAVOURS MYECTOMY/.test(k), "anatomy is placed on the myectomy side…");
ok(/anomalous papillary muscle/.test(k) && /elongated anterior mitral leaflet/.test(k)
   && /intrinsic mitral valve disease/.test(k),
   "…with the specific anatomy the guideline lists, not the word 'anatomy' alone");
ok(/ALCOHOL SEPTAL ABLATION is for the severely symptomatic adult in\s+whom SURGERY is contraindicated/.test(k),
   "…and ASA is defined by surgical contraindication");
ok(/serious comorbidities or advanced\s+age/.test(k), "…on the guideline's own grounds: comorbidity or age");
ok(/'Ablation for higher-risk anatomy' inverts the criterion/.test(k),
   "…and the deck's exact wrong phrasing is quoted, so the specific error is blocked by name");
ok(/surgical-risk decision, not an\s+anatomical one/.test(k), "…with the correct framing stated positively");

// ── 6. AF IN HCM — THE CHA2DS2-VASc EXCEPTION, WITH ITS CLASSES ────────────────────────────────────
ok(/INDEPENDENT of CHA2DS2-VASc/.test(k), "HCM is marked as a CHA2DS2-VASc exception");
ok(/DOAC first-line and VKA second/.test(k), "…with the agent order the guideline gives");
ok(/COR 1 \(LOE B-NR\) for CLINICAL AF/.test(k), "clinical AF carries COR 1 and its level of evidence");
ok(/COR 1 \(LOE C-LD\) for device-detected SUBCLINICAL AF lasting >24 h/.test(k),
   "…subclinical >24 h is also COR 1, but at a different level — both are recorded");
ok(/5 minutes to <24 h[\s\S]{0,90}COR 2a \(LOE C-LD\)/.test(k),
   "…and the 5 min-24 h band is COR 2a, not the same recommendation");
ok(/individualised on episode duration, burden and other risk\s+factors/.test(k),
   "…with the factors that individualise it, which is what 2a means here");
ok(/trigger is the first clinical episode/.test(k),
   "…and the trigger is named, so 'anticoagulate regardless of score' is not read as covering every blip");
ok(/a single short device-detected run is not the same recommendation as clinical AF/.test(k),
   "…said as a contrast, since that conflation is the practical error");

// ── THE TRIAL MUST BE CITABLE, NOT JUST NAMED ──────────────────────────────────────────────────────
// Naming a trial the prompt then tells the model to cite, with no verified PMID behind it, is how the
// model ends up producing one from memory. Both HCM trials must resolve through the generated index.
const cards = G.Cardiovascular.trials || [];
ok(cards.includes("SEQUOIA-HCM"), "SEQUOIA-HCM is in Cardiovascular's trial list, so the prompt may cite it");
ok(cards.includes("EXPLORER-HCM"), "…alongside EXPLORER-HCM");
const idx = JSON.parse(readFileSync(new URL("./landmark_pmids.json", import.meta.url), "utf8")).trials;
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
ok(!!idx[norm("SEQUOIA-HCM")], "…and SEQUOIA-HCM resolves to a verified PMID in the generated index");
ok(idx[norm("SEQUOIA-HCM")].pmid === "38739079", "…the aficamten NEJM paper, not some other SEQUOIA");
ok(!!idx[norm("EXPLORER-HCM")] && idx[norm("EXPLORER-HCM")].pmid === "32871100",
   "…and EXPLORER-HCM still resolves to its own PMID");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ HOCM GROUNDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
