# Landmark trial review — batches 1 & 2 · FOR PHYSICIAN REVIEW

Generated 2026-07-21 · **70 trials** · nothing ingested, `landmark_trials.json` untouched

All counts in this document are COMPUTED from `rag/trial_review_records.json`, not typed. The previous draft had inconsistent totals (36 rows described as 37, role totals summing to 34 against 35 recommended) — generating them removes that error class.

## Corrections applied after Codex review of batch 1

- **DELIVER** — CORRECTED per Codex: originally claimed 'incorporated into 2022 guideline' — chronologically impossible.
- **CLEAR Outcomes** — CORRECTED per Codex: originally cited the 2022 pathway, which predates the result. Metadata also secondary-sourced (PubMed rate-limited).
- **ACURASYS** — CORRECTED per Codex: was mislabeled 'important negative trial'. ACURASYS was POSITIVE; ROSE contradicted it.
- **AcT** — CORRECTED per Codex: previously cited a vague '2023 update'.
- **CONFIRM** — REPLACES an incorrect entry. The prior draft substituted a 1995 octreotide/sclerotherapy variceal-bleeding study — a different clinical question entirely. Caught by Codex.

## Totals

| batch | n |
|---|---|
| batch 1 | 35 |
| batch 2 | 35 |

| teaching role | n |
|---|---|
| practice-changing benefit | 39 |
| safety/harm | 14 |
| important negative trial | 11 |
| guideline-supporting | 4 |
| evidence reversal (positive, later contradicted) | 1 |
| diagnostic strategy | 1 |

| specialty | n |
|---|---|
| Cardiovascular | 16 |
| Pulmonary | 11 |
| Neurology | 10 |
| GI/Hepatology | 8 |
| ID | 8 |
| Heme | 7 |
| Critical care | 6 |
| Prevention | 2 |
| Endocrinology | 1 |
| Psychiatry | 1 |

| confidence | n |
|---|---|
| high | 67 |
| med | 3 |

---

## Cardiovascular (16)

