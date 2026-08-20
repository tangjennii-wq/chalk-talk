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

## 5. Standing lesson

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
