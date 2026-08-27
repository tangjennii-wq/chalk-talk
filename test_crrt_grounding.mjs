// CRRT GROUNDING — run: node test_crrt_grounding.mjs
//
// THIS ENTRY DID NOT EXIST. Searching guidelines.json for "CRRT", "continuous renal replacement" or
// "citrate" on 20 Aug 2026 returned nothing, in any specialty. A reviewed CRRT deck nonetheless came back
// "accurate, guideline-concordant, board-ready" — which is the clearest statement yet of the thing this
// corpus work exists to fix: the talk was good because the MODEL is good, not because grounding worked.
// Nothing about that deck was reproducible. The next one could have said 35 mL/kg/h and been equally
// unchallenged.
//
// So this file guards a CORPUS-SILENT repair rather than a corpus-wrong one, and the assertions are about
// numbers being PRESENT and correctly qualified rather than about a wrong claim being removed.
//
// Three of the review's own points are asserted in CORRECTED form, because verification changed them:
//   1. RICH — the review gave "longer filter life, less bleeding, no mortality difference" and stopped.
//      It omits that culture-proven infection was HIGHER with citrate (68.0% vs 55.4%) and that the trial
//      was stopped early. Taught as given, RICH reads as citrate winning outright.
//   2. Net UF >1.75 mL/kg/h — offered as a bare number. It is OBSERVATIONAL. The prompt has an explicit
//      rule against flattening evidence classes into one confident voice; a threshold with no class is
//      exactly that failure.
//   3. The 2026 citrate reframe — verified, and the consensus says something the review left out: standard
//      LFTs are POOR predictors of accumulation.
// One point is withheld entirely: the low-dose meta-analysis and its "<13 mL/kg/h raises mortality"
// figure could not be reached from here. It is in CORPUS_REVIEW_QUEUE.md, and its absence is asserted.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const G = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;
const entry = (G.Nephrology.guidelines || []).find(x => /CRRT prescription and delivery/.test(x.name));
ok(!!entry, "the CRRT entry exists at all — it did not, and that is the whole point of this file");
const k = (entry && entry.keys) || "";

// ── IT MUST BE REACHABLE, OR IT IS THE SAME SILENCE WITH MORE WORDS ────────────────────────────────
// An entry the router never selects is indistinguishable from no entry. "crrt" is already a Nephrology
// keyword, so the entry belongs in Nephrology and nowhere else; asserted, because filing it under
// Critical Care would have been the natural-looking mistake that reproduced the original bug.
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const nephKw = html.slice(html.indexOf('"Nephrology": ['), html.indexOf('"Nephrology": [') + 900);
ok(/"crrt"/.test(nephKw), "…and 'crrt' routes to Nephrology, which is the specialty it was filed under");
ok(!Object.entries(G).some(([sp, v]) => sp !== "Nephrology"
     && (v.guidelines || []).some(g => /CRRT prescription and delivery/.test(g.name))),
   "…and it is not duplicated into another specialty, where the two copies would drift apart");
ok(/THE CORPUS HAD NOTHING ON CRRT UNTIL 20 Aug 2026/.test(k),
   "…and it records that it was created from silence, so the gap is not re-opened by someone tidying");

// ── DOSE: THE NUMBER, THE DELIVERED/PRESCRIBED GAP, AND THE CEILING ────────────────────────────────
ok(/20-25 mL\/kg\/h DELIVERED/.test(k), "the KDIGO target is present and marked as DELIVERED…");
ok(/prescribe 25-30 mL\/kg\/h/.test(k) && /10-20% downtime/.test(k),
   "…with the prescribe-higher correction and the reason, which is what makes the two numbers different");
ok(/urea sieving is ~1/.test(k) && /clearance is\s+approximately total effluent flow/.test(k),
   "effluent is tied to clearance through sieving, so the 'currency' claim has a mechanism under it");
