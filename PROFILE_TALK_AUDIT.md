# Profile Talk Audit — which of my talks are legit?

**Run:** 2026-07-17 · account `tangjennii@gmail.com` · 69 talks total, **31 public/featured**
**Method:** every reference in `talk_json->references` scored against the same rules as the new citation-confidence gate. PMIDs read from the `pmid` field *and* extracted from `pubmed.ncbi.nlm.nih.gov/NNNN` URLs.

## What the tiers mean

| tier | test | renders a chip? | what it actually means |
|---|---|---|---|
| **high** | PMID exists in your retrieval store (`documents`) | yes | genuinely grounded — we retrieved this source |
| **medium** | has a PMID or URL, but not in the store | yes | **not fake — unverified by us.** Reader can click through and check |
| **low** | no PMID, no URL at all | **no chip (new gate)** | nothing backs it; uncited teaching claim |

`medium` is the honest middle: mostly society-guideline URLs and real PMIDs we never ingested (the store is 100% PubMed, zero guidelines).

## Headline numbers — all 69 talks

| tier | refs | % |
|---|---|---|
| high (grounded in store) | 87 | 15.8% |
| medium — real PMID, not in store | 97 | 17.6% |
| medium — URL only (mostly guidelines) | 236 | 42.8% |
| **low — no identifier** | **131** | **23.8%** |

**~1 in 4 references across your profile has no identifier at all.** Those 131 sit in 26 talks. After you push the new build they silently lose their chips and drop out of the References block — the talk still *reads* fine, but the claim is uncited.

## The 31 public talks

**16 are clean (0% uncited) — safe to show as-is.**

**Best demo candidates** (cleanest *and* best-grounded — use these on camera):

| talk | refs | high | uncited |
|---|---|---|---|
| **Diuretic Classes in Heart Failure** | 11 | **11** | 0 |
| **Anticoagulation in Paroxysmal AF (CHA2DS2-VASc 2)** | 6 | 5 | 0 |
| **AKI in the Hospitalized Patient** | 5 | 4 | 0 |
| **Metabolic Acidosis: Physiology to Work-up** | 3 | 3 | 0 |
| **Lupus Nephritis** | 6 | 3 | 0 |

Diuretic Classes is the standout — 11/11 grounded, nothing uncited. That's your demo talk.

**15 have uncited references. Fix or unpublish before launch:**

| talk | refs | uncited | % |
|---|---|---|---|
| **Infective Endocarditis** | 7 | **7** | **100%** |
| **Peritoneal Dialysis** | 7 | **7** | **100%** |
| Crohn's Disease | 10 | 7 | 70% |
| Immune Checkpoint Inhibitor Toxicity | 8 | 5 | 63% |
| Ulcerative Colitis | 11 | 6 | 55% |
| HRS Type I & II | 14 | 7 | 50% |
| Febrile Neutropenia | 8 | 4 | 50% |
| Septic Arthritis | 13 | 6 | 46% |
| TTP | 16 | 5 | 31% |
| CKD & GDMT | 12 | 3 | 25% |
| Atrial Fibrillation | 4 | 1 | 25% |
| ACS Complications | 10 | 2 | 20% |
| Hyponatremia: A Deep Dive | 21 | 3 | 14% |
| Sjögren's Disease | 7 | 1 | 14% |
| Acute Myeloid Leukemia | 12 | 1 | 8% |

The top two are the urgent ones: **every single reference is unbacked.** Both are featured.

## Also worth knowing

- **Duplicates are published.** Two `Infective Endocarditis` (one 100% uncited, one clean) and two `Kidney Transplant Immunosuppression`. Unpublish the weaker copy of each.
- **Only 15.8% grounded is a store-coverage problem, not a quality problem.** Your store is PubMed-only. Once guidelines are ingested, a large share of the 236 URL-only refs should promote from medium to high automatically — no talk edits needed.

## Recommended actions before launch

1. **Unpublish** `Infective Endocarditis` (the 100%-uncited copy) and `Peritoneal Dialysis` — 14 unbacked refs between them, both featured.
2. **Unpublish or regenerate** the 6 talks over 45% uncited (Crohn's, ICI Toxicity, UC, HRS, Febrile Neutropenia, Septic Arthritis).
3. **Deduplicate** the two IE and two Kidney Transplant entries.
4. **Demo from** Diuretic Classes in Heart Failure.
5. Leave the sub-25% ones — the new gate handles them gracefully (chip disappears, claim stays as normal teaching prose).
