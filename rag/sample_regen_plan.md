# Sample Regeneration Plan

Two-part: (1) regenerate the existing 11 samples against the current RAG-grounded pipeline, (2) add 12 high-yield Boards-mode samples so Boards is a peer of Lecture.

---

## Part 1 — Regenerate the existing 11

The current samples were generated months ago and predate the RAG pipeline, the directive prompt, `pruneFakeReferences`, and the citation contract. A user clicking TMA today gets a v1 talk; a fresh generation would give them a v3 talk. That gap is the #1 thing making the samples look dated.

**To run:**

```bash
cd <chalktalk-repo>
ANTHROPIC_API_KEY=sk-ant-...  node generate_samples.js
```

(The script path comes from the empty-state copy already in `index.html` line ~3326. If it isn't actually there, the equivalent is to call the worker `/v1/messages` endpoint with the same system prompt the app uses, for each topic in the sample roster.)

**Expected delta vs current:**
- Inline `PMID 12345678` citations throughout the body.
- `📑 sources` panel populated with real PubMed-linked tier-badged sources.
- References section pruned to only what was actually cited.
- Specialty tagging consistent with the new library grouping.

**Cost estimate:** 11 talks × ~$0.05 main + ~$0.01 review = **~$0.66**.

---

## Part 2 — New Boards-mode samples (12 topics)

Boards mode currently has 1 sample (AFib boards Q). If it's a peer of Lecture in the UI, it needs a peer-sized sample roster. Below are 12 high-yield topics spanning the ABIM blueprint, chosen because each tests a specific concept with a single defensible best answer — i.e. they make for good ABIM-style vignettes.

| # | Topic | Specialty | Why it's high-yield |
|---|---|---|---|
| 1 | HOCM with syncope — when to ICD | Cardiovascular | SCD risk stratification; 2024 ACC/AHA criteria |
| 2 | C. diff recurrent infection — fidaxomicin vs FMT | Infectious Disease | 2024 IDSA update flipped first-line for recurrence |
| 3 | Hyponatremia in SIADH vs cerebral salt wasting | Nephrology | Volume-status reasoning, classic resident trap |
| 4 | DKA vs HHS management priorities | Endocrinology | Fluid/insulin sequencing tested every year |
| 5 | Acute pancreatitis severity — when to ICU | Gastroenterology | Ranson/APACHE/BISAP application |
| 6 | Latent TB treatment in HIV patient on ART | Infectious Disease | Drug interactions, regimen choice (3HP vs 4R) |
| 7 | ITP first-line in pregnancy | Hematology | Steroids vs IVIG, splenectomy timing |
| 8 | Stroke thrombolysis window — wake-up stroke | Neurology | DAWN/DEFUSE criteria, perfusion imaging |
| 9 | Gout flare during anticoagulation | Rheumatology | Steroid vs colchicine vs NSAID decision in real-world constraints |
| 10 | Hepatitis B reactivation before chemo | Hepatology | Screening + prophylaxis algorithm |
| 11 | Asthma exacerbation — when to escalate to MgSO4 | Pulmonary | Severity assessment, escalation ladder |
| 12 | Subclinical hypothyroidism — when to treat | Endocrinology | TSH cutoffs by age, symptom-driven decision |

**Add these to the `SAMPLES` generator config** (`samples.json` or equivalent) with `style: "boards"` and the specialty tagged so the library inference matches.

**Cost estimate:** 12 Boards talks × ~$0.07 (Opus for both draft and review per the project memory) = **~$0.84**.

---

## Total

| Item | Cost |
|---|---|
| Regenerate 11 existing | ~$0.66 |
| Generate 12 new Boards | ~$0.84 |
| **Total** | **~$1.50** |

Roughly $1.50 of API spend to refresh the entire sample roster from v1 → v3 quality and elevate Boards to a peer of Lecture in the UI.

---

## Recommended order

1. **Audit `generate_samples.js`** — confirm it exists and produces the right output shape. If not, the worker `/v1/messages` endpoint takes the same prompt; running 23 curl commands is workable.
2. **Regenerate the existing 11 first.** Lower risk, validates the pipeline produces the citation-grounded output we expect. Spot-check 3 of them in the app.
3. **Add the 12 Boards topics to the config and generate them.** Verify each Boards Q has a defensible single best answer, exactly 4–5 options, and grounded rationales.
4. **Push the new `SAMPLES`** — landing page samples row will rotate; library will fill out.
