# Sample Regeneration Plan

Three-part: (1) regenerate the existing 11 samples against the current RAG-grounded pipeline, (2) add 12 high-yield Boards-mode samples so Boards is a peer of Lecture, (3) **each Lecture sample must produce BOTH a Concise version and a Detailed version** (Concise = hero/default; Detailed available with one-tap toggle on the talk view).

## Dual-version schema (NEW — required for the regen)

Each Lecture sample in `samples.json` (or wherever the SAMPLES array gets injected) must populate:

```json
{
  "slug": "tma",
  "topic": "Thrombotic Microangiopathy",
  "style": "lecture",
  "specialty": "Hematology",
  "generated_at": "2026-06-01",
  "guideline_sources": [...],
  "talk_concise":  { /* full talk JSON, generated with depth=concise */ },
  "talk_detailed": { /* full talk JSON, generated with depth=detailed */ }
}
```

- `talk_concise` is loaded by default when a user opens the card (hero).
- `talk_detailed` is shown when the user taps the depth-toggle pill in the capsule header — swap is instant, no API call.
- Library cards with both versions get a `Concise · Detailed` pill so users can see at-a-glance that the longer cut exists.
- **Boards samples are single-version** (depth doesn't apply to Boards — the toggle is hidden in Boards mode).
- Legacy single-version samples (with `talk` instead of `talk_concise`/`talk_detailed`) still work — the loader falls back to `talk`.

This roughly **doubles the API spend** for Lecture sample regen but means every sample card is instantly tunable in the live app without burning a fresh generation.

---

## Part 1 — Regenerate the existing 11 (with one swap)

The current samples were generated months ago and predate the RAG pipeline, the directive prompt, `pruneFakeReferences`, and the citation contract. A user clicking TMA today gets a v1 talk; a fresh generation would give them a v3 talk. That gap is the #1 thing making the samples look dated.

**Topic adjustment (Jenni 2026-06-01):** Cut **Hepatorenal Syndrome** (overlaps with Portal Hypertension in Cirrhosis already in the Hep bucket). Brings Nephrology to 2 (Nephrotic Syndrome + Hyponatremia) instead of 3.

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

**Cost estimate (DUAL-VERSION, after Hepatorenal cut):** 9 Lecture-style (was 10, cut Hepatorenal) × 2 versions + 1 Boards (AFib) × 1 version = (9 × 2 + 1) × ~$0.06 = **~$1.14**.

---

## Part 2 — New Boards-mode samples (12 topics)

Boards mode currently has 1 sample (AFib boards Q). If it's a peer of Lecture in the UI, it needs a peer-sized sample roster. Below are 12 high-yield topics spanning the ABIM blueprint, chosen because each tests a specific concept with a single defensible best answer — i.e. they make for good ABIM-style vignettes.

**Topic adjustment (Jenni 2026-06-01):** Cut **Hyponatremia SIADH vs CSW (Boards)** — overlaps with Hyponatremia Lecture in the existing roster. New Boards count = 11 (not 12).

| # | Topic | Specialty | Why it's high-yield |
|---|---|---|---|
| 1 | HOCM with syncope — when to ICD | Cardiovascular | SCD risk stratification; 2024 ACC/AHA criteria |
| 2 | C. diff recurrent infection — fidaxomicin vs FMT | Infectious Disease | 2024 IDSA update flipped first-line for recurrence |
| 3 | DKA vs HHS management priorities | Endocrinology | Fluid/insulin sequencing tested every year |
| 4 | Acute pancreatitis severity — when to ICU | Gastroenterology | Ranson/APACHE/BISAP application |
| 5 | Latent TB treatment in HIV patient on ART | Infectious Disease | Drug interactions, regimen choice (3HP vs 4R) |
| 6 | ITP first-line in pregnancy | Hematology | Steroids vs IVIG, splenectomy timing |
| 7 | Stroke thrombolysis window — wake-up stroke | Neurology | DAWN/DEFUSE criteria, perfusion imaging |
| 8 | Gout flare during anticoagulation | Rheumatology | Steroid vs colchicine vs NSAID decision in real-world constraints |
| 9 | Hepatitis B reactivation before chemo | Hepatology | Screening + prophylaxis algorithm |
| 10 | Asthma exacerbation — when to escalate to MgSO4 | Pulmonary | Severity assessment, escalation ladder |
| 11 | Subclinical hypothyroidism — when to treat | Endocrinology | TSH cutoffs by age, symptom-driven decision |

## Part 3 — Add 2 Oncology Lecture samples (dual-version)

Onc was a gap — library section was empty. Two high-yield additions that map to what an IM resident actually sees on the wards.

| # | Topic | Specialty | Why it's high-yield |
|---|---|---|---|
| 1 | Tumor Lysis Syndrome — recognition, prevention, rasburicase vs allopurinol | Oncology | Canonical oncologic emergency; ↑K/↑P/↑uric acid/↓Ca physiology; ASCO 2024 prophylaxis algorithm; high-risk identification (Burkitt, induction-phase ALL, bulky high-grade lymphoma) |
| 2 | Immune Checkpoint Inhibitor Toxicities — irAEs across organ systems | Oncology | irAEs by system (colitis, pneumonitis, hepatitis, hypophysitis, myocarditis); when to hold ICI; steroid → infliximab / MMF / vedolizumab ladder per NCCN + ASCO 2024 management guidelines. IM-relevant because residents now see ICI patients on hospital medicine. |

Both Lecture style, both dual-version (concise + detailed). Cost: 2 × 2 × ~$0.06 = ~$0.24.

## Part 4 — Fill the remaining empty-specialty gaps (4 Lecture, dual-version)

The Library currently shows empty section headers for Allergy/Immunology, Dermatology, Psychiatry, and Geriatrics. Filling each with one high-yield Lecture sample.

| # | Topic | Specialty | Why it's high-yield |
|---|---|---|---|
| 1 | SJS / TEN / DRESS — severe cutaneous adverse reactions | Allergy/Immunology | Type IV hypersensitivity to drugs; recognition (mucosal involvement, BSA % for SJS↔TEN spectrum, eosinophilia/LFT derangement in DRESS); culprit-drug withdrawal, HLA-B*1502/HLA-B*5701 testing, supportive care vs IVIG vs cyclosporine debate per recent reviews |
| 2 | Skin cancer basics — BCC, SCC, melanoma | Dermatology | Recognition (ABCDE for melanoma, the ulcerated SCC vs pearly BCC distinction), risk factors (UV, immunosuppression — relevant to transplant/HIV/ICI patients), when to biopsy vs refer, USPSTF 2023 screening recommendations |
| 3 | SSRI side effects + serotonin syndrome | Psychiatry | The full SSRI side effect ladder (GI, sexual, sleep, hyponatremia/SIADH in elderly, bleeding risk on antiplatelets, QT — citalopram specifically), discontinuation syndrome, and serotonin syndrome recognition (clonus, hyperthermia, autonomic instability) when combined with tramadol/linezolid/MAOIs |
| 4 | Polypharmacy + deprescribing in older adults | Geriatrics | Beers Criteria 2023 update high-yield categories, anticholinergic burden, fall risk meds (benzos, opioids, sleep aids), STOPP/START framework, the actual deprescribing conversation with patient/family |

All four Lecture, dual-version. Cost: 4 × 2 × ~$0.06 = ~$0.48.

**Add these to the `SAMPLES` generator config** (`samples.json` or equivalent) with `style: "boards"` and the specialty tagged so the library inference matches.

**Cost estimate (after SIADH/CSW cut):** 11 Boards talks × ~$0.07 = **~$0.77**.

---

## Total

| Item | Cost |
|---|---|
| Regenerate 10 existing (9 Lecture × 2 + 1 Boards), Hepatorenal cut | ~$1.14 |
| Generate 11 new Boards (single-version), SIADH/CSW cut | ~$0.77 |
| Generate 2 new Onc Lecture (× 2 versions each) | ~$0.24 |
| Generate 4 gap-fill Lecture (× 2 versions each) | ~$0.48 |
| **Total** | **~$2.63** |

**27 total samples** after regen: 15 Lecture (each dual-version cached) + 12 Boards (single-version).

## Final specialty distribution after regen

| Specialty | Count | Topics |
|---|---|---|
| Cardiovascular | 5 | HFrEF (L), Aortic Stenosis (L), Angina (L), AFib (B), HOCM (B) |
| Nephrology | 2 | Nephrotic Syndrome (L), Hyponatremia (L) |
| Oncology | 2 | Tumor Lysis Syndrome (L), ICI Toxicities (L) |
| Infectious Disease | 2 | C. diff recurrent (B), Latent TB in HIV (B) |
| Endocrinology | 2 | DKA vs HHS (B), Subclinical hypothyroidism (B) |
| Pulmonary | 2 | COPD (L), Asthma → MgSO4 (B) |
| Hematology | 2 | TMA (L), ITP in pregnancy (B) |
| Hepatology | 2 | Portal HTN cirrhosis (L), HBV reactivation pre-chemo (B) |
| Rheumatology | 2 | Gout (L), Gout flare on anticoag (B) |
| Allergy/Immunology | 1 | SJS / TEN / DRESS (L) |
| Dermatology | 1 | Skin cancer basics — BCC, SCC, melanoma (L) |
| Psychiatry | 1 | SSRI side effects + serotonin syndrome (L) |
| Geriatrics | 1 | Polypharmacy + deprescribing (L) |
| Gastroenterology | 1 | Acute pancreatitis severity (B) |
| Neurology | 1 | Stroke thrombolysis wake-up (B) |

L = Lecture (dual-version concise + detailed) · B = Boards (single-version)

**Every ABIM-blueprint specialty in the library taxonomy now has at least one sample.** No more empty section headers.

---

## Recommended order

1. **Audit `generate_samples.js`** — confirm it exists and produces the right output shape. If not, the worker `/v1/messages` endpoint takes the same prompt; running 23 curl commands is workable.
2. **Regenerate the existing 11 first.** Lower risk, validates the pipeline produces the citation-grounded output we expect. Spot-check 3 of them in the app.
3. **Add the 12 Boards topics to the config and generate them.** Verify each Boards Q has a defensible single best answer, exactly 4–5 options, and grounded rationales.
4. **Push the new `SAMPLES`** — landing page samples row will rotate; library will fill out.