ok(/Diffusion \(CVVHD\) clears small solutes; convection \(CVVH\) clears\s+middle molecules/.test(k),
   "…and the two transport modes are mapped to the solutes they clear, not just named");
// The trial pair. Both arms of both trials, or the reader cannot tell what was compared.
ok(/RENAL \(40 vs 25 mL\/kg\/h\)/.test(k), "RENAL carries BOTH its arms…");
ok(/ATN \(intensive vs less\s+intensive, ~35 vs 20\)/.test(k), "…and so does ATN");
ok(/NO mortality and NO renal-recovery benefit/.test(k), "…with the finding stated for both outcomes");
ok(/flat across every\s+prespecified subgroup/.test(k),
   "…and the subgroup flatness, which is what stops 'but my patient is sicker' reasoning");
ok(/MORE hypophosphataemia/.test(k) && /more hypotension/.test(k),
   "…and the HARMS of the higher dose, so the ceiling is a finding rather than rationing");
ok(/not as rationing/.test(k), "…said explicitly, because that is how a dose ceiling is usually misheard");

// ── MODALITY: CRRT'S ADVANTAGE IS NOT MORTALITY ────────────────────────────────────────────────────
ok(/never beaten intermittent haemodialysis on mortality/.test(k), "the mortality equivalence is stated…");
ok(/acute brain\s+injury/.test(k) && /hepatic failure/.test(k) && /disequilibrium/.test(k),
   "…with the situations where tolerance genuinely decides, so the advantage is concrete");
ok(/choosing it for the one thing it does not do/.test(k),
   "…and the misconception is named rather than merely contradicted");

// ── CIRCUIT: THE BFR CONTRADICTION, RECONCILED ─────────────────────────────────────────────────────
// The deck said "blood flow does not increase clearance" on one slide and "raise BFR to 150-250 to
// prolong filter life" on another. Both true, and side by side with no reconciliation they read as an
// error. This is the corpus's job: hold the two facts together with the reason they are compatible.
ok(/Raising blood flow does NOT raise solute clearance \(effluent does\)/.test(k),
   "the clearance half of the blood-flow story is stated…");
ok(/150-250 mL\/min lowers\s+filtration fraction/.test(k), "…and the filter-life half, with its own number…");
ok(/a deck that gives one without the other reads as a contradiction/.test(k),
   "…and the entry says why both must appear together, which is the actual fix");
ok(/Filtration fraction <20-25%/.test(k), "the FF ceiling is present");
ok(/pre-dilution replacement lengthens filter life at a ~15% clearance\s+cost/.test(k),
   "…and pre-dilution carries its trade-off, not just its benefit");
ok(/Bicarbonate buffer over lactate in shock or liver failure/.test(k),
   "…and the buffer choice is tied to the physiology that drives it");

// ── FLUID REMOVAL: THE NUMBER *AND* ITS EVIDENCE CLASS ─────────────────────────────────────────────
ok(/Net ultrafiltration >1\.75 mL\/kg\/h/.test(k), "the net UF ceiling the deck was missing is present…");
ok(/OBSERVATIONAL/.test(k) && /secondary analysis of RENAL plus retrospective cohorts/.test(k),
   "…labelled OBSERVATIONAL with its actual provenance, per the prompt's evidence-status rule");
ok(/never as a proven causal threshold/.test(k),
   "…and explicitly not causal, which is the difference between a prudent ceiling and a fabricated rule");

// ── ANTICOAGULATION: RICH IN FULL, NOT THE FLATTERING HALF ─────────────────────────────────────────
ok(/Regional citrate is first-line \(KDIGO 2012, suggestion\/2B\)/.test(k),
   "citrate's guideline status carries its STRENGTH — a 2B suggestion is not a strong recommendation");
ok(/47 vs 26 h/.test(k), "RICH's filter-life result is present with both arms…");
ok(/5\.1% vs 16\.9%/.test(k), "…and the bleeding result…");
ok(/adjusted HR 0\.79, 95% CI\s+0\.63-1\.004, p=0\.054/.test(k),
   "…and the mortality result as the near-miss it actually was, not as a flat 'no difference'");
