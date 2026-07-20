# Provenance-Gated Citation Confidence — Spec

**Status:** draft for review (no code written yet)
**Author:** Jenni + Claude, 2026-07-17
**Fixes:** refine invents references; `[N]` chips decorate uncited model-knowledge claims with false authority.
**Relationship to Codex's "source discipline" proposal:** this is items **#3 (source hierarchy)** and **#5 (citation confidence)** collapsed into one keystone feature. #1 currency, #2 do-not-teach, #4 topic packs, #6 review queue are explicitly **out of scope here** (see Non-Goals) — they depend on the metadata this introduces.

---

## 1. Problem

Today `renderCite()` renders a `[N]` chip for **any** reference whose id resolves in the references array. It never asks *where that reference came from*. So a claim the model produced from memory — during generation or, worse, during **refine** (which does no RAG and no web search) — can carry a chip that looks identical to one backed by a retrieved trial. The July 2026 audit showed this is not hypothetical: ~37/184 guideline entries were fabricated, and refine can mint new ones live.

The app already *knows* provenance — it just throws the signal away after using it to prune. `pruneFakeReferences()` computes, per reference:

- `isRetrieved` — `r.pmid` is in `S.ragChunks` (actually pulled from the vector store)
- `src_verified === "pubmed"` — PMID resolved against NCBI eutils
- `src_verified === "paste"` — identifier was verbatim in the user's pasted feedback, PubMed unreachable (fail-open)
- `isUserUpload` — user handed us the source
- `bodyMentions` — the source string appears in prose but with **no** resolvable identifier and **no** retrieval

That is a confidence ladder in all but name.

## 2. Core idea

Every reference carries a **persisted** `confidence` and a `provenance` reason. A `[N]` chip renders **only** for `high` or `medium`. `low` (model-knowledge, no resolvable identifier, not retrieved) renders as **plain text — no chip**. Confidence is assigned once at finalize and **stored on the ref**, not recomputed at render (critical: a reloaded talk has an empty `S.ragChunks`, so retrieval provenance cannot be recomputed later — it must be baked in).

## 3. Confidence ladder

| confidence | provenance reasons | chip? |
|---|---|---|
| **high** | `retrieved` (matched a chunk in `S.ragChunks` by **pmid, url, or title**) · `pubmed_verified` (`src_verified="pubmed"`) · `user_upload` | yes |
| **medium** | `paste_asserted` (`src_verified="paste"`, unresolved) · `identifier_only` (has a pmid/url the reader can check, but no session grounding) | yes |
| **low** | `model_knowledge` (no resolvable identifier, not retrieved) | **no chip — plain text** |

