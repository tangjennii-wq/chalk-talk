# Decision: keep `journal_rank <= 2` as a hard filter

**Date:** 2026-07-31 · **Status:** decided, keep · **Cost:** 156 of 2,593 documents (6.0%) unreachable

`match_chunks` carries `and d.journal_rank <= max_journal_rank` with a default of 2. That is a HARD
FILTER, not a boost — excluded documents cannot be retrieved at any similarity. It had never been
deliberately decided, so this records the decision rather than continuing to inherit it.

---

## What is actually excluded

| journal_rank | documents | landmark trials | mean RCR | distinct journals | years |
|---|---|---|---|---|---|
| 1 | 499 | 52 | 43.2 | 69 | 1987–2026 |
| 2 | 1,938 | 507 | 24.2 | 812 | 1980–2026 |
| **3 (excluded)** | **156** | **0** | **10.2** | **21** | **2019–2026** |

Every one of the 21 excluded journals:

*International Journal of Molecular Sciences* (33), *Nutrients* (22), *IJERPH* (18),
*Frontiers in Immunology* (17), *Frontiers in Cellular and Infection Microbiology* (9),
*Frontiers in Endocrinology* (8), *PLoS One* (8), *Medicina (Kaunas)* (7), *Cells* (7),
*Cureus* (5), *Frontiers in Public Health* (4), *Journal of Clinical Medicine* (4),
*Scientific Reports* (4), *Medicina Clinica* (2), *Frontiers in Psychiatry* (2),
*Medicina* (1), *Frontiers in Pediatrics* (1), *Life (Basel)* (1),
*Medicinal Research Reviews* (1), *Frontiers in Physiology* (1), *Antioxidants (Basel)* (1).

## Why keep it

**Zero landmark trials.** All 559 landmark trials in the corpus sit at rank 1 or 2. Nothing excluded is
a trial a chalk talk would cite for a threshold, a dose or an outcome.

**Zero guideline documents.** Society guidance is unaffected by this filter.

**The composition is the argument.** The list is MDPI (*IJMS*, *Nutrients*, *IJERPH*, *Cells*,
*Medicina*, *Life*, *Antioxidants*), Frontiers titles, the two mega-journals (*PLoS One*,
*Scientific Reports*), and *Cureus* — which is predominantly case reports (mean RCR 2.4). For an
internal-medicine teaching talk these are basic-science, nutrition/public-health and case-report
sources. They are not what a physician should be citing for a management recommendation.

**Relative citation ratio is less than half** that of rank 2 (10.2 vs 24.2), and every excluded document
is 2019 or later — so this is not excluding older foundational work, it is excluding a recent
low-selectivity tail.

## What this decision does NOT claim

It is not a judgement that these journals publish bad science. *Frontiers in Endocrinology* and
*Journal of Clinical Medicine* carry legitimate clinical reviews, and a rank-3 paper may occasionally be
the best available source on a narrow topic. The claim is narrower: **for citation grounding in a
10-minute IM teaching talk, ranks 1–2 are sufficient, and the tail costs more in citation credibility
than it adds in coverage.**

## The condition under which to revisit

If retrieval calibration shows topics where the corpus abstains (returns nothing) *and* rank-3 documents
exist for that topic, the filter is costing real coverage and should become a boost rather than a gate.
`max_journal_rank` is already a parameter, so testing that costs one request:

```json
{"query": "<topic>", "max_journal_rank": 3}
```

Until calibration runs, keep it at 2.

**Related:** the two-stage HNSW work applies this filter AFTER candidate selection, so a restrictive
filter can empty a pool that raw similarity filled — `survivors_after_filter` is returned to make that
loss visible. See `two_stage_hnsw_retrieval.sql`.