// THE HALF THE REVIEW LEFT OUT.
ok(/infection was HIGHER with citrate \(68\.0% vs 55\.4%\)/.test(k),
   "the infection signal is present — the review omitted it, and without it RICH reads as a clean win");
ok(/STOPPED EARLY at interim/.test(k),
   "…and the early stop, which is why the patient-centred outcomes are imprecise");
ok(/Do not\s+present RICH as citrate winning outright/.test(k),
   "…with the instruction that follows from both, so the trial is not re-flattened");

// ── CITRATE ACCUMULATION: THE 2026 REFRAME ─────────────────────────────────────────────────────────
ok(/NO LONGER\s+contraindications/.test(k), "liver failure and shock are no longer taught as contraindications…");
ok(/2026 Delphi consensus \(Critical Care, 13 May 2026\)/.test(k),
   "…attributed to the document and date that changed it, so the claim is checkable");
ok(/'reduce the\s+dose and monitor', not 'withhold'/.test(k),
   "…and the teaching move is given as a phrase, which is what a deck actually needs");
ok(/teaching the\s+pre-2026 position/.test(k),
   "…and the superseded position is named, so an older deck can be recognised as old rather than wrong-looking");
// The consensus finding the review did not carry, and the one most likely to change bedside behaviour.
ok(/STANDARD LIVER FUNCTION TESTS ARE POOR PREDICTORS/.test(k),
   "LFTs are marked as poor predictors of accumulation — the reflex they replace is exactly LFT-watching");
ok(/rising lactate and falling lactate clearance are the better risk signals/.test(k),
   "…with what to watch instead, or the correction leaves nothing in its place");
ok(/total:ionised calcium ratio >=2\.5/.test(k), "the accumulation ratio is present…");
ok(/coincides with a FALLING systemic\s+ionised calcium/.test(k) && /widening anion-gap metabolic acidosis/.test(k),
   "…as one of three concurrent findings, not as a standalone diagnosis");
ok(/some centres use 2\.4/.test(k), "…with the competing cut-off flagged as the review asked");
ok(/Post-filter ionised calcium target 0\.25-0\.35 mmol\/L/.test(k),
   "…and the post-filter target, which is the number actually titrated at the bedside");

// ── TIMING: THE DEPENDENCE NUMBER, NOT JUST 'NO BENEFIT' ───────────────────────────────────────────
ok(/AKIKI, IDEAL-ICU and STARRT-AKI/.test(k), "all three timing trials are named…");
ok(/deferral avoids dialysis altogether in roughly 40%/.test(k), "…with the avoided-dialysis figure");
ok(/10\.4% with the accelerated strategy vs\s+6\.0% with standard \(RR 1\.74, 95% CI 1\.24-2\.43\)/.test(k),
   "STARRT-AKI's dependence harm is present with both rates and the RR — the concrete cost of starting early");
ok(/90-day mortality was identical \(43\.9% vs 43\.7%\)/.test(k),
   "…beside the flat mortality, so the contrast is visible rather than asserted");
ok(/'No mortality benefit' understates what accelerated\s+initiation costs/.test(k),
   "…and the entry says why the usual phrasing is not enough");

// ── URGENT INDICATIONS, WHICH NO TIMING TRIAL RANDOMISED ───────────────────────────────────────────
// Added 2026-08-21. The timing section read as though "when to start dialysis" were one question. It is
// two, and the trials only answer the second: every one of them EXCLUDED the patient with an urgent
// indication. A resident who takes "deferral avoids dialysis in 40%" to the bedside of a patient with a
// pH of 7.05 has misread all of them, and the entry did not say so.
ok(/AEIOU/.test(k) && /Acidosis, Electrolytes \(refractory hyperkalaemia\), Intoxications/.test(k),
   "the urgent-indication list is present…");