| trial | PMID | yr | question | result | teaching role | guideline relationship | conf |
|---|---|---|---|---|---|---|---|
| **DELIVER** | 36027570 | 2022 | Dapagliflozin vs placebo, HF with EF >40% | ↓ worsening HF/CV death, HR 0.82 | practice-changing benefit | POSTDATES the Apr-2022 AHA/ACC/HFSA guideline (DELIVER published Sep 2022). Supports current practice; NOT evidence incorporated into that guideline. | high |
| **EAST-AFNET 4** | 32865375 | 2020 | Early rhythm control vs usual care, AF ≤1yr | ↓ composite HR 0.79; stopped early | practice-changing benefit | incorporated (2023 ACC/AHA/ACCP/HRS AF) | high |
| **CASTLE-AF** | 29385358 | 2018 | Ablation vs medical therapy, AF + HFrEF | ↓ death/HF hosp HR 0.62 | practice-changing benefit | incorporated (2023 AF guideline) | high |
| **COAPT** | 30280640 | 2018 | TEER + GDMT vs GDMT, secondary MR | ↓ HF hosp 35.8 vs 67.9%/pt-yr; ↓ mortality 29.1 vs 46.1% | practice-changing benefit | incorporated (2020 ACC/AHA VHD, Class IIa) | high |
| **CLEAR Outcomes** | 36876740 | 2023 | Bempedoic acid vs placebo, statin-intolerant | ↓ MACE HR 0.87 | practice-changing benefit | incorporated into the 2026 dyslipidemia guideline. The 2022 ACC nonstatin pathway described CLEAR Outcomes as still ONGOING. | med |
| **COLCOT** | 31733140 | 2019 | Colchicine 0.5mg post-MI | ↓ composite HR 0.77 | practice-changing benefit | incorporated (2023 CCD guideline) | high |
| **STICH** | 21463150 | 2011 | CABG + medical vs medical alone, EF ≤35% | Primary: no mortality benefit at 5y (HR 0.86, p=0.12) | important negative trial | incorporated (2021 ACC/AHA/SCAI, Class I) | high |
| **AFFIRM-AHF** | 33197395 | 2020 | IV ferric carboxymaltose post-acute HF | ↓ HF hosp RR 0.74; primary composite p=0.059 | practice-changing benefit | incorporated (2022 AHA/ACC/HFSA, Class IIa) | med |
| **LoDoCo2** | 32865380 | 2020 | Colchicine in chronic coronary disease | ↓ composite HR 0.69 | practice-changing benefit | incorporated (2023 CCD guideline, Class IIb) | high |
| **RALES** | 10471456 | 1999 | Spironolactone in NYHA III-IV HFrEF | Mortality 35 vs 46%, RR 0.70; stopped early | practice-changing benefit | incorporated (2022 AHA/ACC/HFSA) | high |
| **EPHESUS** | 12668699 | 2003 | Eplerenone post-MI with EF ≤40% | Mortality 14.4 vs 16.7%, RR 0.85; ↑ serious hyperkalemia | practice-changing benefit | incorporated (ACC/AHA MI + HF) | high |
| **COMPLETE** | 31475795 | 2019 | Complete vs culprit-only revascularization after STEMI | CV death/MI 7.8 vs 10.5%, HR 0.74 | practice-changing benefit | incorporated (2021 ACC/AHA/SCAI) | high |
| **FAME** | 19144937 | 2009 | FFR-guided vs angiography-guided PCI, multivessel | 1-yr composite 13.2 vs 18.3%, p=0.02 | diagnostic strategy | incorporated (2021 ACC/AHA/SCAI; ESC/EACTS) | high |
| **FREEDOM** | 23121323 | 2012 | CABG vs PCI in diabetes with multivessel CAD | 5-yr composite 18.7 vs 26.6% favouring CABG; stroke higher with CABG 5.2 vs 2.4% | practice-changing benefit | incorporated (2021 revascularization guideline) | high |
| **AUGUSTUS** | 30883055 | 2019 | 2x2: apixaban vs VKA, aspirin vs placebo, AF after ACS/PCI | Apixaban less bleeding HR 0.69; aspirin MORE bleeding HR 1.89 without ischemic benefit | practice-changing benefit | incorporated (2023 AF guideline) | high |
| **INVICTUS** | 36036525 | 2022 | Rivaroxaban vs VKA in rheumatic heart disease AF | Rivaroxaban WORSE (HR ~1.7 favouring VKA) | safety/harm | incorporated/reinforces existing contraindication | high |

> **DELIVER:** CORRECTED per Codex: originally claimed 'incorporated into 2022 guideline' — chronologically impossible.
>
> **CLEAR Outcomes:** CORRECTED per Codex: originally cited the 2022 pathway, which predates the result. Metadata also secondary-sourced (PubMed rate-limited).
>
> **STICH:** DECISION REQUIRED: this record is the 2011 NEUTRAL primary endpoint. The positive 10-year result is STICHES, a SEPARATE publication (NEJM 2016). Recommend TWO linked records — do not teach the 10-year result off the 2011 PMID.
>
> **AFFIRM-AHF:** Metadata secondary-sourced (PubMed rate-limited).
>
> **FAME:** FAME 2 (PMID 22924638) is a DISTINCT trial: FFR-guided PCI vs medical therapy. Do not conflate.
>

## Pulmonary (11)

