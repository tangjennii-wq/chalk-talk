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

## 3. Standing lesson

Physician review of a *generated card* keeps surfacing faults that are the corpus's, not the card's — the
card repeated what it was told. Two failure modes seen so far:

1. **Appending a correction instead of applying it.** Leaves the entry asserting both. The model reads
   the whole string and picks. Corrections go at the sentence carrying the error.
2. **Treating a review as a verdict.** The 2–4 h "correction" was itself wrong against the document the
   card cited. A review is evidence; the primary source decides.
