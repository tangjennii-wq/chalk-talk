// ACUTE AND RECURRENT PERICARDITIS — run: node test_pericarditis_grounding.mjs
//
// THE SYMPTOM WAS "only one reference". The cause was not the citation guard misfiring — it was the guard
// working correctly on a starved entry. The pericarditis entry was 221 characters, one sentence about
// myopericarditis, and Cardiovascular's trial list named NO pericarditis trial. The prompt cites
// guidelines and named landmark trials; with nothing verified available, a talk that refuses to invent
// citations can only produce one. ICAP and CORP had verified PMIDs sitting in the index the whole time
// and were simply never listed as citable.
//
// That is a distinct failure class from the ones before it: not corpus-wrong, not corpus-silent, not
// unroutable — CORPUS-STARVED. The entry existed, routed correctly, and had nothing in it.
//
// TWO ADJACENCY TRAPS, both about EPISODE NUMBER:
//   1. Colchicine duration is 3 months for a first episode and 6-12 for a recurrence. "Colchicine 3
//      months" unqualified under-treats the recurrent patient — the precision point the review raised.
//   2. ICAP's numbers are first-episode; RHAPSODY's are colchicine-resistant recurrent disease selected
//      by a withdrawal design. Carry RHAPSODY's 74% placebo recurrence into first-episode counselling and
//      the talk is wildly wrong about prognosis.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const G = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;
const entry = (G.Cardiovascular.guidelines || []).find(x => /^Acute and Recurrent Pericarditis/.test(x.name));
ok(!!entry, "the pericarditis entry exists under a name describing the syndrome, not just myopericarditis");
const k = (entry && entry.keys) || "";

// ── STARVATION IS THE THING BEING FIXED ────────────────────────────────────────────────────────────
ok(k.length > 3000, `the entry is substantive (${k.length} chars, was 221) — the stub could not ground a talk`);
ok(/ONE reference/.test(k) && /citation guard correctly refused/.test(k),
   "…and it records WHY the card had one reference, so the symptom is not misread as a guard bug");
// The other half of the starvation: no citable trial. This is what actually produced the symptom.
const trials = G.Cardiovascular.trials || [];
["ICAP", "CORP", "RHAPSODY"].forEach(t => ok(trials.includes(t), `${t} is listed as citable in Cardiovascular`));
const idx = JSON.parse(readFileSync(new URL("./landmark_pmids.json", import.meta.url), "utf8")).trials;
ok(idx.ICAP && idx.ICAP.pmid === "23992557", "ICAP resolves to its verified PMID…");
ok(idx.CORP && idx.CORP.pmid === "21873705", "…CORP to its own…");
ok(idx.RHAPSODY && idx.RHAPSODY.pmid === "33200890", "…and RHAPSODY to the NEJM rilonacept trial");
const src = JSON.parse(readFileSync(new URL("./rag/landmark_trials.json", import.meta.url), "utf8"));
const rh = src.find(t => t && t.name === "RHAPSODY");
ok(rh && rh.pmid_verified === "manual_2026-08-21",
   "…RHAPSODY carrying today's own verification stamp rather than borrowing an older pass");
const builder = readFileSync(new URL("./rag/build_landmark_index.mjs", import.meta.url), "utf8");
ok(/"manual_2026-08-21"/.test(builder), "…and that stamp is allowlisted, or the build would skip it SILENTLY");

// ── DIAGNOSIS ──────────────────────────────────────────────────────────────────────────────────────
ok(/2 OF 4/.test(k), "the 2-of-4 rule is stated as a rule…");
ok(/trapezius ridge via\s+the phrenic nerve/.test(k),
   "…with the trapezius-ridge referral and its mechanism, which is the near-specific sign");
ok(/triphasic, evanescent, so absence proves nothing/.test(k),
   "…and the rub's evanescence, so a missing rub is not read as excluding the diagnosis");
ok(/DIFFUSE concave ST elevation with PR depression and NO reciprocal change/.test(k),
   "the ECG discriminator carries all three features…");
ok(/REGIONAL convex ST elevation with reciprocal depression of STEMI/.test(k),
   "…against the STEMI pattern it must be told apart from");

// ── FIRST-LINE IS A PAIR, AND THE DURATION DEPENDS ON THE EPISODE ─────────────────────────────────
ok(/high-dose NSAID or aspirin PLUS colchicine/.test(k), "first-line is the pair, not a choice between them");
ok(/0\.5 mg twice daily, 0\.5 mg once daily under 70 kg, and NO loading dose/.test(k),
   "…with colchicine's weight-based dose and the no-loading-dose point");
