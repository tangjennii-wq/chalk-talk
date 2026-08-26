# Corpus review queue — claims NOT yet in `guidelines.json`

Everything in `guidelines.json` is read by the model as authoritative context. Uncertainty prose does
not neutralise an instruction: a sentence that says "reperfusion is reasonable in category E1" teaches
that, whatever caveat follows it. So a claim enters the corpus only after it has been checked against a
primary source, and lives here until then.

**Rule.** No entry in `guidelines.json` may assert a clinical actionable while marking it unverified.
`test_corpus_corrections.mjs` enforces this over the whole file, not just the entries touched here.

---

## 1. Acute PE — 2026 AHA/ACC (WITHHELD IN FULL)

Source: OpenEvidence review of a Chalk Talk card, relayed 2026-08-19. **The 2026 AHA/ACC full text has
not been consulted.** The corpus entry is unchanged from its previous state; none of the below is in it.

Two of these are corrections to the EXISTING entry, so the existing entry is also suspect — it names the
A–E categories and then teaches management on the retired shock/arrest axis. Do not regenerate PE from
the current corpus expecting a correct card, and do not treat the current entry as validated either.

| # | Claim to verify | Why it matters |
|---|---|---|
| 1 | Reperfusion anchors to **E1** (reasonable) and **D1–2** (may be considered) — incipient cardiopulmonary failure, normotensive shock — not only overt shock/arrest | Changes who gets lysed. Highest-stakes item here |
| 2 | Guideline **explicitly does not recommend CDT for stable C2–3** (no deterioration benefit, more bleeding than anticoagulation alone) | A non-recommendation, so the risk of getting it wrong is over-treatment |
| 3 | ULTIMA = only completed RCT; faster RV/LV at 24 h, no mortality difference; PE-TRACT ongoing; observational meta-analyses suggest lower mortality/less bleeding vs systemic lysis | Currently the entry says only "evolving" |
| 4 | Recurrence ≈10% at 1 year, ≈30–40% at 10 years unprovoked (NEJM review: 36% at 10 y). NOT "30% at 5 years" | Denominator error, quoted in a card |
| 5 | Reduced-dose apixaban 2.5 mg BID / rivaroxaban 10 mg daily is **extended phase only, after 3–6 months full dose** | Without the clause it reads as a starting dose — a dosing error |
| 6 | RV failure: avoid large boluses, norepinephrine early, but a cautious ≤500 mL challenge may be reasonable in a non-congested RV | Currently absent; card supplied it from memory |

**To clear:** read the 2026 AHA/ACC PE guideline directly (and ESC 2019 for the taxonomy split), confirm
each row, then edit the entry **in place** at the sentences that carry the old logic — the shock/arrest
and "intermediate-high: monitor" management text must be REPLACED, not annotated.

---

## 2. DKA / HHS — resolved, with two items withheld

The verified corrections are committed. These two are not in the corpus:

| Claim | Status |
|---|---|
| ADA Standards of Care 2026 §16 specifies a **2–4 h** basal insulin overlap | **Withheld.** The 2024 consensus full text says **1–2 h**, twice, explicitly — that is what the corpus teaches. The 2026 Standards were behind a 403 and could not be read. If confirmed, this becomes a genuine source disagreement to name in the entry; until then the corpus carries only the checked figure |
| JBDS severity markers (pH <7.1, bicarb <5, GCS <12, K⁺ <3.5, SpO₂ <92%); ISPAD severe pH <7.1 / bicarb <5 | **Withheld — numbers.** The substantive point survived: the consensus severity table carries no society attribution, so the entry now labels its cutoffs as the 2024 consensus **adult** schema and says other bodies grade differently. No unverified numbers are given |
| DECLARE-TIMI 58 "DKA 0.3% vs 0.1% with dapagliflozin" | **Excluded, and named as excluded.** Not in the consensus. The entry carries the guideline-level figures instead (T1D 5–17×; T2D RR 2.46, 95% CI 1.16–5.21) and tells the model not to quote DECLARE percentages as consensus figures |

