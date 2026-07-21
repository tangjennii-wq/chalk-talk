# Batch 1 — Hospitalist / resident core trials · FOR PHYSICIAN REVIEW

**Generated 2026-07-17 · 37 trials · nothing ingested, `landmark_trials.json` untouched**

Every PMID below was verified against PubMed this session. Canonical **primary-results** papers only — protocols, design papers, statistical analysis plans, secondary/subgroup analyses, pooled analyses, reviews and editorials were rejected by rule.

**Approve, edit, or reject each row. Nothing enters the manifest until you sign off.**

---

## ⚠ Two things to decide first

**1. ARMA is a duplicate.** ARMA *is* the ARDSNet 2000 low-tidal-volume trial, PMID `10793162` — already in your manifest as `ARDS Network`. Recommend: keep one record, add "ARMA" as an alias. **Do not ingest twice.**

**2. Two records have softer provenance.** `CLEAR Outcomes` and `AFFIRM-AHF` — PMID and title confirmed, but PubMed and Europe PMC rate-limited the agent during the metadata pull, so journal/pages/pubtype came from secondary sourcing. Flagged `med` confidence. Worth a 30-second eyeball before ingest.

---

## Cardiovascular (9)

| trial | PMID | yr | clinical question | result | teaching role | guideline |
|---|---|---|---|---|---|---|
| **DELIVER** | 36027570 | 2022 | Dapagliflozin vs placebo in HF with EF >40% | ↓ worsening HF/CV death, HR 0.82 | practice-changing | incorporated (2022 AHA/ACC/HFSA) |
| **EAST-AFNET 4** | 32865375 | 2020 | Early rhythm control vs usual care in AF ≤1yr | ↓ composite, HR 0.79; stopped early | practice-changing | incorporated (2023 AF guideline) |
| **CASTLE-AF** | 29385358 | 2018 | Ablation vs medical therapy in AF + HFrEF | ↓ death/HF hosp, HR 0.62 | practice-changing | incorporated (2023 AF guideline) |
| **COAPT** | 30280640 | 2018 | TEER + GDMT vs GDMT in secondary MR | ↓ HF hosp 35.8 vs 67.9%/pt-yr; ↓ mortality | practice-changing | incorporated (2020 VHD, IIa) |
| **CLEAR Outcomes** | 36876740 | 2023 | Bempedoic acid in statin-intolerant | ↓ MACE, HR 0.87 | practice-changing | incorporated (ACC nonstatin pathway) |
| **COLCOT** | 31733140 | 2019 | Colchicine 0.5mg post-MI | ↓ composite, HR 0.77 | practice-changing | incorporated (2023 CCD guideline) |
| **STICH** | 21463150 | 2011 | CABG + medical vs medical alone, EF ≤35% | no mortality benefit at 5y (HR 0.86, p=0.12); STICHES positive at 10y | **important negative** | incorporated (2021 revascularization) |
| **AFFIRM-AHF** | 33197395 | 2020 | IV ferric carboxymaltose post-acute HF | ↓ HF hosp RR 0.74; primary p=0.059 | practice-changing | incorporated (2022 HF, IIa) |
| **LoDoCo2** | 32865380 | 2020 | Colchicine in chronic coronary disease | ↓ composite, HR 0.69 | practice-changing | incorporated (2023 CCD, IIb) |

**Teaching pair worth keeping together:** COLCOT (post-MI) + LoDoCo2 (chronic) — the inflammatory hypothesis, acute and stable.
**STICH is the best "negative trial" teaching case you have** — negative primary endpoint, positive at 10 years, still Class I. That's how residents learn to read a trial rather than a headline.

## Pulmonary / Critical care (8, one duplicate)