| trial | PMID | yr | question | result | teaching role | guideline relationship | conf |
|---|---|---|---|---|---|---|---|
| **NOTT** | 6776858 | 1980 | Continuous vs nocturnal O2, hypoxemic COPD | Nocturnal-only mortality 1.94x continuous | practice-changing benefit | incorporated (GOLD) | high |
| **IMPACT** | 29668352 | 2018 | Single-inhaler triple vs dual, COPD | ↓ exac 15% vs ICS-LABA, 25% vs LAMA-LABA; ↑ pneumonia | practice-changing benefit | incorporated (GOLD) | high |
| **ETHOS** | 32579807 | 2020 | BGF triple at two ICS doses | ↓ exac 24% vs LAMA-LABA; ↑ pneumonia | practice-changing benefit | incorporated (GOLD) | high |
| **PEITHO** | 24716681 | 2014 | Tenecteplase in intermediate-risk PE | ↓ death/decompensation 2.6 vs 5.6% BUT major bleed 6.3 vs 1.2%, hemorrhagic stroke 2.0 vs 0.2% | safety/harm | guidelines have NOT adopted routine lysis (ACCP/ESC) | high |
| **MIST2** | 21830966 | 2011 | Intrapleural tPA+DNase, pleural infection | ↓ surgical referral 4 vs 16%; single agents ineffective | practice-changing benefit | incorporated (BTS/ACCP) | high |
| **ACURASYS** | 20843245 | 2010 | Cisatracurium 48h in severe ARDS | 90-day mortality HR 0.68 — POSITIVE | evidence reversal (positive, later contradicted) | conditional recommendation only, reflecting the ACURASYS/ROSE conflict | high |
| **DEXA-ARDS** | 32043986 | 2020 | Dexamethasone in moderate-severe ARDS | +4.8 ventilator-free days; 60-d mortality 21 vs 36% | practice-changing benefit | predates current guidance | high |
| **TORCH** | 17314337 | 2007 | Salmeterol/fluticasone vs placebo, COPD mortality | Mortality 12.6 vs 15.2%, p=0.052 — narrowly MISSED | important negative trial | incorporated (GOLD, for exacerbation reduction) | high |
| **FLAME** | 27181606 | 2016 | LABA/LAMA vs LABA/ICS, COPD | LABA/LAMA superior, RR 0.88; fewer pneumonias 3.2 vs 4.8% | practice-changing benefit | incorporated (GOLD) | high |
| **LOTT** | 27783918 | 2016 | Long-term O2 for MODERATE desaturation (SpO2 89-93%) | No benefit (HR 0.94) | important negative trial | incorporated (thresholds stay anchored to NOTT/MRC) | high |
| **HOT-HMV** | 28528348 | 2017 | Home NIV + O2 vs O2 alone after hypercapnic COPD exacerbation | Median time to readmission/death 4.3 vs 1.4 months, HR 0.49 | practice-changing benefit | incorporated (GOLD/ATS/ERS) | high |

> **ACURASYS:** CORRECTED per Codex: was mislabeled 'important negative trial'. ACURASYS was POSITIVE; ROSE contradicted it.
>

## Heme (7)

| trial | PMID | yr | question | result | teaching role | guideline relationship | conf |
|---|---|---|---|---|---|---|---|
| **AMPLIFY** | 23808982 | 2013 | Apixaban monotherapy vs enox/warfarin, acute VTE | Noninferior; major bleed 0.6 vs 1.8% | practice-changing benefit | incorporated (ASH 2020, CHEST 2021) | high |
| **CARAVAGGIO** | 32223112 | 2020 | Apixaban vs dalteparin, cancer VTE | Noninferior; NO excess GI bleeding | practice-changing benefit | incorporated (ASH/ISTH) | high |
| **TRICC** | 9971864 | 1999 | Restrictive (7) vs liberal (10) transfusion, ICU | In-hospital mortality 22.3 vs 28.1% | practice-changing benefit | incorporated (AABB) | high |
| **REALITY** | 33560322 | 2021 | Restrictive vs liberal transfusion in MI | MACE 11.0 vs 14.0%, noninferior but CI does not exclude harm | important negative trial | not settled | high |
| **TRAPS** | 30002145 | 2018 | Rivaroxaban vs warfarin, triple-positive APS | STOPPED EARLY: thrombotic events 12% vs 0% | safety/harm | incorporated (ISTH/EULAR: avoid DOACs) | high |
| **HOKUSAI-VTE Cancer** | 29231094 | 2018 | Edoxaban vs dalteparin, cancer VTE | Noninferior; ↑ major bleeding 6.9 vs 4.0%, GI-driven | practice-changing benefit | incorporated with caution (ASCO/ISTH) | high |
| **SELECT-D** | 29746227 | 2018 | Rivaroxaban vs dalteparin, cancer VTE | ↓ recurrence 4 vs 11%; ↑ CRNM bleed 13 vs 4% | practice-changing benefit | incorporated with caution | high |

