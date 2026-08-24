// MEMBRANOUS NEPHROPATHY GROUNDING — run: node test_membranous_grounding.mjs
//
// The corpus had no membranous entry. The KDIGO Glomerular Diseases entry mentioned MN once, in a list of
// chapters "STILL 2021" — i.e. it recorded that MN had not been updated and said nothing about MN itself.
// So a generated MN card was written from model memory, and the review of one found errors that a corpus
// entry would have prevented.
//
// The load-bearing assertion here is the ADJACENCY GUARD. MENTOR compared rituximab with CYCLOSPORINE.
// The cyclophosphamide comparisons — STARMEN and RI-CYCLO — ran the other way, favouring or matching
// cyclophosphamide. Put "MENTOR showed rituximab superior" next to "cyclophosphamide for high risk" with
// no mapping and the reader composes "rituximab beats cyclophosphamide", which no trial here shows. This
// is the same shape as the finerenone/DAPA-CKD and daclizumab/basiliximab traps.
//
// MENTOR's PMID (31269364) was confirmed by Jenni on 2026-08-21; it was already in the index under a
// pubmed_2026-07 stamp, which retrospectively means the mis-citation seen in a card came from the
// saved-talk audit gate rather than from the index.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const G = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;
const entry = (G.Nephrology.guidelines || []).find(x => /^Membranous Nephropathy/.test(x.name));
ok(!!entry, "the membranous nephropathy entry exists — it did not, which is why the card was memory");
const k = (entry && entry.keys) || "";
ok(/KDIGO 2021/.test(entry ? entry.name : ""), "…named for the guideline it comes from…");
ok(/not superseded by the 2024\/2025 updates/.test(entry ? entry.name : ""),
   "…and says the 2021 chapter still stands, since the sibling entry lists newer KDIGO documents");

// ── ANTIGENS: THE TWO THAT CHANGE MANAGEMENT ───────────────────────────────────────────────────────
ok(/PLA2R is the\s+antigen in roughly 70-80% of primary MN/.test(k), "PLA2R carries its share of primary MN");
ok(/THSD7A/.test(k) && /NELL-1/.test(k) && /EXT1\/EXT2/.test(k) && /contactin-1/.test(k),
   "…alongside the newer antigens, which is what 'antigen-defined' now means");
ok(/NELL-1 is enriched in\s+malignancy-associated MN/.test(k),
   "…with NELL-1 tied to malignancy — an antigen that changes what you screen for");
ok(/contactin-1 in MN with a coexisting inflammatory demyelinating\s+polyneuropathy/.test(k),
   "…and contactin-1 to the neuropathy, the other antigen with a clinical consequence");
ok(/subepithelial immune deposits form\s+in situ/.test(k) && /C5b-9/.test(k),
   "the mechanism is present, so the proteinuria-without-nephritic-sediment picture follows from it");
ok(/malignancy, hepatitis B, lupus \(class V\), NSAIDs/.test(k), "secondary causes are named");

// ── SEROLOGY VS BIOPSY: BOTH ERROR DIRECTIONS ──────────────────────────────────────────────────────
ok(/biopsy is not required\s+to diagnose MN when anti-PLA2R antibody is positive/.test(k),
   "the 2021 change is stated — biopsy is not mandatory in the right setting…");
ok(/kidney function is preserved/.test(k) && /without a secondary cause/.test(k),
   "…with BOTH conditions that narrow it, since the change is easy to over-apply");
ok(/wrong in both\s+directions/.test(k),
   "…and both failure directions are named, which is how this is actually got wrong");
ok(/antibody falls months before\s+proteinuria does/.test(k),
   "immunological remission preceding clinical remission is present…");
ok(/judging a regimen failed at 3 months by proteinuria alone is a common error/.test(k),
   "…with the error it prevents, which is what makes it teachable rather than trivia");

// ── RISK STRATIFICATION: THE FRAMEWORK *AND* ITS NUMBERS ───────────────────────────────────────────
ok(/LOW = normal eGFR with proteinuria <3\.5 g\/d/.test(k), "LOW risk carries its criteria…");
ok(/>50% fall in proteinuria after 6 months of\s+conservative therapy/.test(k),
   "…including the response criterion, which is the half people forget");
ok(/MODERATE = normal eGFR, proteinuria >3\.5 g\/d, and NO >50% fall/.test(k), "MODERATE is defined by non-response…");
ok(/HIGH = eGFR <60 mL\/min\/1\.73m2 and\/or proteinuria >8 g\/d for >6 months/.test(k), "HIGH carries both limbs…");
ok(/serum albumin <2\.5 g\/dL \(25 g\/L\)/.test(k),
   "…with albumin given in BOTH units — the source table prints 2.5 g/l, which is off by ten");
