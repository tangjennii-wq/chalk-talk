# Run public-domain guideline ingestion (closes the "per [society] is parametric" gap)

## What this fixes
Right now Chalk Talk has zero ingested guideline content. Every "per KDIGO 2024" / "per USPSTF 2024" claim in a generated talk is the LLM's training-cutoff memory dressed up as a retrieved citation. After running this, the corpus will have ~60 public-domain guideline chunks that are actually retrievable.

## Constraints (preserve)
Public-domain only. From `public_domain_guidelines_checklist.md`:
- ✅ USPSTF, CDC, NIH/NHLBI/NCI, FDA DailyMed, MedlinePlus
- ✅ WHO (CC-BY-IGO), NICE (UK Crown copyright)
- ❌ KDIGO, AHA/ACC, IDSA, ADA, ATS, ASCO — copyrighted, cite-and-link only

## Highest-leverage first batch (5 USPSTF + 5 CDC + 3 NICE = 13 docs, ~30 min)

| # | Source | Doc | URL |
|---|---|---|---|
| 1 | USPSTF | Statin use for primary prevention (2022) | https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/statin-use-in-adults-preventive-medication |
| 2 | USPSTF | Breast cancer screening (2024) | https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/breast-cancer-screening |
| 3 | USPSTF | Lung cancer screening (2021) | https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/lung-cancer-screening |
| 4 | USPSTF | Aspirin for primary CV prevention (2022) | https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/aspirin-to-prevent-cardiovascular-disease-preventive-medication |
| 5 | USPSTF | Colorectal cancer screening (2021) | https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/colorectal-cancer-screening |
| 6 | CDC | STI treatment guidelines (2021) | https://www.cdc.gov/std/treatment-guidelines/ |
| 7 | CDC | Adult immunization schedule (2025) | https://www.cdc.gov/vaccines/schedules/hcp/imz/adult.html |
| 8 | CDC | Latent TB testing & treatment | https://www.cdc.gov/tb/topic/treatment/ltbi.htm |
| 9 | CDC | C. difficile infection guidelines | https://www.cdc.gov/cdiff/clinicians/index.html |
| 10 | CDC | Sepsis surveillance & adult definitions | https://www.cdc.gov/sepsis/clinicaltools/index.html |
| 11 | NICE | CKD assessment & management NG203 | https://www.nice.org.uk/guidance/ng203 |
| 12 | NICE | Heart failure (chronic) NG106 | https://www.nice.org.uk/guidance/ng106 |
| 13 | NICE | COPD management NG115 | https://www.nice.org.uk/guidance/ng115 |

## Procedure (run from `~/Developer/chalk-talk/rag/`)

```bash
# 1. Create the source-document folders
mkdir -p source_documents/{uspstf,cdc,nice} extracted

# 2. Manually save each URL above as a PDF (browser → Cmd+P → Save as PDF) into the matching folder
# Naming convention: uspstf-statin-2022.pdf, cdc-sti-2021.pdf, nice-ng203-ckd.pdf etc.

# 3. Extract text chunks from the PDFs into JSON
node extract_pdf_chunks.mjs source_documents/uspstf source_documents/cdc source_documents/nice

# (if extract_pdf_chunks.mjs doesn't exist, ingest_extracted_chunks.mjs expects pre-extracted .json files —
#  use any PDF text-extraction approach; pdftotext, pdfminer, or just hand-paste into JSON)

# 4. Run the ingestion
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY  OPENAI_API_KEY=$OPENAI_API_KEY  node ingest_extracted_chunks.mjs

# 5. Verify in Supabase SQL editor:
# SELECT source, COUNT(*) FROM document_chunks GROUP BY source;
# Should now show counts for source IN ('uspstf','cdc','nice')
```

## Expected outcome
After this runs, generating a talk on screening, prevention, primary care, STI, sepsis, CKD, HF, or COPD will pull retrieved guideline chunks into the prompt. "per USPSTF 2024" claims become source-grounded instead of parametric. Other societies (KDIGO/AHA/etc) remain parametric — that's by design (copyright posture).

## Cost
- ~13 docs × ~5 chunks each × OpenAI text-embedding-3-small ($0.02 / 1M tokens) → **~$0.01 total**. Negligible.

## Estimated time
~30 minutes manual (downloading PDFs + naming) + 5 minutes script runtime.