## Neurology (10)

| trial | PMID | yr | question | result | teaching role | guideline relationship | conf |
|---|---|---|---|---|---|---|---|
| **WAKE-UP** | 29766770 | 2018 | Alteplase by DWI-FLAIR mismatch, unknown onset | mRS 0-1 53.3 vs 41.8%, OR 1.61 | practice-changing benefit | incorporated (AHA/ASA) | high |
| **EXTEND** | 31067369 | 2019 | Alteplase 4.5-9h by perfusion imaging | mRS 0-1 35.4 vs 29.5%; sICH 6.2 vs 0.9% | practice-changing benefit | incorporated (AHA/ASA) | high |
| **AcT** | 35779553 | 2022 | Tenecteplase vs alteplase | Noninferior; similar sICH | practice-changing benefit | incorporated into the CURRENT 2026 AHA/ASA acute ischemic stroke guideline | high |
| **CHANCE** | 23803136 | 2013 | Clopidogrel+ASA, minor stroke/TIA (China) | ↓ stroke 8.2 vs 11.7%; NO excess bleeding | practice-changing benefit | incorporated (2021 AHA/ASA) | high |
| **POINT** | 29766750 | 2018 | Clopidogrel+ASA, international | ↓ composite 5.0 vs 6.5%; major hemorrhage 0.9 vs 0.4% | safety/harm | shaped the 21-day (not 90-day) DAPT duration | high |
| **THALES** | 32668111 | 2020 | Ticagrelor+ASA, minor stroke/TIA | ↓ stroke/death 5.5 vs 6.6%; severe bleed HR 3.99; no disability-free gain | safety/harm | weaker/conditional recommendation | high |
| **SAMMPRIS** | 21899409 | 2011 | Aggressive medical therapy vs intracranial stenting | 30-day stroke/death 14.7 vs 5.8% — stenting HARMFUL; stopped early | safety/harm | incorporated (AHA/ASA) | high |
| **NASCET** | 1852179 | 1991 | CEA vs medical therapy, symptomatic ≥70% carotid stenosis | ARR 17 percentage points at 2 years; stopped early | practice-changing benefit | incorporated (AHA/ASA, vascular surgery) | high |
| **SPS3 (antiplatelet)** | 22931315 | 2012 | Clopidogrel+ASA vs ASA, recent lacunar stroke | No stroke reduction; major hemorrhage nearly DOUBLED, ↑ mortality | safety/harm | incorporated (AHA/ASA recommends against) | high |
| **NAVIGATE ESUS** | 30188630 | 2018 | Rivaroxaban vs aspirin after embolic stroke of undetermined source | No stroke reduction; major bleeding HR 2.72; stopped early | important negative trial | incorporated (AHA/ASA: no routine anticoagulation) | high |

> **AcT:** CORRECTED per Codex: previously cited a vague '2023 update'.
>
> **SPS3 (antiplatelet):** SPS3 had a SECOND randomization (BP target), reported separately: Lancet 2013, PMID 23726159. Keep distinct.
>

## GI/Hepatology (8)

