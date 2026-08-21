// KIDNEY TRANSPLANT, SECOND PASS — run: node test_transplant_grounding.mjs
//
// The first pass on this entry fixed an ADJACENCY trap (ELITE-Symphony's induction was daclizumab, not
// basiliximab, and the two facts sat two sentences apart). This pass is a different failure class:
// CORPUS-STALE and CORPUS-SILENT together.
//
//   STALE   — the entry stated KDIGO 2009's induction recommendation as if it were current practice.
//             It is a 2009 recommendation, written before modern tac/MMF/steroid maintenance was
//             universal, and many US centres now default to depletional induction. "Standard =
//             basiliximab" is an era, not a fact.
//   SILENT  — nothing on which KDIGO document covers what, so a talk citing "KDIGO" mixed the 2020
//             CANDIDATE guideline with this 2009 RECIPIENT-CARE one; nothing on DGF's surrogate
//             validity, so a deck called it the "dominant modifiable driver"; nothing separating
//             desensitization from HLA-incompatible transplantation from kidney paired donation, so a
//             deck listed plasma exchange / IVIG / rituximab as an equivalent option.
//
// TWO OF THE REVIEW'S NUMBERS ARE ASSERTED AS ABSENT. "IL2RA adds ~1-4% absolute" and "rATG lowers
// relative risk ~50%" could not be traced to primary sources from here (NEJM 403s), and the "~1/4 of
// patients reclassified by anti-HLA-C/-DP" figure could not be sourced at all. The DIRECTION of each is
// in the entry; the numbers are in CORPUS_REVIEW_QUEUE.md.
//
// AND THE FIRST DRAFT OF THIS ENTRY FAILED test_corpus_corrections.mjs, correctly: it wrote the withheld
// claims out and marked them unverified. An entry may not assert a clinical claim behind a caveat — the
// model reads the whole string and the caveat is what gets dropped. That is asserted here too.
import { readFileSync } from "fs";

let n = 0, failures = 0;
const ok = (c, m) => { n++; console.log((c ? "✓" : "✗ FAIL") + " — " + m); if (!c) failures++; };
const G = JSON.parse(readFileSync(new URL("./guidelines.json", import.meta.url), "utf8")).specialties;
const entry = (G.Nephrology.guidelines || []).find(x => /Transplant Recipients 2009/.test(x.name));
ok(!!entry, "sanity: the transplant recipient-care entry is present");
const k = (entry && entry.keys) || "";

// ── INDUCTION: THE RECOMMENDATION *AND* THE ERA IT WAS WRITTEN IN ──────────────────────────────────
ok(/KDIGO 2009 recommends an IL-2 receptor antagonist \(basiliximab\) first-line/.test(k),
   "the 2009 recommendation is still stated — this is a reframing, not a deletion");
ok(/written before modern\s+tacrolimus\/mycophenolate\/steroid maintenance was universal/.test(k),
   "…with the reason it has drifted: the maintenance backbone underneath it changed");
ok(/incremental benefit of an IL2RA in a standard-risk recipient is SMALL/.test(k),
   "…the direction of the modern evidence in standard risk…");
ok(/depleting induction reduces acute\s+rejection further in high-risk recipients/.test(k),
   "…and in high risk, which is the half that still favours depletion");
ok(/many US centres now use rATG or alemtuzumab as their default\s+depletional induction/.test(k),
   "…and what centres actually do, since the deck's error was treating one option as universal");
ok(/CENTRE- AND ERA-DEPENDENT, not a fact/.test(k),
   "…labelled centre- and era-dependent, which is the correction the review asked for");
// THE WITHHELD EFFECT SIZES.
ok(!/1-4%/.test(k) && !/1–4%/.test(k), "the unverified '~1-4% absolute' figure is ABSENT…");
ok(!/~50%/.test(k) && !/50% vs/.test(k), "…and so is the unverified '~50% relative' figure");
ok(/CARRIES NO EFFECT SIZES for induction agents/.test(k),
   "…and the entry says it has none, so a percentage in a talk is recognisable as model memory");

// ── WHICH KDIGO DOCUMENT ───────────────────────────────────────────────────────────────────────────
ok(/KDIGO 2020 Clinical Practice Guideline on the\s+Evaluation and Management of Candidates/.test(k),
   "the 2020 CANDIDATE guideline is named in full…");
ok(/PMID 32301874/.test(k), "…with a PMID, so the two documents can be told apart by a reader who checks");
ok(/CANDIDACY, ACCESS AND PRE-TRANSPLANT EVALUATION/.test(k) && /IMMUNOSUPPRESSION AND POST-TRANSPLANT CARE/.test(k),
   "…and each document is bound to its own subject matter");
ok(/label each claim with the document it came from/.test(k),
   "…with the instruction that follows, since 'KDIGO says' with no year is how they got mixed");
ok(/this 2009 recipient-care guideline, which has no\s+replacement/.test(k),
   "…and the 2009 document is marked current-for-its-subject, not merely old");