### Verified and committed
Fluid wording corrected at source (consensus recommends isotonic saline on availability/cost/efficacy
while reporting balanced solutions resolve faster — a preference, not a mandate) · 1–2 h infusion overlap
· severity schema attributed · SGLT2i risk magnitudes · urine-ketone/nitroprusside principle.
All re-verified 2026-08-19 against doi 10.2337/dci24-0032.

---

## 3. Pericardial effusion / tamponade — entry written, three items withheld

The entry is committed. These are NOT in it:

| Claim | Status |
|---|---|
| "ESC quotes an overall pericardiocentesis complication rate of **4–10%**" | **Withheld — contradicted.** The ESC Council for Cardiology Practice article gives **major 0.3–3.9%, minor 0.4–20%** — a different structure, not a different number. Asserted twice by the same review. Tie-break needs the 2015 ESC guideline full text, which is captcha-walled to me |
| "Drain **<500 mL** in one sitting to avoid decompression syndrome," attributed to ESC | **Withheld — contradicted.** The same ESC article says there are no effective preventive recommendations "except to remove enough fluid to normalise the central venous and systemic blood pressure (**not >1 L**)". Also asserted twice. The entry states 1 L and names 500 mL as not-from-this-source, so it cannot be quietly adopted later |
| Malignancy causes >30% of tamponade presentations; ~72% of new malignancies had positive cytology; ~50% of drained effusions | **Withheld — unverified.** Not in either source I could read. The entry instead refuses the number outright and keeps the actionable half (always send cytology) |
| Effusion size grading: small <1.0 cm, moderate 1.0–1.9, large 2.0–2.5, very large >2.5, attributed to "ACC/imaging schemes" | **Withheld — unverified.** Plausible and useful; no primary source read |
| **CORP-2 PMID** | **Blocked, not withheld.** DOI `10.1016/S0140-6736(13)62709-9` and the figures are confirmed, but `landmark_pmids.json` is PMID-keyed and eutils is robots-disallowed to me. One lookup from a machine with network adds it — ICAP (23992557) and CORP (21873705) are already indexed |

**Verified and committed:** fluids scoped to hypotensive/hypovolaemic at 250–500 mL with the harm from
larger volumes · IV diuretics contraindicated · positive-pressure ventilation −25% cardiac output ·
drainage indications with 20 mm tied to *chronic* effusion · major/minor complication split ·
decompression syndrome at 1 L · ICAP 16.7% (20/120) vs 37.5% (45/120) · CORP-2 21.6% (26/120) vs 42.5%
(51/120) · echo-guided preferred, surgery for dissection and uncontrolled bleeding.

---

## 4. ILD / PPF — triaged and committed, one item withheld

| Review claim | Verdict |
|---|---|
| Nintedanib **strongly** recommended for PPF; pirfenidone the conditional one | **Review was wrong on both halves, and the card was right.** The 2022 ATS/ERS/JRS/ALAT guideline made a **conditional** recommendation for nintedanib and **no formal recommendation** for pirfenidone, only a call for further research. Applying this "correction" would have introduced an error into correct teaching. The corpus now states both strengths and names both wrong directions |
| Group 3 PH: inhaled treprostinil is the exception | **Confirmed, and the corpus was wrong.** It said "Group 3: do NOT use PAH drugs" as a blanket, which the card faithfully repeated. Corrected at source with INCREASE (31.12 m, 95% CI 16.85–45.39, P<0.001; NEJM 2021;384:325-334, PMID 33440084) and added to the landmark index |
| SSc-ILD: tocilizumab and nintedanib alongside MMF | **Confirmed, and it was already in the corpus — under Rheumatology, which an ILD topic does not route to.** Restated in the Pulmonary entry rather than widening routing, which is frozen |
| Anti-steroid recommendation is SSc-specific | **Confirmed in substance.** PANTHER studied IPF, so the boundary is IPF vs CTD-ILD. Recorded as a scope claim |
| Tocilizumab ~4.2% predicted-FVC difference at 48 weeks | **Withheld.** focuSSced not read directly. The entry names the agent and explicitly refuses the number |
| "Myositis-ILD, especially anti-MDA5, needs aggressive combination immunosuppression" | **Withheld.** Clinically plausible, no primary source read. Not a claim to put in ground truth on a relay |

**Standing score on relayed reviews: four of four have contained at least one claim that verification
contradicted.** Two of those would have introduced errors into correct content.

