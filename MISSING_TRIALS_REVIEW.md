# Missing landmark trials — review queue

Generated 2026-07-21 · **read-only audit, nothing ingested**

| | |
|---|---|
| trials named across `GUIDELINES[].trials` | 219 |
| already in the verified manifest | 65 |
| **unique candidates missing** | **148** |
| manifest size | 124 |

## Rules before anything here gets ingested

1. A **canonical primary-results PMID**, verified on PubMed. Relevance search is never proof.
2. Trial-like PubMed publication type.
3. Reject protocols, design papers, statistical analysis plans, secondary/subgroup analyses, pooled analyses, reviews, editorials, and later follow-up papers unless deliberately chosen.
4. Teaching value stated: why should a resident know this trial?
5. Guideline relationship: incorporated / predates / disagrees.

Normalization is deliberately conservative — `AKIKI` vs `AKIKI-2`, `UKPDS 33` vs `UKPDS 34`, `BENEFIT` vs `BENEFIT-EXT` are different trials and must not be collapsed.

---

## Allergy/Immuno (2)

| trial (as written in guideline) | normalized | also listed under | triage | note |
|---|---|---|---|---|
| HELP | `HELP` | — | **ambiguous-name** |  |
| POSEIDON | `POSEIDON` | — | **ambiguous-name** |  |

## Cardiovascular (19)

| trial (as written in guideline) | normalized | also listed under | triage | note |
|---|---|---|---|---|
| AFFIRM-AHF | `AFFIRM-AHF` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| CASTLE-AF | `CASTLE-AF` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| CLEAR Outcomes | `CLEAR OUTCOMES` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| COAPT | `COAPT` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| COLCOT | `COLCOT` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| DELIVER | `DELIVER` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| EAST-AFNET 4 | `EAST-AFNET 4` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| EXPLORER-HCM | `EXPLORER-HCM` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| LIPID | `LIPID` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| LoDoCo2 | `LODOCO2` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| MATRIX | `MATRIX` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| PARTNER 1 | `PARTNER 1` | — | **trial-family-split** | PARTNER 1A/1B/2/3 are distinct trials |
| PARTNER 2 | `PARTNER 2` | — | **trial-family-split** | PARTNER 1A/1B/2/3 are distinct trials |
| PARTNER 3 | `PARTNER 3` | — | **trial-family-split** | PARTNER 1A/1B/2/3 are distinct trials |
| PLATO | `PLATO` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| RIVAL | `RIVAL` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| ROCKET-AF | `ROCKET-AF` | — | **alias-already-present** | ROCKET AF |
| STICH | `STICH` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| TRITON-TIMI 38 | `TRITON-TIMI 38` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |

## Dermatology (4)

| trial (as written in guideline) | normalized | also listed under | triage | note |
|---|---|---|---|---|
| PIONEER 1 | `PIONEER 1` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| PIONEER 2 | `PIONEER 2` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| SUNRISE | `SUNRISE` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| SUNSHINE | `SUNSHINE` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |

## Endocrinology (2)

| trial (as written in guideline) | normalized | also listed under | triage | note |
|---|---|---|---|---|
| CANVAS | `CANVAS` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| SURMOUNT | `SURMOUNT` | — | **trial-family-split** | umbrella; SURMOUNT-1 already present |

## GI/Hepatology (15)

| trial (as written in guideline) | normalized | also listed under | triage | note |
|---|---|---|---|---|
| CALM | `CALM` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| CONFIRM | `CONFIRM` | — | **ambiguous-name** |  |
| GEMINI | `GEMINI` | — | **trial-family-split** | GEMINI 1/2 distinct |
| LIBERTY-EoE | `LIBERTY-EOE` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| MAESTRO-NASH | `MAESTRO-NASH` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| MOTIVATE | `MOTIVATE` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| OCTAVE | `OCTAVE` | — | **trial-family-split** | OCTAVE Induction/Sustain distinct |
| SONIC | `SONIC` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| STRIDE-II | `STRIDE-II` | — | **non-rct-reclassify** | consensus treat-to-target document, not an RCT — store as guidance |
| U-ACHIEVE | `U-ACHIEVE` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| U-EXCEED | `U-EXCEED` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| U-EXCEL | `U-EXCEL` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| UNIFI | `UNIFI` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| UNITI | `UNITI` | — | **trial-family-split** | UNITI-1/2 distinct |
| WATERFALL | `WATERFALL` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |

