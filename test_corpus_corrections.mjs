// CORPUS GROUND-TRUTH GUARD — run: node test_corpus_corrections.mjs
//
// guidelines.json is read by the model as AUTHORITATIVE CONTEXT. That makes two things true, and this
// suite exists for both:
//
//   1. UNCERTAINTY PROSE DOES NOT NEUTRALISE AN INSTRUCTION. A sentence that says "reperfusion is
//      reasonable in category E1" teaches that, whatever caveat trails it. So an unverified clinical
//      actionable may not be in the file AT ALL — it waits in CORPUS_REVIEW_QUEUE.md. An earlier version
//      of this suite asserted that the PE entry ADVERTISED its claims as unverified, which protected the
//      hedge rather than the reader. That assertion is gone; its inverse is below.
//
//   2. A CORRECTION IS APPLIED, NOT APPENDED. Appending "actually that is wrong" to the end of a 7,000
//      character entry leaves the model holding both claims. Every negative assertion here is old wording
//      that must be ABSENT, not new wording that must be present.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };

const raw = readFileSync(new URL("./guidelines.json", import.meta.url), "utf8");
const G = JSON.parse(raw).specialties;
const find = (spec, re) => (G[spec].guidelines || []).find(e => re.test(e.name || ""));
const dka = find("Endocrinology", /Hyperglycemic Crises/i).keys;

// ── GUARD 1: nothing anywhere in the corpus asserts an actionable it admits it has not checked ──────
// Applies to all 181 entries, not just the ones edited today. Deliberately NOT matching a bare
// "unconfirmed" used to WITHHOLD a claim — the AASM entry marks a reaffirmation YEAR unconfirmed and
// then says which document is current. Withholding is correct; asserting-and-hedging is the defect.
// Matched by REGEX, not by substring. The first version listed exact phrases and a mutation reading
// "this has NOT BEEN independently verified" walked straight past it — one intervening word defeated the
// whole guard. A guard that only catches the phrasing its author happened to use is not a guard.
const HEDGE_RES = [
  // A BOUNDED GAP, not an enumeration of adverbs. Listing "independently|externally|fully" was defeated
  // by "not YET fully verified" — one unlisted word. This matches "not" and "verified" inside the same
  // clause whatever sits between them, which is the shape of the claim regardless of phrasing.
  /\bnot\b[^.;]{0,32}?\bverified\b/i,
  /\bunverified\b/i,
  /\b(?:could|can)\s*not\s+be\s+verified\b/i,
  /\bnot\s+(?:been\s+)?(?:reachable|checked|confirmed)\b/i,
  /\brecorded\s+here\s+unconfirmed\b/i,
  /\btreat\s+the\s+direction\s+as\s+sound\b/i,
  /\brelayed\s+from\b/i,
  /\bverify\s+before\s+teaching\b/i,
  /\bpending\s+(?:review|verification)\b/i,
];

// ONE reviewed exception, named. The AASM entry says a 2024 REAFFIRMATION could not be verified and then
// states which document is actually current — it WITHHOLDS a status claim rather than asserting clinical
// advice behind a caveat. That is the correct behaviour, so it is allowlisted explicitly rather than by a
// loophole in the pattern. Any other hedge, anywhere in the 181 entries, fails here and gets reviewed.
const HEDGE_ALLOWED = new Set(["AASM OSA Diagnostic Testing 2017 (+ AASM inpatient OSA 2025)"]);

const hedged = [];
for (const [sname, sv] of Object.entries(G))
  for (const e of (sv.guidelines || [])) {
    if (HEDGE_ALLOWED.has(e.name)) continue;
    for (const re of HEDGE_RES)
      if (re.test(e.keys || "")) { hedged.push(`${sname}/${e.name} :: ${(e.keys.match(re) || [""])[0]}`); break; }
  }
ok(hedged.length === 0,
   `no entry asserts a clinical claim while marking it unverified (${hedged.length} found${hedged.length ? ": " + hedged[0] : ""})`);

// The allowlist must stay a list of REVIEWED exceptions, not a dumping ground.
ok(HEDGE_ALLOWED.size === 1, `exactly one reviewed hedge exception (found ${HEDGE_ALLOWED.size})`);
ok([...HEDGE_ALLOWED].every(nm => Object.values(G).some(sv => (sv.guidelines || []).some(e => e.name === nm))),
   "…and every allowlisted entry still exists, so the list cannot rot into a stale bypass");