---

## 5. Kidney transplant immunosuppression — one verified fix, four withheld

The KDIGO 2009 entry is one of the meatier ones (1,629 chars) and still produced a wrong card, by a
mechanism worth naming: **adjacency**. It said "INDUCTION: basiliximab first-line" and, two sentences
later, cited ELITE-Symphony for the CNI comparison. Both true. The model joined them and attributed
basiliximab induction to Symphony. Two correct statements can compose into a false one.

| Claim | Verdict |
|---|---|
| ELITE-Symphony induction was **daclizumab**, not basiliximab | **Confirmed** in the primary record (Ekberg, NEJM 2007;357:2562-75, PMID 18094377). Fixed at source, with the adjacency trap spelled out. Daclizumab is withdrawn, so it is a fact about the trial, not an option today |
| Trough targets: 8–12→5–8 vs Symphony 3–7 (achieved 6–7), KDIGO 3–15 early, real-world 5–7.9 / 5–6.9, floor <4–6 → dnDSA | **Withheld — numbers.** The entry contains **no ng/mL figure at all**, so the card's ranges were memory. The entry now says so, and states the *floor* qualitatively: too-low exposure associates with de novo DSA and worse graft survival, so "lower is safer" is wrong in both directions. Specific ranges need their sources read |
| BK screening: monthly to month 9, then q3mo to 2 yr; reduce IS at DNAemia >1000 copies/mL sustained 3 wk, or >10,000 | **Withheld.** AST-IDCOP is not in this corpus. The entry now says no schedule or threshold is given here, so a talk quoting them is quoting memory |
| MPA reduced first; tac→CsA / tac→mTORi swaps not RCT-supported | **Partially in already** — KDIGO says lower the antiproliferative first. The "not RCT-supported" nuance is recorded qualitatively; do not present a swap sequence as evidence-based |
| Belatacept does not raise BK-DNAemia vs tacrolimus; emerging as rescue | **Withheld.** No primary source read. Contradicts older teaching, so it needs one |

**To clear:** read AST-IDCOP BK guidance and a current trough-target source, then add numbers *with* their
provenance. Until then the entry's job is to stop the model inventing them, which is what it now does.

## 9. Hypereosinophilic syndrome (reviewed 21 Aug 2026) — withheld numbers

| Claim from the review | Disposition |
| --- | --- |
| Real-world remission **57–76%**, with **~86%** discontinuing glucocorticoids by 12 months on mepolizumab | **Withheld — numbers.** Real-world cohort figures with no source read here. The entry says it carries no remission or steroid-sparing percentages, so a quoted one is recognisable as memory. To clear: identify the cohort study and add the figures with its population attached |

**Where the review was out of date, and it was its headline point:** it said benralizumab's "regulatory
status for HES is still evolving" and that the evidence is now "RCT-level, not just supportive." Both
were true when written. **Benralizumab was FDA-approved for HES on 14 May 2026** (30 mg SC q4w, age ≥12,
no identifiable non-haematologic secondary cause) — so the entry teaches it as an approved option, not a
promising trial. NATRON itself is verified in full (Nature Medicine, 31 Mar 2026,
doi 10.1038/s41591-026-04315-8; HR 0.35, 95% CI 0.18–0.69, P=0.0024).

**What the review omitted that mattered more than what it added:** NATRON enrolled **FIP1L1::PDGFRA-negative**
patients. Without that, the trial result sits beside the imatinib paragraph and teaches a biologic for the
one patient who should get imatinib.

---

## 8. Kidney transplant, second pass (reviewed 20 Aug 2026) — withheld numbers

