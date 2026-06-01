# Public-Domain Guidelines — Safe-to-Bulk-Ingest Checklist

> Copyright posture: bulk-ingest only sources that are **US federal works** (public domain by 17 USC § 105), **WHO** (CC-BY-IGO 3.0 with attribution), or **NICE** (UK Crown copyright with free non-commercial reuse + attribution). Everything else (KDIGO/AHA/ACC/IDSA/ADA/ATS/CHEST/AASLD/ASCO/ACR/AAN/AASM/etc.) is cite-only at the corpus level, and goes through the **v2 per-user upload** path if a user wants full-text retrieval from their own legitimately-obtained copy.

## Workflow

1. Download PDFs/HTML from the official source listed below.
2. Drop them in `rag/source_documents/<society>/` (e.g. `rag/source_documents/uspstf/`).
3. Run the `guideline-researcher` sub-agent on each file. It outputs a JSON array of chunks.
4. Save those JSONs in `rag/extracted/`.
5. `node rag/ingest_extracted_chunks.mjs rag/extracted/` — the script refuses to ingest anything off the allowlist.

---

## Tier-A targets (start here — high impact across the ABIM blueprint)

### USPSTF — preventive care
United States Preventive Services Task Force. **Public domain (US federal).** A/B/C/D/I grades map directly onto `recommendation_grade` and are pure gold for primary care + IM boards.
- Cardiovascular: statin primary prevention (2022), aspirin primary prevention (2022), BP screening (2021), AAA screening (2019)
- Cancer screening: colorectal (2021), breast (2024), cervical (2018), lung (2021), prostate (2018), skin (2023)
- Metabolic: T2DM screening (2021), prediabetes/T2DM behavioral interventions (2024)
- Infection: HIV screening (2019), HBV screening (2020), HCV screening (2020), latent TB (2023), STI behavioral counseling (2020)
- Other: depression screening adults (2023), anxiety screening adults (2023), unhealthy alcohol use (2018), tobacco cessation (2021), osteoporosis (2018), falls in older adults (2024), cognitive impairment (2020)
- Source: https://www.uspreventiveservicestaskforce.org/uspstf/topic_search_results?topic_status=P

### CDC — infectious disease, immunization, public health
US federal — **public domain.**
- ACIP adult immunization schedule (annual)
- STI treatment guidelines (2021)
- HIV PrEP / PEP (2021 update + ongoing MMWR)
- TB treatment (2016 + 2020/2022 updates) — drug-susceptible & latent
- C. difficile (CDC + IDSA — use only the CDC summary pages, not IDSA full text)
- Healthcare-associated infections (CLABSI, CAUTI, SSI, VAP prevention bundles)
- COVID-19 / influenza / RSV clinical management guidance (MMWR)
- Travel medicine — Yellow Book chapters (relevant to IM)
- Source: https://www.cdc.gov/ + MMWR archive

### NIH / NHLBI / NIDDK / NCI / NIAID — specialty federal
US federal — **public domain.**
- NHLBI asthma EPR-4 / 2020 focused update
- NHLBI sickle cell disease management (2014, with updates)
- NHLBI sleep apnea (where federally authored)
- NIDDK CKD evaluation/management (patient + clinician pages, federal authorship)
- NIDDK diabetes pages (federal authorship — not ADA Standards of Care)
- NCI PDQ adult treatment summaries (oncology — health-professional version, public domain)
- NIAID anaphylaxis & food allergy guidelines where federally authored
- NIH/NIAID HIV antiretroviral guidelines (https://clinicalinfo.hiv.gov) — public domain
- NIH COVID-19 Treatment Guidelines (archived — public domain)
- Source: https://clinicalinfo.hiv.gov, https://www.nhlbi.nih.gov, https://www.niddk.nih.gov, https://www.cancer.gov/publications/pdq

### FDA DailyMed / Drug Labels
Public domain. Useful for boxed warnings, contraindications, indication language, mechanism summaries.
- Top 200 prescribed drugs in IM (statins, anticoagulants, antihypertensives, SGLT2/GLP-1, antibiotics, immunosuppressants, biologics)
- Source: https://dailymed.nlm.nih.gov

### MedlinePlus / NLM
Public domain. Patient-level but useful for plain-language teaching framing.
- Source: https://medlineplus.gov

### WHO — global health, ID, TB, malaria, sepsis
**CC-BY-IGO 3.0** — free reuse with attribution. Capture `source="WHO"` and the doc URL; the ingest script will surface attribution at retrieval.
- WHO consolidated TB guidelines (2022)
- WHO HIV treatment guidelines
- WHO malaria treatment guidelines
- WHO sepsis recommendations
- WHO COVID-19 clinical management (final 2023)
- Source: https://www.who.int/publications

### NICE (UK)
**UK Crown copyright** — free reuse for non-commercial education with attribution. Capture `source="NICE"` and URL.
- NICE asthma (NG80, NG245)
- NICE COPD (NG115)
- NICE T2DM (NG28)
- NICE CKD (NG203)
- NICE atrial fibrillation (NG196)
- NICE chronic heart failure (NG106)
- NICE hypertension (NG136)
- NICE sepsis (NG51)
- NICE acute kidney injury (NG148)
- NICE pneumonia (NG138, CG191)
- NICE bronchiectasis, ILD, OSA where applicable
- Source: https://www.nice.org.uk/guidance

---

## EXPLICITLY EXCLUDED from bulk ingest (cite-only at corpus level)

These are **all copyrighted by their issuing societies**. They appear as inline `PMID` citations or external links, but the full text never enters the bulk-ingest corpus. If a user wants RAG over them, they must upload their own legitimately-obtained copy via the v2 per-user upload flow.

- **KDIGO** (nephrology — CKD, AKI, glomerular disease, transplant, MBD)
- **AHA / ACC** (cardiology — HF, ACS, AFib, lipids, HTN, valve, prevention)
- **IDSA** (ID — pneumonia, UTI, endocarditis, C. diff, candidemia, neutropenic fever, ABSSSI, OPAT)
- **ATS / CHEST** (pulm/CC — pneumonia, COPD, ILD, sepsis, VTE, sleep)
- **ADA** Standards of Care (diabetes — annual)
- **AASLD** (hepatology — HCV, HBV, NAFLD/MASLD, cirrhosis, HCC, autoimmune liver)
- **ASCO / NCCN** (oncology — except NCI PDQ which IS public domain)
- **ACR** (rheumatology — RA, lupus, gout, vasculitis, ANCA, OA)
- **AAN** (neurology — stroke, MS, epilepsy, dementia, headache)
- **AASM** (sleep medicine)
- **AAAAI / ACAAI** (allergy/immunology)
- **AGA / ACG** (GI — IBD, IBS, pancreatitis, GERD, GIB)
- **ESC / ERS / EASL / EASD** (European societies — same posture)
- **ASH** (hematology — VTE, anticoagulation, ITP, sickle cell beyond NHLBI)
- **Surviving Sepsis Campaign** (SCCM/ESICM joint — copyrighted)
- **UpToDate / DynaMed / StatPearls / Medscape** — never, full stop.

---

## Audit script

After ingest, re-run the coverage audit to see which subspecialties moved from `thin → good` or `good → excellent`:

```bash
node rag/audit_coverage.mjs
```

Guideline chunks should bump the tier-1 count meaningfully for cardio, ID, pulm, endo, prev care, and onco.