| trial | PMID | yr | question | result | teaching role | guideline relationship | conf |
|---|---|---|---|---|---|---|---|
| **WATERFALL** | 36103415 | 2022 | Aggressive vs moderate fluids, acute pancreatitis | STOPPED EARLY FOR HARM: fluid overload 20.5 vs 6.3%, no efficacy gain | safety/harm | incorporated (2024 ACG/AGA) | high |
| **SONIC** | 20393175 | 2010 | Infliximab +/- azathioprine, Crohn | Steroid-free remission 56.8 / 44.4 / 30.0% | practice-changing benefit | incorporated (AGA/ACG/ECCO) | high |
| **CALM** | 29096949 | 2017 | Treat-to-target vs symptom-driven, Crohn | Mucosal healing 45.9 vs 30.3% | practice-changing benefit | underpins STRIDE-II (which is a CONSENSUS doc, not an RCT) | high |
| **CONFIRM** | 33657294 | 2021 | Terlipressin + albumin vs placebo + albumin, HRS-1 | ↑ HRS reversal, BUT significant RESPIRATORY FAILURE harm signal | safety/harm | informs AASLD guidance and the FDA label's respiratory warning | high |
| **SORT (albumin in SBP)** | 10432325 | 1999 | Albumin + cefotaxime vs cefotaxime alone, SBP | Renal impairment 10 vs 33%; in-hospital mortality 10 vs 29% | practice-changing benefit | incorporated (AASLD 2021) | high |
| **STOPAH** | 25901427 | 2015 | Prednisolone and/or pentoxifylline, severe alcohol-associated hepatitis | Prednisolone OR 0.61 at 28d (p=0.06), gone by 90d; pentoxifylline no benefit | important negative trial | incorporated (AASLD 2019) | high |
| **ATTIRE** | 33657293 | 2021 | Targeted albumin infusions, hospitalized decompensated cirrhosis | No benefit; MORE serious adverse events incl. pulmonary edema | important negative trial | incorporated (AASLD/EASL restrict albumin to specific indications) | high |
| **HALT-IT** | 32563378 | 2020 | Tranexamic acid in acute GI bleeding | No mortality benefit; ↑ VTE and seizures | safety/harm | incorporated (ACG recommends against) | high |

> **CONFIRM:** REPLACES an incorrect entry. The prior draft substituted a 1995 octreotide/sclerotherapy variceal-bleeding study — a different clinical question entirely. Caught by Codex.
>

## ID (8)

| trial | PMID | yr | question | result | teaching role | guideline relationship | conf |
|---|---|---|---|---|---|---|---|
| **REPRIEVE** | 37486775 | 2023 | Pitavastatin in HIV below statin threshold | ↓ MACE HR 0.65; stopped early | practice-changing benefit | incorporated (NIH/IDSA) | high |
| **Study 31 / A5349** | 33951360 | 2021 | 4-month rifapentine-moxi vs 6-month TB regimen | Noninferior; the non-moxifloxacin arm FAILED noninferiority | practice-changing benefit | incorporated (CDC/ATS/IDSA, WHO) | high |
| **BALANCE (bacteremia)** | 39565030 | 2025 | 7 vs 14 days antibiotics for bloodstream infection | 90-day mortality 14.5 vs 16.1%; noninferior | practice-changing benefit | incorporated (IDSA 2025 duration guidance). NOTE S. aureus was EXCLUDED. | high |
| **OVIVA** | 30699315 | 2019 | Oral vs IV antibiotics, bone and joint infection | Failure 13.2% oral vs 14.6% IV; noninferior; shorter LOS | practice-changing benefit | guidelines/practice have NOT uniformly adopted | high |
| **STOP-IT** | 25992746 | 2015 | Fixed ~4d vs physiology-guided antibiotics after source control, cIAI | Composite 21.8 vs 22.3%, no difference despite 4 vs 8 days | important negative trial | incorporated (SIS/IDSA, EAST) | high |
| **MERINO** | 30208454 | 2018 | Pip-tazo vs meropenem, ceftriaxone-resistant E. coli/Klebsiella bacteremia | 30-day mortality 12.3 vs 3.7% — pip-tazo FAILED noninferiority | safety/harm | incorporated (IDSA AMR guidance) | high |
| **SABATO** | 38244557 | 2024 | Early oral switch in LOW-RISK S. aureus bacteremia | Noninferior, but stopped early at 215/430 for slow recruitment | guideline-supporting | NOT yet a guideline-endorsed default | med |
| **DOTS** | 40802264 | 2025 | Dalbavancin (2 doses) vs standard IV therapy, complicated S. aureus bacteremia | DOOR 47.7% — did NOT meet superiority; noninferior on efficacy | guideline-supporting | too recent for the 2026 IDSA/ESCMID SAB guidance | high |

