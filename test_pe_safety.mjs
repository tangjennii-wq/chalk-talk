// PE — REPERFUSION HELD OUT OF SCOPE — run: node test_pe_safety.mjs
//
// RESOLVED 2026-08-21, after a first pass that only CONTAINED the problem. The review queue's verdict was not "incomplete", it
// was "actively misleading": the entry announced the 2026 AHA/ACC A-E categories and then taught
// management on the RETIRED massive/submassive axis — lysis for shock or arrest, watchful monitoring for
// intermediate-high. New taxonomy beside old management logic is worse than either alone, because it
// reads as current. With coworkers about to generate talks, that is a launch blocker.
//
// The first fix removed the reperfusion logic and declared the gap. This one fills it: the categories are
// defined and reperfusion is anchored to them (E1 Class 2a, D1-D2 Class 2b, A-C1 Class 3), verified
// against two independent summaries that agree. ONE item stays open — where C2/C3 sit, on which the two
// sources disagree — and it is bounded in the entry rather than averaged into a number.
//
// Two things WERE fixed rather than withheld, because they are not claims from the unread document:
//   · the reduced DOAC doses, checked against the ELIQUIS and XARELTO labels — which corrected the
//     review itself, since both labels say at least SIX months, not "3-6 months";
//   · the "30% at 5 years" recurrence figure, which is simply not in the corpus.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const G = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;
const get = (sp) => (G[sp].guidelines || []).find(x => /Acute Pulmonary Embolism/i.test(x.name));

// ── THE TWO COPIES MUST BE IDENTICAL ───────────────────────────────────────────────────────────────
// This entry is duplicated verbatim into Cardiovascular and Pulmonary. Fixing one and missing the other
// is the obvious way this regresses, and the specialty a PE topic routes to is not obvious in advance.
const cv = get("Cardiovascular"), pu = get("Pulmonary");
ok(!!cv && !!pu, "the PE entry exists in BOTH Cardiovascular and Pulmonary");
ok(cv && pu && cv.keys === pu.keys,
   "…and the two copies are byte-identical, so a fix cannot land in one specialty and miss the other");
const k = (cv && cv.keys) || "";

// ── THE RETIRED MANAGEMENT AXIS IS GONE, NOT ANNOTATED ─────────────────────────────────────────────
// The queue was explicit: replace, do not annotate. An entry asserting both the old logic and its
// correction leaves the model to choose, and it chooses the confident sentence.
ok(!/High-risk \(shock or arrest\): systemic thrombolysis/.test(k),
   "the shock/arrest reperfusion rule is REMOVED, not left standing beside a caveat");
ok(!/Intermediate-high: monitor 48-72h with rescue lysis/.test(k),
   "…and so is the intermediate-high monitoring rule that went with it");
ok(!/alteplase 100mg over 2h/.test(k),
   "…and the lysis dose, which without an indication is a recipe with no patient attached");
ok(!/catheter-directed thrombolysis evolving/.test(k),
   "…and the 'evolving' hand-wave that stood in for the CDT evidence");

// ── THE CATEGORIES NOW CARRY THEIR DEFINITIONS ────────────────────────────────────────────────────
// Naming A-E without defining them was half the original problem: the talk announced a taxonomy it could
// not apply, so it fell back on the vocabulary it did know.
ok(/A = asymptomatic, incidentally detected PE/.test(k), "A is defined…");
ok(/PESI <=85, sPESI 0, Bova <=4/.test(k), "…B by its actual severity-score cut-offs…");
ok(/PESI >85, sPESI >=1, Bova >4/.test(k), "…C by the other side of them…");
ok(/D1 transient hypotension or syncope/.test(k) && /D2 normotensive shock/.test(k),
   "…and D by its two subcategories");
ok(/hypoperfusion WITHOUT a low blood\s+pressure/.test(k),
   "…with normotensive shock spelled out, since that is the phrase people mis-hear as 'not shocked'");
ok(/E1 cardiogenic shock/.test(k) && /E2 refractory shock or cardiac arrest/.test(k), "…and E by its two");