ok(/3 months for a FIRST\s+episode, 6-12 months for a RECURRENCE/.test(k),
   "THE DURATION SPLIT is explicit — the precision point the review raised");
ok(/'colchicine 3 months' without qualification is\s+under-treating the recurrent patient/.test(k),
   "…and the error it prevents is named, so the qualifier is not trimmed later");
ok(/TAPER BY CRP, NOT BY CALENDAR/.test(k), "tapering is CRP-guided…");
ok(/stopping on a fixed schedule while CRP is still raised invites recurrence/.test(k), "…with the consequence");
ok(/heart rate kept under 100 during\s+recovery/.test(k), "exercise restriction carries a usable number");

// ── THE 2025 CHANGE: IL-1 AHEAD OF STEROIDS ───────────────────────────────────────────────────────
ok(/CORTICOSTEROIDS ARE NO LONGER THE SECOND STEP/.test(k), "the steroid demotion is stated…");
ok(/permit viral\s+persistence and rebound on withdrawal/.test(k) && /MORE recurrence/.test(k),
   "…with the mechanism and the outcome that justify it");
ok(/ANTI-IL-1 THERAPY IS NOW POSITIONED AHEAD OF CORTICOSTEROIDS/.test(k),
   "…and anti-IL-1 is placed ahead of steroids, which is the review's substantive correction");
ok(/not held\s+back for the refractory or multiply-recurrent patient/.test(k),
   "…explicitly not reserved for refractory disease, which is the understatement being corrected");
ok(/Teaching IL-1 blockade as a last resort is the\s+pre-2025 position/.test(k),
   "…and the superseded framing is named so an older deck reads as old");

// ── THE TWO IL-1 AGENTS DIFFER ON LABEL ───────────────────────────────────────────────────────────
ok(/RILONACEPT\s+is FDA-APPROVED for recurrent pericarditis \(18 Mar 2021, adults and children 12 and over\)/.test(k),
   "rilonacept's approval is bound to rilonacept, with its date and age limit");
ok(/ANAKINRA is\s+used OFF-LABEL for this indication/.test(k), "…and anakinra is marked off-label…");
ok(/rheumatoid arthritis, NOMID and DIRA/.test(k), "…with what it IS approved for, so the claim is checkable");
ok(/Both are reasonable clinically; only one carries the indication/.test(k),
   "…and the distinction is framed so it does not read as 'anakinra is wrong'");

// ── TRIALS BOUND TO THEIR POPULATIONS ─────────────────────────────────────────────────────────────
ok(/ICAP \(PMID 23992557\) studied a FIRST episode/.test(k), "ICAP is bound to first-episode disease…");
ok(/16\.7% with colchicine vs\s+37\.5% without/.test(k) && /NNT roughly 5/.test(k), "…with both arms and the NNT");
ok(/CORP \(PMID 21873705\) is the\s+recurrent-disease counterpart/.test(k), "CORP is placed in recurrent disease…");
ok(/CORP-2 addressed multiple recurrences/.test(k), "…and CORP-2 in multiple recurrences");
ok(/randomised-WITHDRAWAL trial of rilonacept in\s+colchicine-resistant or steroid-dependent RECURRENT pericarditis/.test(k),
   "RHAPSODY carries its DESIGN and its selected population, not just its effect size");
ok(/61 randomised, recurrence 7% vs 74%/.test(k) && /hazard ratio 0\.04 \(95% CI 0\.01-0\.18, P<0\.001\)/.test(k),
   "…with the result in full");
ok(/Do not carry ICAP's first-episode numbers into a\s+recurrent-disease slide/.test(k),
   "…and the first trap is blocked in words");
ok(/RHAPSODY\s+enrolled patients selected for having already failed colchicine, which is what makes 74% plausible/.test(k),
   "…and the second is explained, not just forbidden — the 74% is a fact about the enrolment");
ok(/this entry gives no numbers for it/.test(k),
   "AIRTRIP is named without figures, since its numbers came only from the review");
ok(!/18% vs 90%/.test(k), "…and those unverified figures are ABSENT");
ok(/CITE ICAP, CORP AND RHAPSODY BY IDENTIFIER; name CORP-2 and AIRTRIP in prose without one/.test(k),
   "and the entry says which trials may be cited, so the two without identifiers cannot invite invented ones");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ PERICARDITIS GROUNDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