// ── GUARD 2: PE is WITHHELD IN FULL, and the queue says why ────────────────────────────────────────
// Not one of the six PE claims was checked against the 2026 AHA/ACC text, so none is in the corpus.
for (const s of ["Cardiovascular", "Pulmonary"]) {
  const pe = find(s, /Pulmonary Embolism/i).keys;
  ok(!/E1 \(reasonable\)|D1-2 \(may be considered\)/.test(pe),
     `${s}: unverified reperfusion categories are NOT in the corpus`);
  ok(!/DOES NOT RECOMMEND CDT/.test(pe), `${s}: unverified CDT recommendation is NOT in the corpus`);
  ok(!/30-40 percent/.test(pe), `${s}: unverified recurrence figures are NOT in the corpus`);
  ok(!/2\.5 mg twice daily|10 mg daily/.test(pe), `${s}: unverified extended-phase dosing is NOT in the corpus`);
  ok(!/500 mL/.test(pe), `${s}: unverified RV fluid volume is NOT in the corpus`);
  ok(!/REVIEW CORRECTIONS/.test(pe), `${s}: no appended review block`);
}
ok(find("Cardiovascular", /Pulmonary Embolism/i).keys === find("Pulmonary", /Pulmonary Embolism/i).keys,
   "the two PE copies are byte-identical — one guideline filed twice, so a fix can never miss one");

const queue = readFileSync(new URL("./CORPUS_REVIEW_QUEUE.md", import.meta.url), "utf8");
ok(/WITHHELD IN FULL/.test(queue) && /2026 AHA\/ACC/.test(queue),
   "…and the withheld PE claims are recorded in CORPUS_REVIEW_QUEUE.md rather than lost");
ok(/must be REPLACED, not annotated/.test(queue),
   "…with the instruction that clearing them means editing the old management text IN PLACE");

// ── DKA: only what was checked against the consensus full text ──────────────────────────────────────
// 1. Fluids — corrected AT SOURCE. The negative is the assertion that matters.
ok(!/are now favoured \(faster resolution, shorter stay\)/.test(dka),
   "DKA: the 'balanced crystalloids are now favoured' overstatement is gone from the source sentence…");
ok(/Either is acceptable and the choice is determined by local availability, cost and resources/.test(dka),
   "…replaced in place by what the consensus actually says");

// 2. Overlap — the VERIFIED figure, and ONLY it.
ok(/continue the i\.v\. insulin infusion for 1-2 h AFTER subcutaneous insulin/.test(dka),
   "DKA: the consensus-verified 1-2 h overlap is stated…");
// Scoped to the transition sentence. A bare /2-4 h/ over the whole entry matched the FLUID RATE window
// ("500-1000 mL/h for the first 2-4 h") — a real, verified, pre-existing figure. Blunt negatives fail on
// correct content, which is how a guard stops being trusted.
const trans = dka.slice(dka.indexOf("TRANSITION OFF THE INFUSION"),
                        dka.indexOf("TRANSITION OFF THE INFUSION") + 400);
ok(trans.length > 100, "sanity: the transition sentence was located");
ok(!/2-4 h/.test(trans),
   "…and the unreachable ADA-2026 2-4 h overlap is ABSENT from it, not present-with-a-caveat");
ok(!/Standards of Care 2026 section 16|Standards of Care 2026 §16/.test(dka),
   "…and the unread 2026 Standards are not cited as a source for an overlap window");

// 3. Severity — attributed, and with NO unverified numbers.
const sev = dka.slice(dka.indexOf("SEVERITY"), dka.indexOf("SEVERITY") + 420);
ok(/2024 consensus ADULT classification/.test(sev),
   "DKA: severity cutoffs are attributed AT THE POINT THE NUMBERS ARE GIVEN…");
ok(/other bodies grade severity differently/.test(sev),
   "…with a NON-NUMERIC note that other bodies differ");
ok(!/GCS/.test(dka) && !/7\.1/.test(dka) && !/ISPAD/.test(dka),
   "…and no unverified JBDS/ISPAD numeric criteria anywhere in the entry");

// 4. SGLT2i — verified magnitudes; DECLARE excluded by name.
ok(/5-17 times higher/.test(dka) && /2\.46/.test(dka) && /1\.16-5\.21/.test(dka),
   "DKA: the consensus-verified SGLT2i risk figures are present");
ok(/Do NOT quote DECLARE-TIMI 58 event percentages as consensus figures/.test(dka),
   "…and DECLARE-TIMI 58 percentages are excluded by name, so the model stops reaching for them");

// 5. The confirmed pearl, grounded rather than recalled.
ok(/nitroprusside/.test(dka) && /ACETOACETATE/.test(dka),
   "DKA: the urine-ketone principle is in the corpus rather than left to memory");

// 6. PROVENANCE IS RECORDED AS VERIFICATION, NOT AS A DISCLAIMER.
ok(/re-verified 19 Aug 2026 against the consensus full text \(doi 10\.2337\/dci24-0032\)/.test(dka),
   "DKA: the entry records WHAT was verified, against WHICH document, on WHAT date");

// ── Structural: the edits touched what they claimed to touch and nothing else ───────────────────────
const all = Object.values(G);
ok(all.reduce((a, s) => a + (s.guidelines || []).length, 0) === 182,
   "182 guideline entries — 181 plus the new pericardial effusion / tamponade entry");
ok(all.reduce((a, s) => a + (s.trials || []).length, 0) === 219, "still 219 trials");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ CORPUS GUARD OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