| Claim from the review | Disposition |
| --- | --- |
| IL2RA adds **~1–4% absolute** rejection reduction in standard-risk recipients; rATG lowers relative rejection risk **~50%** vs IL2RA in high-risk | **Withheld — numbers.** The direction is well supported and is now in the entry (small incremental benefit in standard risk against modern tac/MMF/steroid maintenance; further reduction with depletional induction in high risk). The two percentages were not traced to primary sources — the Brennan rATG-vs-basiliximab NEJM paper is 403 from here. To clear: read Brennan 2006 and a current meta-analysis, then add the figures with their populations attached |
| Including **anti-HLA-C and anti-HLA-DP** in the cPRA calculation reclassifies **~¼ of patients** upward | **Withheld — the fraction.** That cPRA is centre-dependent, and that which antigens count as unacceptable varies, is sourced and is in the entry. The ~¼ figure is not. To clear: find the allocation-policy analysis it comes from |
| Desensitization RCTs have not shown improved long-term allograft survival | **In, reworded.** There are essentially no RCTs here; the evidence is matched-cohort and it **conflicts by health system** — a UK analysis found no advantage over waiting for a compatible organ, US analyses found benefit. The entry says that, plus the ineffectiveness of protocols above a T-cell CDC crossmatch titre of 1:32, and separates desensitization / HLA-incompatible transplant / kidney paired donation, which the review correctly flagged as conflated |

**A note on how this one was caught:** the first draft of the entry wrote the withheld claims out and
marked them unverified. `test_corpus_corrections.mjs` rejected it — an entry may not assert a clinical
claim behind a caveat, because the model reads the whole string and the caveat is the part that gets
dropped. The claims were removed from the entry and recorded here instead. That guard has now paid for
itself twice.

---

## 7. CRRT (reviewed 20 Aug 2026) — withheld claims

| Claim from the review | Disposition |
| --- | --- |
| A 2026 meta-analysis and the ongoing Ketzerei RCT are testing whether **lower effluent (10–15 mL/kg/h)** speeds renal recovery; **very-low-dose <13 mL/kg/h raises 90-day mortality** | **Withheld — unverifiable today.** Both PubMed records (41896891, 40983574) are captcha-blocked from here and no alternative full text was reachable. The review itself calls it "optional footnote, not practice-changing." A mortality threshold is precisely the kind of number that must not enter the corpus on a secondhand summary. To clear: read the meta-analysis abstract and confirm the <13 mL/kg/h figure and its evidence class |
| Total:ionised calcium cut-off of **2.4** used by "JACC/some centers" | **Partially in.** The 2026 Delphi consensus states **≥2.5**, and that is what the entry teaches, with an explicit note that some centres use 2.4 and that the ratio alone is not the diagnosis. The 2.4 attribution to a specific document was not traced |
| Including **anti-HLA-C/-DP** in cPRA reclassifies ~¼ of patients upward | **Not in the CRRT entry** — belongs to the transplant entry, and the ~¼ figure needs its source read before it lands anywhere |

**Corrections the review itself needed:**

- It summarised RICH as "longer filter life, less bleeding, no mortality difference." True as far as it
  goes, and it omits the two findings that change how the trial should be taught: **culture-proven
  infection was higher with citrate (68.0% vs 55.4%)**, hypophosphataemia likewise, and the trial was
  **stopped early at interim**, which widens the uncertainty on every patient-centred outcome. Both are
  now in the entry.
- It gave "net UF >1.75 mL/kg/h is associated with worse outcomes" as a bare number to add. The evidence
  is **observational** — a RENAL secondary analysis plus retrospective cohorts. The entry carries the
  number *with* its evidence class, per the prompt's own rule against flattening support into one voice.
- It said citrate-in-liver-failure is now first-line per a 2026 Delphi consensus. **Verified and correct**
  — and the consensus adds something the review omitted: **standard LFTs are poor predictors** of
  accumulation, while rising lactate and falling lactate clearance are the better signals.

---

---

## 6. Standing lesson

Physician review of a *generated card* keeps surfacing faults that are the corpus's, not the card's — the
card repeated what it was told. Two failure modes seen so far:

3. **A silent routing miss looks exactly like a normal talk.** `getGuidelinesForTopic("Acute
   Pericarditis")` returned null — no keyword matched, and the TOPICS fallback compared case-sensitively
   against its own catalogue. The talk was written with zero guideline context and read fine until a
   number was wrong. Check routing before blaming the model.

1. **Appending a correction instead of applying it.** Leaves the entry asserting both. The model reads
   the whole string and picks. Corrections go at the sentence carrying the error.
2. **Treating a review as a verdict.** The 2–4 h "correction" was itself wrong against the document the
   card cited. A review is evidence; the primary source decides.