> **A bare `society` string is deliberately NOT sufficient for `high`.** A fabricated guideline (e.g. the audit's `AAN/AAOS Anti-Amyloid` — AAOS is the *orthopaedic* academy) carries a society field that looks identical to a real one, so trusting it would reopen the exact hole this feature exists to close. Real guidelines still reach `high` via the `retrieved` match on url/title — guideline chunks usually have no pmid, which is why matching is not pmid-only. A guideline that was never retrieved and carries only a url lands at `medium` (still chips, reader can verify); one with no identifier at all lands at `low`.

Rule of thumb Codex asked for, encoded: *guideline/trial beats review beats model memory*, and *nothing uncited earns a chip*.

## 4. Source hierarchy (the `tier` used for ties + labeling)

A `_sourceRank(ref)` orders candidates when a claim could attach to more than one ref, and drives chip class/label:

1. Society guideline (management claims)
2. FDA label (a *new indication* — beats an older guideline that predates it)
3. Landmark RCT (informs, does **not** equal guideline)
4. Review / narrative (pathophys & background support only — must not be the sole backing for a practice-changing treatment claim)

For v1 this only (a) breaks confidence ties and (b) selects the chip label/class. Hierarchy-*driven retrieval* (fewer, better chunks) is future work, not this spec.

## 5. Enforcement points

**5a. `_assignConfidence(talk)`** — new function. Runs at finalize, immediately after `pruneFakeReferences()` and in the same neighborhood as `_normalizeInlinePmids()`. For each surviving ref, set `ref.confidence` and `ref.provenance` from the signals above. Idempotent.

**5b. `renderCite()` gate** — when resolving a marker's ids, drop any resolved ref whose `confidence === "low"`. If that leaves the marker with no displayable ref, render the **surrounding text without a chip** (NOT the raw `[N]` — that would look broken). Reuse the existing `display.length === 0` branch that already trims trailing space.

**5c. Refine path (`weaveFeedbackTalk`)** — refine already runs Option A (`_filterRefsToPaste`) + Option B (`_esummaryBatch`) and sets `src_verified`. After weave, run `_assignConfidence` so any ref refine *couldn't* verify lands as `low` and therefore **cannot render a chip**. Refine may never upgrade a ref above what its provenance supports.

**5d. Legacy load fallback** — saved talks predate `confidence`. On load, if a ref lacks `confidence`: `pmid || url || src_verified` → `medium`; otherwise → `low`. This retro-gates old talks without re-running retrieval.

## 6. Data model (additive, back-compat)

```
reference: {
  id, source, year, society, url, type, pmid, src_verified,   // existing
  confidence: "high" | "medium" | "low",                       // new, persisted
  provenance: "retrieved" | "guideline" | "pubmed_verified"    // new, persisted (reason)
            | "user_upload" | "paste_asserted" | "review_abstract"
            | "body_mention_only" | "model_knowledge",
  tier: 1..4                                                    // new, from _sourceRank
}
```

No field is removed; readers that ignore the new fields are unaffected.

## 7. Optional internal confidence display (#5, off by default)

A `S.debugCite` toggle (dev-only, not user-facing) that tints chips by confidence (green/amber/grey) and prints a footer tally `high N · med N · low N (uncited)`. This is the audit surface — it lets you *see* when a talk is over-decorated. Not shipped to end users.

## 8. Non-goals (explicitly deferred — dependency chain)

- **#1 clinical currency** ("what changed / deprecated") — highest rot risk; do **after** confidence exists to catch stale entries. Needs `update_date`.
- **#2 do-not-teach field** — related metadata; already in the manifest-migration roadmap. Pairs with #1.
- **#4 topic packs** — the GUIDELINES object is already a proto-pack by specialty; migrate opportunistically, not as an upfront project.
- **#6 monthly review queue** — a report over `review_due` metadata that doesn't exist yet. Last, not first.

## 9. Acceptance tests

1. **Refine fabrication blocked:** paste feedback with a claim + a PMID that is neither in the paste's verified set nor retrievable → no ref added, and the claim renders as plain text (no chip).
2. **Uncited generation claim:** a bullet cites `[3]`, ref 3 has no pmid/url and isn't in `S.ragChunks` → `confidence:"low"`, renders plain, no chip; body prose has no dangling `[3]`.
3. **Retrieved trial:** ref with pmid present in `S.ragChunks` → `high`, chip renders with trial class.
4. **Guideline:** society ref (source_tier 1) → `high`, society chip.
5. **Legacy reload:** open a talk saved before this change → chips appear only on refs with an identifier; none on bare model-knowledge refs.
6. **Refine fail-open:** eutils unreachable, PMID was verbatim in paste → `medium` (`paste_asserted`), chip still renders (don't punish a network blip).

## 10. Rollout order (when we build)

1. `_assignConfidence(talk)` + persist `confidence`/`provenance`/`tier` on refs.
2. Wire it into generate-finalize and `weaveFeedbackTalk` finalize.
3. Gate `renderCite()` on confidence (5b).
4. Legacy load fallback (5d).
5. `_sourceRank` for tie-break + labels.
6. Optional `S.debugCite` tint (7).
7. Acceptance tests (9), then bump BUILD_ID.

**Smallest shippable slice** = steps 1–4: it kills the refine-fabrication bug and the uncited-chip problem. 5–7 are polish.
```