## Heme/Onc (12)

| trial (as written in guideline) | normalized | also listed under | triage | note |
|---|---|---|---|---|
| AMPLIFY | `AMPLIFY` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| CARAVAGGIO | `CARAVAGGIO` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| EINSTEIN | `EINSTEIN` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| HERCULES | `HERCULES` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| HOKUSAI-CANCER | `HOKUSAI-CANCER` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| HOKUSAI-VTE | `HOKUSAI-VTE` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| RE-COVER | `RE-COVER` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| REALITY | `REALITY` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| STAND | `STAND` | — | **ambiguous-name** |  |
| STOP | `STOP` | — | **ambiguous-name** |  |
| TRAPS | `TRAPS` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| TRICC | `TRICC` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |

## ID (1)

| trial (as written in guideline) | normalized | also listed under | triage | note |
|---|---|---|---|---|
| REPRIEVE | `REPRIEVE` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |

## Nephrology (3)

| trial (as written in guideline) | normalized | also listed under | triage | note |
|---|---|---|---|---|
| AURORA-1 | `AURORA-1` | Rheumatology | **priority** | general-IM relevant — needs canonical primary-results PMID |
| PATHWAY-2 | `PATHWAY-2` | Cardiovascular | **priority** | general-IM relevant — needs canonical primary-results PMID |
| TEMPO 3:4 | `TEMPO 34` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |

## Neurology (19)

| trial (as written in guideline) | normalized | also listed under | triage | note |
|---|---|---|---|---|
| AcT | `ACT` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| ADAPT | `ADAPT` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| ATACH-2 | `ATACH-2` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| CHANCE | `CHANCE` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| CLARITY-AD | `CLARITY-AD` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| DELIVER-MS | `DELIVER-MS` | — | **awaiting-results** | confirm definitive primary results are published |
| EARLYSTIM | `EARLYSTIM` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| ECASS III | `ECASS III` | — | **alias-already-present** | ECASS-III |
| ESETT | `ESETT` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| EXTEND | `EXTEND` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| INTERACT2 | `INTERACT2` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| LEAP | `LEAP` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| MGTX | `MGTX` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| ORATORIO | `ORATORIO` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| POINT | `POINT` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| THALES | `THALES` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| TRAILBLAZER-ALZ-2 | `TRAILBLAZER-ALZ-2` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| TREAT-MS | `TREAT-MS` | — | **awaiting-results** | confirm definitive primary results are published |
| WAKE-UP | `WAKE-UP` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |

## Oncology (32)

| trial (as written in guideline) | normalized | also listed under | triage | note |
|---|---|---|---|---|
| ADAURA | `ADAURA` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| ARAMIS | `ARAMIS` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| ARCHES | `ARCHES` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| BEACON | `BEACON` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| CARD | `CARD` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| CARTITUDE-1 | `CARTITUDE-1` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| CHAARTED | `CHAARTED` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| CLEOPATRA | `CLEOPATRA` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| CodeBreaK 200 | `CODEBREAK 200` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| COU-AA-301 | `COU-AA-301` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| DESTINY-Breast03 | `DESTINY-BREAST03` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| FLAURA | `FLAURA` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| GRIFFIN | `GRIFFIN` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| KarMMa-3 | `KARMMA-3` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| KEYNOTE-177 | `KEYNOTE-177` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| KEYNOTE-189 | `KEYNOTE-189` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| KEYNOTE-407 | `KEYNOTE-407` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| KEYNOTE-522 | `KEYNOTE-522` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| LATITUDE | `LATITUDE` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| MONALEESA-2/3/7 | `MONALEESA-237` | — | **trial-family-split** | MONALEESA-2/3/7 distinct |
| MONARCH-2/3 | `MONARCH-23` | — | **trial-family-split** | MONARCH-2/3 distinct |
| PACIFIC | `PACIFIC` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| PALOMA-1/2/3 | `PALOMA-123` | — | **trial-family-split** | PALOMA-1/2/3 distinct |
| PERSEUS | `PERSEUS` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| PREVAIL | `PREVAIL` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| PROfound | `PROFOUND` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| PROpel | `PROPEL` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| PROSPER | `PROSPER` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| SPARTAN | `SPARTAN` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| STAMPEDE | `STAMPEDE` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| TITAN | `TITAN` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| VISION | `VISION` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |

## Ophthalmology (6)

| trial (as written in guideline) | normalized | also listed under | triage | note |
|---|---|---|---|---|
| AREDS | `AREDS` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| AREDS2 | `AREDS2` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| LiGHT | `LIGHT` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| ONTT | `ONTT` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| UKGTS | `UKGTS` | — | **specialty-deep-dive** | own curated pass; would dominate a general-IM corpus |
| UKPDS | `UKPDS` | — | **trial-family-split** | umbrella; UKPDS 33 and 34 already present |

## Prevention (3)

| trial (as written in guideline) | normalized | also listed under | triage | note |
|---|---|---|---|---|
| ARRIVE | `ARRIVE` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| ASPREE | `ASPREE` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| PREVENT cohort | `PREVENT COHORT` | — | **non-rct-reclassify** | risk-equation development/validation study — belongs under prediction evidence |

## Psychiatry (3)

| trial (as written in guideline) | normalized | also listed under | triage | note |
|---|---|---|---|---|
| EAGLES | `EAGLES` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| STAR*D | `STARD` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| TRD-IV | `TRD-IV` | — | **ambiguous-name** |  |

## Pulmonary (17)

| trial (as written in guideline) | normalized | also listed under | triage | note |
|---|---|---|---|---|
| ACURASYS | `ACURASYS` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| AMBITION | `AMBITION` | Rheumatology | **priority** | general-IM relevant — needs canonical primary-results PMID |
| ARMA | `ARMA` | — | **alias-already-present** | ARDS Network (identical paper, PMID 10793162) |
| BPaLM | `BPALM` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| CAPACITY | `CAPACITY` | — | **trial-family-split** | CAPACITY-1/2 reported together |
| DEXA-ARDS | `DEXA-ARDS` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| ETHOS | `ETHOS` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| IMPACT | `IMPACT` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| INPULSIS-1 | `INPULSIS-1` | — | **trial-family-split** | INPULSIS-1/2 reported together — one record naming both |
| INPULSIS-2 | `INPULSIS-2` | — | **trial-family-split** | INPULSIS-1/2 reported together — one record naming both |
| MIST2 | `MIST2` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| MRC | `MRC` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| NOTT | `NOTT` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| PEITHO | `PEITHO` | Heme/Onc | **priority** | general-IM relevant — needs canonical primary-results PMID |
| REDUCE | `REDUCE` | — | **ambiguous-name** |  |
| STELLAR | `STELLAR` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| Study 31 | `STUDY 31` | ID | **priority** | general-IM relevant — needs canonical primary-results PMID |

## Rheumatology (10)

| trial (as written in guideline) | normalized | also listed under | triage | note |
|---|---|---|---|---|
| BLISS-LN | `BLISS-LN` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| CARES | `CARES` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| focuSSced | `FOCUSSCED` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| GiACTA | `GIACTA` | Ophthalmology | **priority** | general-IM relevant — needs canonical primary-results PMID |
| MAINRITSAN | `MAINRITSAN` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| MIRRA | `MIRRA` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| ORAL Surveillance | `ORAL SURVEILLANCE` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| RITUXVAS | `RITUXVAS` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| SENSCIS | `SENSCIS` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |
| TULIP | `TULIP` | — | **priority** | general-IM relevant — needs canonical primary-results PMID |