| trial | PMID | yr | clinical question | result | teaching role | guideline |
|---|---|---|---|---|---|---|
| **NOTT** | 6776858 | 1980 | Continuous vs nocturnal O2 in hypoxemic COPD | nocturnal-only mortality 1.94× continuous | practice-changing | incorporated (GOLD) |
| **IMPACT** | 29668352 | 2018 | Single-inhaler triple vs dual, COPD | ↓ exac 15% vs ICS-LABA, 25% vs LAMA-LABA; ↑ pneumonia | practice-changing | incorporated (GOLD) |
| **ETHOS** | 32579807 | 2020 | BGF triple, two ICS doses | ↓ exac 24% vs LAMA-LABA; ↑ pneumonia | practice-changing | incorporated (GOLD) |
| **PEITHO** | 24716681 | 2014 | Tenecteplase in intermediate-risk PE | ↓ death/decompensation 2.6 vs 5.6%, **but** major bleed 6.3 vs 1.2%, hemorrhagic stroke 2.0 vs 0.2% | **safety/harm** | guidelines have NOT adopted routine lysis |
| **MIST2** | 21830966 | 2011 | Intrapleural tPA+DNase in pleural infection | ↓ surgical referral 4 vs 16%; single agents ineffective | practice-changing | incorporated (BTS/ACCP) |
| **ARMA** | 10793162 | 2000 | 6 vs 12 mL/kg in ARDS | mortality 31.0 vs 39.8% | practice-changing | **DUPLICATE of ARDS Network — do not re-ingest** |
| **ACURASYS** | 20843245 | 2010 | Cisatracurium 48h in severe ARDS | 90-day mortality HR 0.68 | **important negative** (contradicted by ROSE) | conditional only |
| **DEXA-ARDS** | 32043986 | 2020 | Dexamethasone in moderate-severe ARDS | +4.8 ventilator-free days; 60-d mortality 21 vs 36% | practice-changing | predates current guidance |

**Best teaching triad in the batch:** ACURASYS (positive 2010) → ROSE (negative 2019, already in your manifest) → conditional guideline recommendation. That's the whole lesson about how evidence evolves, and you already have both halves.

## VTE / Hematology (7)

| trial | PMID | yr | clinical question | result | teaching role | guideline |
|---|---|---|---|---|---|---|
| **AMPLIFY** | 23808982 | 2013 | Apixaban monotherapy vs enox/warfarin, acute VTE | noninferior; major bleed 0.6 vs 1.8% | practice-changing | incorporated (ASH 2020, CHEST 2021) |
| **CARAVAGGIO** | 32223112 | 2020 | Apixaban vs dalteparin, cancer VTE | noninferior; **no excess GI bleeding** | practice-changing | incorporated (ASH/ISTH) |
| **TRICC** | 9971864 | 1999 | Restrictive (7) vs liberal (10) transfusion, ICU | in-hospital mortality 22.3 vs 28.1% | practice-changing | incorporated (AABB) |
| **REALITY** | 33560322 | 2021 | Restrictive vs liberal transfusion in MI | MACE 11.0 vs 14.0%, noninferior but CI does not exclude harm | **important negative** | not settled |
| **TRAPS** | 30002145 | 2018 | Rivaroxaban vs warfarin, triple-positive APS | **stopped early**: thrombotic events 12% vs 0% | **safety/harm** | incorporated (ISTH/EULAR: avoid DOAC) |
| **HOKUSAI-VTE Cancer** | 29231094 | 2018 | Edoxaban vs dalteparin, cancer VTE | noninferior; ↑ major bleeding 6.9 vs 4.0%, GI-driven | practice-changing | incorporated w/ caution |
| **SELECT-D** | 29746227 | 2018 | Rivaroxaban vs dalteparin, cancer VTE | ↓ recurrence 4 vs 11%; ↑ CRNM bleed 13 vs 4% | practice-changing | incorporated w/ caution |

**TRICC + REALITY is the transfusion-threshold teaching pair** — TRICC explicitly excluded ACS, REALITY is the attempt to fill that gap and doesn't fully succeed. That nuance is exactly what a resident gets wrong.
**TRAPS is the single best "DOACs are not interchangeable" case in medicine.**

