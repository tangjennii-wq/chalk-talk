# Literature verification — July 2026

**Scope:** the 24 phantom-year-flagged guideline entries that had never been audited. All 24 verified by live literature search (July 2026), not from model memory — training knowledge ends ~May 2025, which is exactly where these entries live.

**Result: 20 confirmed accurate · 3 corrections · 1 merge recommended.** No fabricated guidelines found.

That last point matters: these were the entries statistically most likely to be phantom-year fabrications (the `IDSA SSTI 2014/2024` pattern). None were. The corpus is in materially better shape than the audit history implied.

---

## Corrections applied (build 2026-07-17-05)

### 1. NAMS Hormone Therapy — FDA boxed warning ❗ highest severity

**Was:** `(FDA boxed warning REMOVED 2025)` — "on 10 Nov 2025 the FDA REMOVED THE BOXED WARNING"

**Actually:** FDA *announced* it was initiating removal on 10 Nov 2025. The first labeling changes were **approved 12 Feb 2026**, and only **6 of 29** submitted products were cleared. It is a phased, product-by-product rollout.

**Why it mattered:** this is a high-stakes clinical claim taught to residents. "The boxed warning is gone" overstates both the timing and the scope — an individual HT product may still carry the old label. Corrected to state the announce/approve distinction and an explicit *do not teach as blanket removal* instruction.

Source: [FDA — labeling changes for menopausal HT products](https://www.fda.gov/news-events/press-announcements/fda-approves-labeling-changes-menopausal-hormone-therapy-products)

### 2. Axial Spondyloarthritis — genuinely superseded

**Was:** `ASAS-EULAR 2022 / ACR 2019` with no currency note.

**Actually:** the ACR/SAA/SPARTAN guideline was updated — approved by the ACR Board 31 May 2026, announced 24 Jun 2026 — replacing the 2019 adult recommendations and adding a first-ever juvenile axSpA guideline. **JAKi upgraded to strongly recommended, which reverses the positioning in the stored content.** Manuscript not yet journal-published at announcement.

This is the only true currency miss found. Corrected with a leading CURRENCY note; ASAS-EULAR 2022 remains current.

Source: [ACR press release, 24 Jun 2026](https://rheumatology.org/press-releases/new-guidelines-advance-treatment-of-axial-spondyloarthritis-in-adults-and-youth)

### 3. Valvular Heart Disease — year conflation (minor)

`(+ EARLY TAVR 2025)` conflates two dates: the EARLY TAVR trial published **2024** (NEJM/TCT); the FDA approval for asymptomatic severe AS was **1 May 2025**. Worth disambiguating so the trial isn't miscited to 2025.

---

## Recommended, not yet applied

### ANCA vasculitis — two entries should merge

`ACR/VF ANCA Vasculitis 2021 + KDIGO 2024` and `EULAR 2022 / KDIGO 2024` are **not** duplicates — ACR/VF 2021 (US), EULAR 2022 (Europe) and KDIGO 2024 (global nephrology) are three real, distinct documents. But both entries anchor to the same KDIGO 2024 secondary reference for the same disease, and the societies **disagree** on specifics: avacopan positioning, plasma exchange for alveolar hemorrhage, maintenance agent preference.

Split as-is, a learner could read them as two unrelated topics. Better as one `ANCA Vasculitis` entry showing ACR 2021 / EULAR 2022 / KDIGO 2024 side by side with the disagreements called out explicitly — which is also better teaching.

### KDIGO Glomerular Diseases — wording

"2021 base being retired" overstates it. Updates are chapter-by-chapter; unupdated 2021 chapters (FSGS, membranous) remain active. Suggest "2021 base updated chapter-by-chapter." A 2025 pediatric nephrotic syndrome chapter also exists and isn't listed.

---

## Confirmed accurate (no action)

| entry | note |
|---|---|
| 2026 AHA/ACC Acute PE | real; first-ever AHA/ACC PE guideline. PMID 41712677 resolves |
| IDSA 2025 Complicated UTI | real; first major update since 2010 — title's `(+ 2010)` correct |
| AAD Atopic Dermatitis | both real: 2025 adult focused update + first-ever 2026 pediatric |
| AAN 2018 MS DMT | reaffirmed 19 Oct 2024 — exactly as stated |
| KDIGO 2012 AKI | 2026 update genuinely still in review (comment period ran to 11 May 2026) |
| 2022 AHA/ACC/HFSA HF | current; finerenone FDA-approved 14 Jul 2025 (FINEARTS-HF), not yet in guideline text |
| 2022 ESC/ERS Pulm HTN | current; sotatercept approved 26 Mar 2024 (STELLAR) |
| ATS/ERS IPF 2022 | current; nerandomilast approved Oct/Dec 2025 (FIBRONEER) |
| AASM OSA 2017 | current; 2025 inpatient OSA guideline real (JCSM, 21 Aug 2025) |
| ACG C. difficile 2021 | current; AGA FMT 2024 real (REBYOTA, VOWST) |
| AASLD MASLD 2023 | resmetirom (Oct 2024) + semaglutide (Nov 2025) are real AASLD *updates*, not just approvals |
| IDSA Group A Strep 2025 | real, explicitly "Part 1: testing"; 2012 treatment guidance still operative |
| ACR Gout 2020 | current; MIRROR pegloticase+MTX 2022 is trial evidence |
| ACR/VF GCA 2021 | current; upadacitinib approved 29 Apr 2025 (SELECT-GCA); EULAR imaging 2023 real |
| AAD-NPF Psoriasis 2019/2021 | still operative but content-stale — predates bimekizumab and deucravacitinib |
| ASAM OUD 2020 | current; X-waiver abolished via Consolidated Appropriations Act 2023 |
| USPSTF Tobacco 2021 + ATS 2020 | both current; USPSTF update at research-plan stage only |

## Recurring pattern worth noting

Most two-year titles are **base guideline + a real non-guideline development** (drug approval, trial, FDA action). That's legitimate content tripping a title-convention lint, not fabrication. The distinction the corpus should make consistently: *a drug approval is not a guideline update.* Several entries would read more honestly as "X is FDA-approved but not yet reflected in the guideline text."