// ── REPERFUSION ANCHORS TO THE CATEGORIES ─────────────────────────────────────────────────────────
// This is the correction. The old entry gated reperfusion on shock or arrest, which is the massive/
// submassive axis wearing new labels; the guideline moved the anchor up to D.
ok(/E1 carries a Class 2a recommendation for reperfusion/.test(k), "E1 carries its class…");
ok(/D1-D2 carry Class 2b/.test(k), "…D1-D2 theirs…");
ok(/Low-risk disease \(A through C1\) is Class 3, NOT recommended/.test(k), "…and low-risk its Class 3");
ok(/normotensive shock and transient hypotension are inside the reperfusion conversation/.test(k),
   "…and the clinical consequence is stated: D is in the conversation");
ok(/the old\s+massive\/submassive framing excluded by definition: it waited for sustained hypotension or arrest/.test(k),
   "…against what the old framing did, so the change is legible rather than a swapped label");
ok(/systemic thrombolysis, catheter-directed\s+thrombolysis, mechanical thrombectomy or surgical embolectomy/.test(k),
   "…and the modalities the recommendation covers are listed, not left as 'reperfusion'");
ok(/mechanical thrombectomy may be preferred over systemic lysis in\s+D1-E1/.test(k)
   && /superiority is unproven/.test(k),
   "…with the bleeding-risk nuance AND the honesty that superiority is unproven");

// ── THE ONE THING STILL UNSETTLED IS BOUNDED, NOT GUESSED ─────────────────────────────────────────
// Two summaries disagree on where C2/C3 sit. That is a real disagreement, so the entry marks the band
// rather than picking a side — and it specifically refuses the review's C2-3 claim, which is the one
// item of the six that could not be confirmed.
ok(/THE C BAND IS THE PART THIS ENTRY DOES NOT SETTLE/.test(k),
   "the unsettled band is named explicitly rather than silently averaged");
ok(/one places C3 alongside D at Class 2b, another puts only A-C1 in the\s+not-recommended band/.test(k),
   "…with both readings given, so the disagreement is visible");
ok(/for C2-C3 say the\s+decision is individualised and points to the guideline rather than naming a class/.test(k),
   "…and the instruction is to individualise rather than invent a class");
ok(/Do not state that\s+catheter-directed therapy is recommended against in stable C2-3/.test(k),
   "…and the review's unconfirmed C2-3 claim is refused by name");

// ── CDT: HAEMODYNAMIC EFFECT ESTABLISHED, MORTALITY EFFECT NOT ────────────────────────────────────
ok(/ULTIMA remains the completed randomised evidence/.test(k), "ULTIMA is named as the randomised evidence…");
ok(/faster\s+RV\/LV ratio improvement at 24 hours and NO mortality difference/.test(k),
   "…with both halves of its result, since the second is the one that gets dropped");
ok(/PE-TRACT is ongoing\s+and has not reported/.test(k), "…and PE-TRACT is marked as not yet reporting");
ok(/hypothesis-generating, not a comparison anyone has randomised/.test(k),
   "…and the observational data is labelled for what it is");
ok(/option whose haemodynamic effect is established and whose mortality effect is not/.test(k),
   "…landing on a phrasing a talk can actually use");

// ── RV FAILURE: THE PHYSIOLOGY, WITHOUT THE UNVERIFIED NUMBER ─────────────────────────────────────
ok(/large fluid boluses\s+worsen it/.test(k) && /bowing the septum leftwards/.test(k),
   "the volume trap is explained by mechanism, not asserted as a rule");
ok(/Start noradrenaline early to keep coronary perfusion to the RV/.test(k), "…with the pressor rationale…");
ok(!/500 mL/.test(k),
   "…and the review's 500 mL figure is ABSENT, since it was not traced to the guideline");
ok(/a small cautious challenge\s+is reasonable only when the RV is clearly not congested/.test(k),
   "…while the qualitative version of that point survives");