ok(/Uraemic complications \(pericarditis, encephalopathy, bleeding\)/.test(k),
   "…including what uraemic actually means here, rather than a bare U");
ok(/each qualified by REFRACTORY\s+TO MEDICAL THERAPY/.test(k),
   "…every one qualified as refractory, which is the word that keeps it from being a lab-value trigger");
ok(/applies only to the patient who has NO urgent indication/.test(k),
   "…and the timing trials are explicitly scoped to patients without one");
ok(/pH of 7\.05 is a misreading of all of them/.test(k),
   "…with the bedside misreading named, since that is how the trials get misapplied");
ok(/lithium, toxic alcohols \(ethylene glycol, methanol\), metformin, salicylate/.test(k),
   "and the dialysable toxins are listed as an indication independent of AKI");

// ── THE FLOOR UNDER WATCHFUL WAITING ───────────────────────────────────────────────────────────────
// The entry taught deferral without a floor, which reads as "later is always safer". AKIKI-2 is where
// that stops being true — and the arms are easy to invert, which the review that prompted this did.
ok(/BUT THERE IS A FLOOR TO WATCHFUL WAITING/.test(k), "deferral is bounded, not open-ended…");
ok(/DELAYED arm started RRT once BUN exceeded 112 mg\/dL or oliguria\/anuria had persisted beyond 72\s+hours/.test(k),
   "…with the delayed arm's actual trigger…");
ok(/MORE-DELAYED arm waited further, until BUN reached 140 mg\/dL/.test(k), "…and the more-delayed arm's…");
ok(/median 10 vs 12,\s+p=0\.93/.test(k), "…the null primary outcome, so waiting longer bought nothing…");
ok(/60-day mortality was 55% vs 44%, unadjusted p=0\.071 but adjusted HR 1\.65 \(95% CI\s+1\.09-2\.50, p=0\.018\)/.test(k),
   "…and the mortality signal with BOTH the unadjusted and adjusted results, since only one is significant");
// THE CORRECTION TO THE REVIEW. It gave "beyond BUN >140 or oliguria >72 h" as the harm threshold, which
// mixes the two arms: 140 is what the more-delayed arm waited FOR.
ok(/the harm accrues beyond BUN 112 \/ oliguria 72 h,\s+which is the DELAYED arm's trigger/.test(k),
   "…and the entry names WHICH number is the floor");
ok(/BUN 140 is what the more-delayed arm waited FOR, not a safe\s+threshold/.test(k),
   "…correcting the inversion in place, where it would otherwise be repeated");

// ── ELAIN: WHY 'EARLY IS DEAD' IS TOO STRONG ───────────────────────────────────────────────────────
ok(/ELAIN was\s+single-centre and predominantly surgical/.test(k),
   "ELAIN carries its design and population BEFORE its result, which is what makes it interpretable");
ok(/39\.3% vs 54\.7%/.test(k), "…with the mortality figures…");
ok(/POPULATION-DEPENDENT rather than as a contradiction to be explained away/.test(k),
   "…and it is framed as population-dependence, not as an outlier to dismiss");

// ── PROGNOSIS: THE SHAPE, WITHOUT THE UNVERIFIED NUMBERS ───────────────────────────────────────────
ok(/THIS ENTRY CARRIES NO EPIDEMIOLOGICAL PERCENTAGES/.test(k), "the epidemiology figures are declared absent…");
// SCOPED, not a bare "25%". The first version of this matched the FILTRATION FRACTION ceiling ("<20-25%")
// three paragraphs earlier and failed on a number that has nothing to do with prognosis. Ninth time this
// session that a loose pattern hit the wrong text; the fix is to match the claim, not the digits.
ok(!/1\.49/.test(k) && !/28-fold/.test(k),
   "…neither the review's hazard ratio nor its 28-fold multiple appears");
ok(!/progress to CKD/i.test(k) && !/AKI-to-CKD conversion (?:rate )?(?:is |of )?~?\d/i.test(k),
   "…and no AKI-to-CKD conversion percentage is stated");
