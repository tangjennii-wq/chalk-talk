// GFR PHYSIOLOGY / CKD BACKBONE GROUNDING — run: node test_gfr_grounding.mjs
//
// The entry read: "RASi + SGLT2i + finerenone backbone for proteinuric CKD (DAPA-CKD, EMPA-KIDNEY,
// FIDELIO/FIGARO)."
//
// Every word true. Three drugs and three trial groups in one breath with NO MAPPING between them, and
// zero occurrences of "non-diabetic" anywhere in Nephrology. So a card credited finerenone with the
// non-diabetic evidence that belongs to the SGLT2i trials.
//
// This is the third ADJACENCY failure today — after ELITE-Symphony (basiliximab beside a trial that used
// daclizumab) and lupus nephritis (two of three regimens listed, implying the third was an alternative).
// A correct entry can still teach a false thing through its structure, and reading the entry does not
// reveal it. The fix is always the same: make the mapping explicit rather than adjacent.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const G = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;
const k = (G.Nephrology.guidelines || []).find(x => /2024 CKD Evaluation/.test(x.name)).keys;

// ── drug → population → trials, explicitly ──────────────────────────────────────────────────────────
ok(!/finerenone backbone for proteinuric CKD \(DAPA-CKD, EMPA-KIDNEY, FIDELIO\/FIGARO\)/.test(k),
   "the undifferentiated drug+trial list is GONE from the source sentence");
ok(/MAP EACH DRUG TO ITS OWN POPULATION AND TRIALS/.test(k), "…replaced by an explicit mapping instruction");
ok(/DAPA-CKD and EMPA-KIDNEY enrolled CKD populations including\s+NON-DIABETIC kidney disease/.test(k),
   "SGLT2i is tied to its own trials AND to the non-diabetic population");
ok(/FIDELIO-DKD and FIGARO-DKD evidence is DIABETIC kidney disease/.test(k),
   "finerenone is tied to diabetic kidney disease…");
ok(/Do not attribute\s+non-diabetic CKD benefit to finerenone/.test(k),
   "…and the specific misattribution is named so it cannot recur");
// The entry should say WHY it now spells this out — the next editor may otherwise "tidy" it back.
ok(/three drugs and three trial groups in one breath with no mapping between them/.test(k),
   "…with the reason recorded, so the list is not re-compressed later");

// ── the tubular/TGF mechanism, which links hyperfiltration to why SGLT2i work ───────────────────────
ok(/TUBULAR, not purely haemodynamic/.test(k), "the tubular hypothesis is named as the dominant explanation…");
ok(/LESS NaCl to the macula densa/.test(k) && /DILATES the afferent arteriole/.test(k),
   "…with the actual mechanism, not just the label");
ok(/restores distal sodium delivery, restores tubuloglomerular\s+feedback/.test(k),
   "…and the SGLT2i step that closes the loop");
ok(/alongside the\s+afferent\/efferent picture rather than instead of it/.test(k),
   "…framed as an addition to the classic picture, not a replacement");

// ── the triple whammy has THREE hits ────────────────────────────────────────────────────────────────
ok(/ACEi or ARB\s+PLUS a diuretic PLUS an NSAID/.test(k), "all three agents are named…");
ok(/Volume depletion from the diuretic/.test(k), "…including the volume hit the card omitted");
ok(/a talk that names two has named the wrong number/.test(k), "…and the omission is called out explicitly");

// ── numbers withheld ────────────────────────────────────────────────────────────────────────────────
ok(/APPROXIMATE AND MODEL-DEPENDENT/.test(k), "glomerular pressure figures are marked approximate…");
ok(/No figure is stated here/.test(k), "…and none is supplied");
ok(!/\d+\s*(?:-\s*\d+\s*)?mmHg/.test(k), "…so no mmHg value appears anywhere in the entry");
ok(/Present ERAs as\s+emerging and do not attach an outcome figure to them/.test(k),
   "endothelin receptor antagonists are marked emerging, with no outcome figure attached");

// ── what was already right stays right ──────────────────────────────────────────────────────────────
ok(/GLP-1 RA is separately established here via FLOW/.test(k), "GLP-1 RA keeps its FLOW grounding");
ok(/RASi: the long-standing proteinuric-CKD backbone/.test(k), "…and RASi keeps its place as the backbone");

// The trials named must actually be retrievable, or the mapping is prose the model cannot check.
const trials = JSON.parse(readFileSync(new URL("./landmark_pmids.json", import.meta.url), "utf8")).trials;
for (const t of ["EMPAKIDNEY", "DAPACKD", "FIDELIODKD"])
  ok(!!trials[t] && /^\d{6,9}$/.test(trials[t].pmid), `${t} resolves to a PMID in the landmark index`);

ok(!/\bnot\b[^.;]{0,32}?\bverified\b/i.test(k) && !/\bunverified\b/i.test(k),
   "the entry asserts nothing it admits it has not checked");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ GFR / CKD BACKBONE OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