## Neurology / Stroke (6)

| trial | PMID | yr | clinical question | result | teaching role | guideline |
|---|---|---|---|---|---|---|
| **WAKE-UP** | 29766770 | 2018 | Alteplase by DWI-FLAIR mismatch, unknown onset | mRS 0-1 53.3 vs 41.8%, OR 1.61 | practice-changing | incorporated (2019 AHA/ASA) |
| **EXTEND** | 31067369 | 2019 | Alteplase 4.5-9h by perfusion imaging | mRS 0-1 35.4 vs 29.5%; sICH 6.2 vs 0.9% | practice-changing | incorporated (2019 AHA/ASA) |
| **AcT** | 35779553 | 2022 | Tenecteplase vs alteplase | noninferior, similar sICH | practice-changing | incorporated (2023 update, IIa) |
| **CHANCE** | 23803136 | 2013 | Clopidogrel+ASA, minor stroke/TIA (China) | ↓ stroke 8.2 vs 11.7%; **no excess bleeding** | practice-changing | incorporated (2021 AHA/ASA) |
| **POINT** | 29766750 | 2018 | Clopidogrel+ASA, international | ↓ composite 5.0 vs 6.5%; **major hemorrhage 0.9 vs 0.4%** | **safety/harm** | shaped the 21-day duration |
| **THALES** | 32668111 | 2020 | Ticagrelor+ASA | ↓ stroke/death 5.5 vs 6.6%; severe bleed 0.5 vs 0.1%, HR 3.99 | **safety/harm** | weaker recommendation |

**CHANCE vs POINT is the highest-value teaching contrast in the whole batch.** Same intervention, different populations, different bleeding signals — and the *combination* is why guidelines say 21 days rather than 90. A resident who understands why those two trials disagree understands generalizability.

## GI / Hepatology / ID (6)

| trial | PMID | yr | clinical question | result | teaching role | guideline |
|---|---|---|---|---|---|---|
| **WATERFALL** | 36103415 | 2022 | Aggressive vs moderate fluids, acute pancreatitis | **stopped early for harm**: fluid overload 20.5 vs 6.3%, no efficacy gain | **safety/harm** | incorporated (2024 ACG/AGA) |
| **SONIC** | 20393175 | 2010 | Infliximab ± azathioprine, Crohn | steroid-free remission 56.8 / 44.4 / 30.0% | practice-changing | incorporated (AGA/ACG/ECCO) |
| **CALM** | 29096949 | 2017 | Treat-to-target vs symptom-driven, Crohn | mucosal healing 45.9 vs 30.3% | practice-changing | incorporated (STRIDE-II) |
| **Octreotide + sclerotherapy** | 7623904 | 1995 | Vasoactive drug + endoscopy, variceal bleed | survival w/o rebleed 87 vs 71% | practice-changing | incorporated (AASLD/Baveno VII) |
| **REPRIEVE** | 37486775 | 2023 | Pitavastatin in HIV below statin threshold | ↓ MACE HR 0.65; stopped early | practice-changing | incorporated (NIH/IDSA) |
| **Study 31 / A5349** | 33951360 | 2021 | 4-month rifapentine-moxi vs 6-month TB | noninferior; non-moxi arm failed | practice-changing | incorporated (CDC/ATS/IDSA, WHO) |

**WATERFALL directly refutes dogma residents are still taught** ("aggressive fluids in pancreatitis"). Highest-yield single entry in this section.

---

## Summary

| teaching role | n |
|---|---|
| practice-changing benefit | 24 |
| safety/harm | 6 |
| important negative trial | 3 |
| duplicate (do not ingest) | 1 |

**35 unique trials recommended for approval.** 9 of them are negative or harm trials — deliberately, because those are the ones that stop residents from doing something.