ok(/no AKI-to-CKD conversion\s+rate, no hazard ratio for mild or brief AKI, no multiple for post-dialysis CKD risk/.test(k),
   "…with all three named as absent, so the gap is explicit rather than an oversight");
ok(/survivors carry excess\s+risk of CKD and death even when creatinine returns to normal/.test(k),
   "…while the teachable shape survives: AKI is not a transient insult");
ok(/AT ABOUT 3 MONTHS is\s+the prognostic checkpoint/.test(k),
   "…and the 3-month checkpoint, which is the actionable part of that section");

// ── ANTIMICROBIALS: LOADING vs MAINTENANCE ─────────────────────────────────────────────────────────
ok(/FULL loading dose/.test(k) && /volume of distribution, which CRRT does not change/.test(k),
   "the loading dose is protected, with the Vd reason that makes it non-negotiable");
ok(/most antimicrobials sieve freely/.test(k), "…and maintenance is tied to sieving");
ok(/PK\/PD target chosen affects attainment more than\s+CRRT intensity/.test(k),
   "…with the review's durable point: the target matters more than the intensity");
ok(/therapeutic drug monitoring rather than a nomogram/.test(k),
   "…landing on TDM for narrow-index agents, which is the actionable half");

// ── THE WITHHELD CLAIM STAYS WITHHELD ──────────────────────────────────────────────────────────────
// A mortality threshold is the last kind of number that should enter on a secondhand summary.
ok(!/13 mL\/kg\/h/.test(k) && !/10-15 mL\/kg\/h/.test(k),
   "the unverifiable low-dose figures are ABSENT from the entry");
ok(!/Ketzerei/.test(k), "…and so is the ongoing trial that has not reported");
const queue = readFileSync(new URL("./CORPUS_REVIEW_QUEUE.md", import.meta.url), "utf8");
ok(/CRRT \(reviewed 20 Aug 2026\)/.test(queue), "…and the withholding is recorded in the queue…");
ok(/captcha-blocked/.test(queue) && /Ketzerei/.test(queue),
   "…naming the trial and why it could not be verified, so it can be cleared later rather than lost");

// ── EVERY TRIAL NAMED IS CITABLE ───────────────────────────────────────────────────────────────────
// The prompt tells the model to cite named trials by PMID. Naming one with no verified PMID behind it is
// how the model ends up producing a plausible number from memory — the exact failure this corpus fights.
const trials = G.Nephrology.trials || [];
const idx = JSON.parse(readFileSync(new URL("./landmark_pmids.json", import.meta.url), "utf8")).trials;
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
["RENAL", "ATN", "RICH", "ELAIN", "AKIKI-2", "IDEAL-ICU", "AKIKI", "STARRT-AKI"].forEach(t => {
  ok(trials.includes(t), `${t} is in Nephrology's trial list, so the prompt may cite it`);
  ok(!!idx[norm(t)], `…and ${t} resolves to a verified PMID`);
});
ok(idx[norm("RICH")] && idx[norm("RICH")].pmid === "33095849",
   "RICH resolves to the JAMA 2020 citrate-vs-heparin trial specifically");
// RICH was added by hand today, so its provenance stamp has to exist in the allowlist or the build drops
// it silently — an index without RICH would look exactly like a working build.
const builder = readFileSync(new URL("./rag/build_landmark_index.mjs", import.meta.url), "utf8");
ok(/"manual_2026-08-20"/.test(builder),
   "…under a stamp the builder allows, since an unlisted stamp is skipped SILENTLY");
const src = JSON.parse(readFileSync(new URL("./rag/landmark_trials.json", import.meta.url), "utf8"));
const rich = src.find(t => t && t.name === "RICH");
ok(rich && rich.pmid_verified === "manual_2026-08-20",
   "…and RICH carries that stamp rather than being back-dated into an older verification pass");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ CRRT GROUNDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