ok(/anti-PLA2R >50 RU\/mL/.test(k) && /selectivity index >0\.20/.test(k),
   "…and the antibody and selectivity thresholds");
ok(/alpha1-microglobulin >40 mcg\/min/.test(k) && /beta2-microglobulin >1 mcg\/min/.test(k) && /IgG >250 mg\/d/.test(k),
   "…and the urinary low-molecular-weight markers, spelled out rather than gestured at");
ok(/VERY HIGH = life-threatening nephrotic syndrome, or rapid unexplained decline/.test(k), "VERY HIGH is defined");

// ── THE OVERTREATMENT ERROR ────────────────────────────────────────────────────────────────────────
ok(/LOW RISK GETS SUPPORTIVE CARE ONLY/.test(k), "low risk is supportive care only…");
ok(/a substantial share remit spontaneously/.test(k), "…with the reason — spontaneous remission…");
ok(/starting immunosuppression at diagnosis on proteinuria\s+alone is the classic overtreatment error/.test(k),
   "…and the error named, since 'nephrotic therefore immunosuppress' is the reflex it corrects");
ok(/CNI is not\s+recommended as monotherapy/.test(k), "and the CNI-monotherapy caveat survives");

// ── THE ADJACENCY TRAP: EVERY TRIAL MAPPED TO ITS OWN COMPARATOR ───────────────────────────────────
ok(/MENTOR compared RITUXIMAB WITH CYCLOSPORINE, not with cyclophosphamide/.test(k),
   "MENTOR's comparator is stated AND the wrong one is denied in the same breath");
ok(/60% vs 52% at 12 months/.test(k) && /60% vs 20% at 24 months/.test(k),
   "…with both timepoints, since the 12-month result is non-inferiority and the 24-month one is the story");
ok(/MAINTAINING remission after the drug stops/.test(k),
   "…and what the 24-month gap actually means, rather than a bare 'superior'");
ok(/STARMEN[\s\S]{0,120}FAVOURED\s+cyclophosphamide/.test(k), "STARMEN is mapped to its own comparator and result…");
ok(/84% vs 58% remission at 24 months/.test(k), "…with its numbers…");
ok(/RI-CYCLO compared rituximab with the cyclical\s+regimen and found NO significant difference/.test(k),
   "…and RI-CYCLO with its own");
ok(/'rituximab is superior' is true only against cyclosporine/.test(k),
   "…and the composed false claim is stated and blocked explicitly");
ok(/no trial here shows/.test(k),
   "…naming what the adjacency would teach, which is the part a later editor must not tidy away");

// ── CITABILITY: ONLY WHAT RESOLVES ─────────────────────────────────────────────────────────────────
// The prompt tells the model to cite named trials by PMID. Naming three and having one identifier is how
// the other two get invented, so the entry says which may be cited.
ok(/CITE MENTOR BY IDENTIFIER; name STARMEN\s+and RI-CYCLO in prose without one/.test(k),
   "the entry says which trial may be cited and which may not");
const idx = JSON.parse(readFileSync(new URL("./landmark_pmids.json", import.meta.url), "utf8")).trials;
ok(idx.MENTOR && idx.MENTOR.pmid === "31269364",
   "MENTOR resolves to PMID 31269364 — the PMID Jenni confirmed on 2026-08-21");
ok((G.Nephrology.trials || []).includes("MENTOR"), "…and MENTOR is in Nephrology's trial list, so it is citable");
ok(!(G.Nephrology.trials || []).includes("STARMEN") && !(G.Nephrology.trials || []).includes("RI-CYCLO"),
   "…while STARMEN and RI-CYCLO are NOT in the trial list, so the prompt never asks for an identifier they lack");
const src = JSON.parse(readFileSync(new URL("./rag/landmark_trials.json", import.meta.url), "utf8"));
const mentor = src.find(t => t && t.name === "MENTOR");
ok(mentor && /Membranous Nephropathy/i.test(mentor.full || ""),
   "…and the indexed MENTOR is the membranous one, not another trial sharing the acronym");

// ── VTE: A JUDGEMENT, NOT A THRESHOLD ──────────────────────────────────────────────────────────────
ok(/highest VTE risk of the nephrotic glomerulopathies/.test(k), "the VTE risk is present…");
ok(/renal vein thrombosis/.test(k), "…including renal vein thrombosis, the MN-specific one");
ok(/individualised risk-benefit judgement, not a threshold\s+that mandates anticoagulation/.test(k),
   "…framed as a judgement, so an albumin number is not read as an order to anticoagulate");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ MEMBRANOUS GROUNDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