// ── DGF: PREDICTOR, NOT SURROGATE ──────────────────────────────────────────────────────────────────
ok(!/dominant modifiable driver/.test(k) || /Calling it the\s+'dominant modifiable driver' of graft loss overstates it/.test(k),
   "the 'dominant modifiable driver' phrasing appears ONLY as the error being corrected");
ok(/DGF and KDPI are independent predictors of\s+outcome while cold ischaemia time is not, in some registry analyses/.test(k),
   "…with the registry finding that motivates the correction, hedged to 'some' as the evidence is");
ok(/first 6-12 months/.test(k),
   "…and the paired-kidney window, which is what makes it an EARLY predictor rather than a lifetime one");
ok(/long-term surrogate validity is\s+uncertain/.test(k),
   "…landing on the phrasing the review asked for");
ok(/not as the lever that determines graft survival/.test(k),
   "…and naming the overstatement so it is not re-introduced");

// ── cPRA: A RELATION, NOT AN ATTRIBUTE ─────────────────────────────────────────────────────────────
ok(/percentage of donors in a REFERENCE POPULATION/.test(k),
   "cPRA is defined against a donor pool, which is the teaching point the review affirmed");
ok(/it moves when the pool changes and it moves after any sensitising event/.test(k),
   "…and it is explicitly not fixed — transfusion, pregnancy, a previous graft all move it");
ok(/CENTRE-DEPENDENT, because each centre decides which antigens count\s+as unacceptable/.test(k),
   "…and centre-dependent, which is sourced and is the durable half of the anti-HLA-C/-DP point");
// THE WITHHELD FRACTION.
ok(!/quarter/.test(k) && !/25%/.test(k) && !/¼/.test(k),
   "the unsourced '~1/4 reclassified' fraction is ABSENT from the entry");
ok(/THIS ENTRY GIVES NO FIGURE for how many are reclassified/.test(k),
   "…and the absence is stated, so the gap is visible rather than silent");

// ── DESENSITIZATION: THREE DIFFERENT THINGS ────────────────────────────────────────────────────────
ok(/Desensitization is the pre-transplant antibody-reduction strategy/.test(k), "desensitization is defined…");
ok(/HLA-incompatible transplantation is what may follow it/.test(k), "…as distinct from the transplant itself…");
ok(/kidney paired donation is a\s+separate route that AVOIDS desensitization altogether/.test(k),
   "…and from paired donation, which the deck had listed as an equivalent alternative");
ok(/should be considered first/.test(k), "…with paired donation preferred, which is the practical upshot");
ok(/no\s+randomised trial has shown that desensitization improves long-term allograft survival/.test(k),
   "the evidence status is stated…");
ok(/matched-cohort and it CONFLICTS BY HEALTH SYSTEM/.test(k),
   "…accurately — these are matched cohorts, not RCTs, and they disagree");
ok(/a UK analysis found no survival advantage over waiting/.test(k) && /US analyses found benefit/.test(k),
   "…with both sides of the conflict, rather than picking the convenient one");
ok(/waiting list of a different length/.test(k),
   "…and the reason they can both be right, which is what makes it teachable");
ok(/T-cell CDC crossmatch titres\s+>1:32/.test(k),
   "…plus the titre above which the protocols simply did not work");

// ── THE HEDGE GUARD MUST STILL HOLD ────────────────────────────────────────────────────────────────
// The first draft wrote the withheld claims out behind "was not verified". The corpus guard rejected it,
// and rightly: a caveat is the part a model drops. Asserted here so this entry cannot regress into that
// shape without two suites failing rather than one.
ok(!/not verified/i.test(k) && !/unverified/i.test(k) && !/could not be verified/i.test(k),
   "no claim in this entry is stated behind an 'unverified' caveat — withheld means absent, not hedged");
const queue = readFileSync(new URL("./CORPUS_REVIEW_QUEUE.md", import.meta.url), "utf8");
ok(/Kidney transplant, second pass \(reviewed 20 Aug 2026\)/.test(queue),
   "…and the withheld numbers are recorded in the queue instead");
ok(/1–4%/.test(queue) && /~50%/.test(queue) && /¼ of patients/.test(queue),
   "…all three of them, with enough detail to be cleared later rather than rediscovered");
ok(/Brennan 2006/.test(queue),
   "…naming the primary source to read, so clearing it is a task rather than a search");

// ── THE FIRST-PASS FIX MUST SURVIVE ────────────────────────────────────────────────────────────────
// This entry was edited twice. An append-shaped edit is exactly how the earlier daclizumab correction
// would get orphaned or duplicated.
ok(/ELITE-SYMPHONY USED DACLIZUMAB INDUCTION, NOT BASILIXIMAB/.test(k),
   "the earlier adjacency fix is still intact after this pass…");
ok((k.match(/ELITE-SYMPHONY USED DACLIZUMAB/g) || []).length === 1,
   "…and appears exactly once, not duplicated by an appending edit");
ok(/PMID 18094377/.test(k), "…still carrying Symphony's PMID");

console.log(`\n${n} assertions, ` + (failures === 0 ? "✔ TRANSPLANT GROUNDING OK" : "✗ " + failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
