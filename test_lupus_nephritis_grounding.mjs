// LUPUS NEPHRITIS GROUNDING — run: node test_lupus_nephritis_grounding.mjs
//
// The entry listed TWO triple-therapy regimens for class III/IV. ACR gives THREE. The missing one is
// low-dose cyclophosphamide PLUS belimumab — so a talk, reaching for Euro-Lupus low-dose
// cyclophosphamide, presented it as a STANDALONE alternative TO triple therapy. It is not an
// alternative to triple therapy; it is one of the three triple regimens.
//
// That is an omission producing a wrong FRAME rather than a wrong fact: everything the entry said was
// true, and the shape it implied was wrong. Same species as the ELITE-Symphony adjacency bug.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const G = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;
const e = (G.Rheumatology.guidelines || []).find(x => /ACR 2025 SLE/.test(x.name));
ok(!!e, "the ACR SLE entry exists");
const k = e.keys;

// ── all THREE regimens, and the count said out loud ─────────────────────────────────────────────────
ok(/THREE regimens, not two/.test(k), "the entry says there are three regimens, not two");
ok(/mycophenolate plus belimumab/.test(k), "…regimen 1: mycophenolate plus belimumab");
ok(/mycophenolate plus a calcineurin inhibitor/.test(k), "…regimen 2: mycophenolate plus a CNI");
ok(/LOW-DOSE\s+CYCLOPHOSPHAMIDE PLUS BELIMUMAB/.test(k), "…regimen 3: low-dose cyclophosphamide PLUS belimumab");

// The frame is the correction, so the frame is asserted.
ok(/It is not an\s+alternative to triple therapy - it is one of the three triple regimens/.test(k),
   "…and that cyclophosphamide is not an ALTERNATIVE to triple therapy but one OF the three");
ok(/keep it, and pair it with belimumab/.test(k),
   "…while keeping the crescents / rapid-GFR-decline / adherence reasoning, which was sound");

// ── class V: stated as triple, so the steroid is not silently dropped ───────────────────────────────
ok(/GLUCOCORTICOID plus mycophenolate plus a calcineurin\s+inhibitor/.test(k),
   "pure class V carries all three components including the glucocorticoid");
ok(/describing it as MMF plus CNI silently drops the steroid/.test(k),
   "…and the entry says why 'MMF + CNI' is the wrong way to say it");

// ── the year, and which document it belongs to ──────────────────────────────────────────────────────
// The entry is NAMED for the SLE guideline; lupus nephritis is a separate ACR document from 2024.
ok(/ACR 2024 Lupus Nephritis guideline, its first\s+since 2012/.test(k),
   "the lupus nephritis guideline is dated 2024 and identified as a separate document");
ok(/do not cite the SLE year for a nephritis\s+recommendation/.test(k),
   "…so the entry name cannot be used as the citation year for a nephritis claim");

// ── what was NOT verified stays out, and is marked as not-from-here ─────────────────────────────────
ok(/not stated in the guideline summary - do not assert it/.test(k),
   "the mycophenolate-after-cyclophosphamide substitution is refused, not assumed");
ok(/no eGFR, blood-pressure or chronicity rule for preferring belimumab over\s+a calcineurin inhibitor is recorded here/.test(k),
   "the belimumab-over-CNI decision rule is absent AND flagged as absent");
ok(!/165\/105/.test(k) && !/eGFR ≤45/.test(k) && !/0\.3-8\.4/.test(k),
   "…and none of the unverified thresholds or effect sizes appear anywhere in the entry");
ok(/Voclosporin is A calcineurin inhibitor option \(AURORA-1\), not the only one/.test(k),
   "voclosporin is scoped as one CNI option, not as the class");
ok(/do not quote thresholds from memory/.test(k),
   "…with its monitoring thresholds explicitly out of scope rather than invented");

// ── provenance, and the standing no-hedged-actionables rule ─────────────────────────────────────────
ok(/read in the ACR guideline summary on 19 Aug 2026/.test(k), "the entry records what was read, and when");
ok(!/\bnot\b[^.;]{0,32}?\bverified\b/i.test(k) && !/\bunverified\b/i.test(k),
   "the entry asserts nothing it admits it has not checked");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ LUPUS NEPHRITIS GROUNDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
