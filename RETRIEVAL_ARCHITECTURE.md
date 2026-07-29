# Retrieval architecture — target pipeline and current state

Target (Codex, 2026-07-28):

```
Topic
  ↓
Facet queries
  ↓
Vector search + exact keyword/entity search
  ↓
Rank fusion
  ↓
Rerank against the original topic
  ↓
Metadata + clinical-relevance filter
  ↓
If insufficient: live PubMed fallback
  ↓
Verified relevant sources → Opus
```

---

## What exists today

| stage | state | detail |
|---|---|---|
| Topic | ✅ | user string |
| Facet queries | ✅ | 4 facets, `index.html` `retrieveRAG` |
| Vector search | ✅ | Supabase pgvector, `match_chunks`, `text-embedding-3-small` @ 1536 |
| **Exact keyword / entity search** | ❌ **absent** | no `tsvector`, no `to_tsquery`, no GIN index, no BM25 — verified by grep |
| **Rank fusion** | ❌ **absent** | nothing to fuse |
| **Rerank against original topic** | ❌ **absent** | facet scores are pooled directly |
| Metadata filter | ⚠️ partial | `source_tier` and `is_landmark_trial` **exist as columns** but are never used to filter |
| **Clinical-relevance filter** | ❌ absent | |
| **Live PubMed fallback** | ⚠️ built elsewhere | the update-check does exactly this well; not wired into generation |
| Verified sources → Opus | ⚠️ | PMIDs verified for *identity*; nothing checks topic relevance |

**Six of ten stages are missing or unused.** The two that are absent AND cheap — keyword search and rank
fusion — are the ones Postgres provides natively.

---

## The upstream problem nobody has mentioned yet: chunk granularity

| corpus | what becomes ONE vector |
|---|---|
| landmark trials (559) | `title + "\n\n" + abstract` — **one vector per paper** |
| guidelines (84) | the whole summary — **one vector per entry** |
| PMC full-text | genuinely chunked by JATS section, ≤20/doc |

The two corpora responsible for D-1 are **one vector per document**. A whole-abstract embedding is an
average of everything the paper discusses: DCCT's vector averages type 1 diabetes, intensive insulin,
retinopathy, nephropathy and neuropathy into a single point that sits near anything diabetes-shaped and
near nothing in particular. **A single averaged vector has no way to express that "ketoacidosis" is
absent.** This sits upstream of every stage above, and re-chunking would change every measurement — so it
must not be done in the same change as anything else.

---

## Why the missing keyword rail matters specifically here

Dense retrieval is strong on synonyms and weak on exact rare terms. Lexical retrieval is the reverse.
**Medicine is mostly exact rare terms.** Chalk Talk currently has only the half that ignores them, which
is why the DKA query cannot notice that "ketoacidosis" appears zero times in the DCCT abstract.

That is a *different* failure from the one the rerank fixes:

- **Rerank** fixes cross-query score pooling — the reason an off-topic valvular guideline scored 0.612
  against HFrEF, higher than anything DKA produced from any facet.
- **Keyword + fusion** fixes blindness to specific terminology.

Same symptom, two independent causes. Fixing one will not fix the other.

---

## Implementation order

**One stage at a time, each measured against `rag/eval_rerank.mjs` on the calibration split.** Landing
two together makes attribution impossible, and this project has already spent a day distinguishing real
findings from instrument artifacts.

1. **Rerank against the bare topic.** No schema change, no ingestion. Biggest expected precision win.
   *Done when:* on `absent` topics the kept set shrinks toward zero, and `covered` topics are unharmed.
2. **Entity/alias gate.** Requires the condition or a recognised synonym in title/text. Blocks a general
   diabetes paper from passing on a DKA topic. Alias table already drafted in `rag/eval_rerank.mjs`.
   *Done when:* DKA keeps nothing from the diabetes cluster, HFrEF keeps its trials.
3. **Metadata filter.** Prefer guidelines, consensus statements, systematic reviews, primary trials.
   Exclude editorials, letters, protocols, corrections. **Do not auto-exclude non-landmark papers** —
   acute topics depend on them. Columns already exist.
4. **Keyword index + rank fusion.** Postgres `tsvector` + GIN, fused with the vector rail (RRF).
   Migration plus a fusion step; no new infrastructure.
5. **Clinical-relevance classifier.** One narrow question — *does this source directly support diagnosis,
   treatment, mechanism, prognosis or a guideline recommendation for this topic?* Returns only
   `relevant` / `possibly relevant` / `irrelevant` plus the facet. Small and safe; it never writes content.
6. **Conditional live PubMed fallback.** Only when too few candidates survive — never every generation.
   Verify PMID/DOI identity, then run the same relevance classifier. **Identity is not relevance**, and
   conflating them trades a relevance problem for a fabrication problem.
7. **Diversity/authority selection.** 1–2 current guidelines, 1 systematic review, 2–4 primary studies;
   separate diagnostic / treatment / outcome coverage. Not eight variants of the same evidence.
8. **Fail honestly.** If nothing survives, return no papers and say so: *"No topic-specific sources were
   retrieved; verify clinical details independently."* The model may still teach from general knowledge.
9. **Accurate provenance.** Count only sources that entered the prompt, passed relevance, were cited in
   the final talk, and survived citation verification. *(Partly done: build 2026-07-28-02 already
   replaced "Grounded in guidelines + N retrieved sources" with "N papers found to cite from".)*

Re-chunking the abstracts is a **separate track**, sequenced after 1–4 so it can be measured against a
stable pipeline.

---

## Non-negotiables carried from the diagnostic

- **Never compare or pool raw scores produced against different facet queries.** Cosine against
  "X treatment, management and guideline recommendations" is not the same quantity as cosine against "X".
- **No global cosine threshold can establish relevance.** Proven: the HFrEF control's top chunk anywhere
  was an off-topic valvular guideline at 0.612 — higher than every DKA chunk from every facet.
- **Decide strategy on the calibration split; confirm once on held-out.** Looking at held-out early
  spends the only unbiased check available.
- **Entity-hit counts are a proxy** from an incomplete alias table. They rank strategies against each
  other. A physician labelling candidates is what makes it a precision measurement.
- **Returning nothing is a correct answer** when the corpus holds nothing. A stage that keeps fewer items
  on an `absent` topic has succeeded.

---

## Immediate corpus additions (independent of the pipeline)

Three entries, and the completion test is **retrieval, not insertion**:

1. 2024 ADA/EASD/AACE/JBDS/DTS Hyperglycemic Crises Consensus — PMID 39052901, DOI 10.2337/dci24-0032
2. Endocrine Society, hypercalcemia of malignancy — PMID 36545746, DOI 10.1210/clinem/dgac621
3. Fifth International Workshop, primary hyperparathyroidism — PMID 36245251, DOI 10.1002/jbmr.4677

Hypercalcemia is not one disease; without (3) the commonest outpatient pathway stays uncovered. After
ingestion, query DKA, HHS, hypercalcemia of malignancy and primary hyperparathyroidism, confirm the right
guideline appears in the top results, then generate one talk of each and inspect what actually reached
the prompt and the final references.