// ── WHAT REMAINS IN SCOPE IS STILL THERE ───────────────────────────────────────────────────────────
// Holding reperfusion out must not gut the entry; taxonomy, diagnosis and anticoagulation are verified.
ok(/ACUTE PE CLINICAL CATEGORIES A through E/.test(k) && /RETIRES the massive \/ submassive vocabulary/.test(k),
   "the A-E taxonomy survives — that part was never in doubt");
ok(/ESC 2019 has NOT been re-issued/.test(k) && /say which taxonomy you are teaching/.test(k),
   "…and so does the ESC/US split, with the instruction to name which one is being taught");
ok(/RISK STRATIFICATION: hemodynamics, sPESI, RV dysfunction/.test(k), "risk stratification survives…");
ok(/YEARS algorithm/.test(k), "…and the diagnostic algorithm…");
ok(/Anticoagulate at least 3 months/.test(k), "…and the minimum duration");
ok(/sPESI 0\) may be managed as an\s+outpatient on a DOAC \(HoT-PE\)/.test(k),
   "…and outpatient management of low-risk PE, which is a positive recommendation, not a reperfusion one");

// ── THE DOSING FIX: FULL DOSE FIRST, AND THE PREREQUISITE IS ATTACHED ──────────────────────────────
ok(/apixaban 2\.5 mg twice daily|2\.5 mg twice-daily/.test(k), "the apixaban extended-phase dose is present…");
ok(/AFTER AT LEAST 6 MONTHS of\s+treatment/.test(k), "…with its prerequisite in the same sentence…");
ok(/10 mg twice daily for 7 days, then 5 mg\s+twice daily/.test(k),
   "…and the full treatment dose that must precede it, so the reduced dose cannot read as a start");
ok(/15 mg twice daily for 21 days, then 20 mg daily/.test(k), "…same for rivaroxaban's treatment phase…");
ok(/10 mg daily dose likewise\s+applies after at least 6 months/.test(k), "…and its extended-phase prerequisite");
ok(/the threshold is SIX months on both\s+labels, not the 3-6 months often quoted/.test(k),
   "…and the review's own 3-6 month figure is corrected in place, since that is where it would be repeated");
ok(/FDA labelling, checked 21 Aug 2026/.test(k),
   "…with provenance, because this is the one claim here taken from a primary source rather than withheld");
ok(/dabigatran and edoxaban need a parenteral lead-in/.test(k), "the lead-in distinction survives");

// ── THE WITHHELD RECURRENCE FIGURES STAY WITHHELD ──────────────────────────────────────────────────
// QUOTING THE WRONG NUMBER TO EXPLAIN THAT IT IS WRONG STILL PUTS THE NUMBER IN THE CORPUS. The first
// draft of this entry did exactly that, and this assertion caught it — the same trap as the withdrawn
// irAE doses earlier in the month. The entry describes the error without reproducing it.
ok(!/30% at 5 years/.test(k), "the wrong five-year figure is not reproduced, even to disown it…");
ok(/came from nowhere in this corpus/.test(k), "…the error is described rather than quoted");
ok(!/36% at 10 y/.test(k) && !/30-40%/.test(k), "…and so are the review's unverified replacements");
ok(/carries NO recurrence percentages/.test(k), "…with the absence declared…");
ok(/give a number only from a source in front of you/.test(k),
   "…and the instruction that follows, so the gap is not filled from memory");
ok(/keeps accruing for years and is what drives the indefinite-anticoagulation\s+decision/.test(k),
   "…while the teachable SHAPE is kept, which is what the number was there to support");

// ── THE QUEUE STILL RECORDS THE UNREAD DOCUMENT ────────────────────────────────────────────────────
const queue = readFileSync(new URL("./CORPUS_REVIEW_QUEUE.md", import.meta.url), "utf8");
ok(/Acute PE — 2026 AHA\/ACC \(RESOLVED 21 Aug 2026, one item still open\)/.test(queue),
   "the queue records PE as resolved-with-one-open rather than withheld in full…");
ok(/STILL OPEN — the one unresolved item/.test(queue),
   "…and records the C-band as the single item still open, rather than marking PE done");
ok(/read the recommendation table in the \*Circulation\* full text/.test(queue),
   "…with the specific thing to read to clear it");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ PE SAFETY OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