> **BALANCE (bacteremia):** DISAMBIGUATION: a different trial named BALANCE tests lithium+valproate in bipolar disorder. This is the bacteremia one.
>
> **SABATO:** Underpowered due to early stopping — flag when teaching.
>
> **DOTS:** NAMING CAVEAT: DOTS tests IV dalbavancin, NOT 'partial oral therapy' as the queue described. Confirm this is the intended trial.
>

## Critical care (6)

| trial | PMID | yr | question | result | teaching role | guideline relationship | conf |
|---|---|---|---|---|---|---|---|
| **SAFE** | 15163774 | 2004 | Albumin vs saline, ICU resuscitation | No mortality difference (RR 0.99); later TBI subgroup harm signal | safety/harm | incorporated (Surviving Sepsis) | high |
| **FACTT** | 16714767 | 2006 | Conservative vs liberal fluids in ARDS | No mortality difference; +2.5 ventilator-free days, +2.2 ICU-free days | practice-changing benefit | incorporated (ATS/ESICM/SCCM, conditional) | high |
| **CLOVERS** | 36688507 | 2023 | Early restrictive fluids/earlier pressors vs liberal, sepsis-induced hypotension | STOPPED FOR FUTILITY: 14.0 vs 14.9%, p=0.61 | important negative trial | SSC has not resolved this; CLOVERS reinforces equipoise | high |
| **CLASSIC** | 35709019 | 2022 | Restricted vs standard IV fluid, established septic shock | 90-day mortality 42.3 vs 42.1% despite 1798 vs 3811 mL | important negative trial | not yet in a formal updated recommendation | high |
| **TRISS** | 25270275 | 2014 | Transfusion threshold 7 vs 9 g/dL, septic shock | 90-day mortality 43 vs 45%; half the units | guideline-supporting | incorporated (SSC, with TRICC) | high |
| **MIND-USA** | 30346242 | 2018 | Haloperidol/ziprasidone vs placebo, ICU delirium | NO difference in days alive without delirium/coma | important negative trial | incorporated (SCCM PADIS: recommends against routine use) | high |

## Endocrinology (1)

| trial | PMID | yr | question | result | teaching role | guideline relationship | conf |
|---|---|---|---|---|---|---|---|
| **DPP** | 11832527 | 2002 | Lifestyle vs metformin vs placebo in impaired glucose tolerance | Diabetes incidence ↓58% lifestyle, ↓31% metformin | practice-changing benefit | incorporated (ADA Standards of Care) | high |

## Prevention (2)

| trial | PMID | yr | question | result | teaching role | guideline relationship | conf |
|---|---|---|---|---|---|---|---|
| **WHI (E+P)** | 12117397 | 2002 | Estrogen+progestin vs placebo, healthy postmenopausal women | Stopped early: ↑ CHD (HR 1.29), ↑ invasive breast cancer, ↑ stroke/VTE | safety/harm | incorporated (USPSTF recommends against for chronic disease prevention) | high |
| **HERS** | 9718051 | 1998 | Estrogen+progestin for SECONDARY prevention of CHD | No overall benefit (RH 0.99); early harm in year 1 | safety/harm | predates but is foundational to current guidance | high |

## Psychiatry (1)

| trial | PMID | yr | question | result | teaching role | guideline relationship | conf |
|---|---|---|---|---|---|---|---|
| **CATIE** | 16172203 | 2005 | Four SGAs vs perphenazine, chronic schizophrenia | 74% discontinued by 18 months; olanzapine longest but worst metabolic | guideline-supporting | incorporated (APA) | high |

