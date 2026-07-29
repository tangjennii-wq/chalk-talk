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

**This is a capability inventory, not a list of mandatory stages.** Codex, 2026-07-28: Chalk Talk has a
valid, functioning RAG system. It is missing safeguards that a *broad medical scope* needs — which is a
different statement from "built wrong". The design worked well enough to expose its own limits, which is
how this is supposed to go.

**Correction:** Postgres provides native **full-text search** (`tsvector`, `tsquery`, `ts_rank`) — it does
**not** provide BM25. An earlier version of this file said otherwise.

---

## The upstream problem nobody has mentioned yet: chunk granularity

| corpus | what becomes ONE vector |
|---|---|
| landmark trials (559) | `title + "\n\n" + abstract` — **one vector per paper** |
| guidelines (84) | the whole summary — **one vector per entry** |
| PMC full-text | genuinely chunked by JATS section, ≤20/doc |

The two corpora responsible for D-1 are **one vector per document**.

**This is NOT established as a defect** (Codex, 2026-07-28 — I over-claimed it as one). A PubMed abstract
is a short, coherent retrieval unit; splitting it can strip context and produce noisier fragments than it
removes. The plausible mechanism — that a whole-abstract vector averages everything the paper covers, so
DCCT sits near anything diabetes-shaped and near nothing in particular — is a **hypothesis**, and today's
record is that two of my confident retrieval hypotheses were refuted by the first measurement.

**Re-chunk only if candidate-level evaluation demonstrates an advantage.** Not before, and never in the
same change as a ranking stage, since it would move every measurement at once.

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

## Build order (Codex, 2026-07-28)

**Build each separately. Measure candidate-level precision AND recall after every addition.** Do not merge
several into one opaque "advanced RAG" change — that is how you end up unable to say which part helped,
and this project has already spent a day separating real findings from instrument artifacts.

### Before public launch — these fix "irrelevant sources presented as grounding"

1. **Rerank against the original topic.** Stops facet scores being pooled as though they were comparable.
   *Done when:* on `absent`/`thin` topics the kept set shrinks, and `covered` topics are unharmed.
2. **Metadata filtering.** Remove letters, editorials, protocols, corrections and other weak source types;
   prefer guidelines, consensus documents, systematic reviews, primary studies. **Do not auto-exclude
   non-landmark papers** — acute topics depend on them. `source_tier` / `is_landmark_trial` already exist.
3. **Clinical-relevance gate.** Candidate-level: `directly relevant` / `adjacent-contextual` / `irrelevant`.
   Only *directly relevant* counts as topic grounding.
4. **Honest provenance.** Count only sources that passed relevance, entered the prompt, were cited in the
   final talk, and survived citation verification. *(Partly done in build 2026-07-28-02: the chip now reads
   "N papers found to cite from" rather than "Grounded in guidelines + N retrieved sources".)*

### Strongly recommended soon — this one fixes *missing coverage*, a different problem

5. **Conditional live PubMed fallback.** Only after local retrieval fails the relevance gate — never every
   generation. Verify identifier, metadata, relevance and claim support. **Identity is not relevance.**
6. **Exact keyword / entity search.** For acronyms, diseases, trials and drug names that vector search
   blurs. Start with Postgres `ts_rank`; BM25 can wait.
7. **Rank fusion.** Required once both rails exist. Reciprocal Rank Fusion combines by RANK, not score —
   which matters here specifically, because the diagnostic proved scores from different facet queries are
   not comparable, and RRF is immune to that by construction.

```
rerank → metadata filter → relevance gate → verify on labeled topics
      → conditional PubMed fallback → keyword search → rank fusion
```

Keyword search and fusion could move ahead of the fallback, but **they cannot retrieve evidence that does
not exist locally.** Steps 1–3 fix irrelevant sources being presented as grounding; step 5 fixes absent
coverage. Different problems, different fixes.

### Not yet

- Re-chunking every abstract (see above — unproven)
- Automatic expansion to hundreds of guidelines
- A BM25 extension
- Any single change containing several of the stages above

---

## BM25 vs Postgres full-text — accurate terminology

Postgres ships `tsvector`/`tsquery`/`ts_rank`, which is TF-IDF-family. **True BM25 needs an extension**
(`pg_search`/ParadeDB) **or a separate implementation.** BM25 would be better eventually for two reasons
specific to this corpus — `k1` saturates term frequency, so DCCT's long abstract repeating "diabetes"
stops accumulating score; `b` normalizes length, which matters when short guideline summaries sit beside
long trial abstracts. But `ts_rank` first: most of the win is having *any* lexical signal, and the
extension question (does Supabase permit it on this plan?) can be answered later.

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
