// PE — REPERFUSION HELD OUT OF SCOPE — run: node test_pe_safety.mjs
//
// LAUNCH-FREEZE DECISION, 2026-08-21. The review queue's verdict on this entry was not "incomplete", it
// was "actively misleading": the entry announced the 2026 AHA/ACC A-E categories and then taught
// management on the RETIRED massive/submassive axis — lysis for shock or arrest, watchful monitoring for
// intermediate-high. New taxonomy beside old management logic is worse than either alone, because it
// reads as current. With coworkers about to generate talks, that is a launch blocker.
//
// The 2026 full text has still not been read. So rather than guess at the new reperfusion criteria or
// leave the old ones standing, the entry now REMOVES the reperfusion logic and says so, and instructs the
// talk to point at the guideline rather than fill the gap. An uncited gap is recoverable; a confident
// wrong threshold is not.
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

// ── AND THE GAP IS DECLARED, SO THE MODEL DOES NOT FILL IT ─────────────────────────────────────────
ok(/REPERFUSION IS OUT OF SCOPE FOR THIS ENTRY, DELIBERATELY/.test(k),
   "the omission is stated as deliberate — silence alone would just be re-supplied from memory");
ok(/DO NOT state which clinical category qualifies for systemic thrombolysis/.test(k),
   "…with an explicit instruction not to name a qualifying category…");
ok(/DO NOT give a categorical threshold for who gets lysed/.test(k), "…nor a threshold…");
ok(/DO NOT present catheter-directed therapy as established for the haemodynamically stable patient/.test(k),
   "…nor to promote CDT in the stable patient, which is the over-treatment direction");
ok(/direct the reader to the\s+guideline/.test(k),
   "…and it says what to do instead, so the talk has a landing place rather than a hole");
ok(/An uncited gap is recoverable; a confident wrong threshold is not/.test(k),
   "…with the reasoning recorded, so this is not 'tidied' back into a management paragraph");
// The reason the old text was dangerous, kept so nobody restores it thinking it was merely dated.
ok(/Teaching a new taxonomy beside old management logic is worse\s+than teaching neither/.test(k),
   "…and the specific failure — new taxonomy, old management — is named");

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
ok(/Acute PE — 2026 AHA\/ACC/.test(queue), "the PE section is still in the review queue…");
ok(/2026 AHA\/ACC full text has\s*\n?not been consulted/.test(queue.replace(/\*\*/g, "")),
   "…and still records that the primary document has not been read, which is why this is temporary");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ PE SAFETY OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
