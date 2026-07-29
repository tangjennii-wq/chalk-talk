# Calibration runbook — stages 1 & 2

Everything below needs database access or clinical judgment, so it is yours to run.

> **2026-07-29 — calibration was halted and the instrument corrected.** Codex caught a ranking-policy
> confound: the rerank sorted by raw cosine, while the order it replaced carried four authority boosts.
> "Rerank ON" therefore meant *rerank plus authority policy OFF* — two changes under one name, which no
> four-arm design can attribute. Fixed via option 1 (isolated rerank): `score_candidate_chunks` now
> applies the identical production formula with bare-topic similarity substituted, so exactly one thing
> varies. Details in `RETRIEVAL_ARCHITECTURE.md`. **The halt was correct** — the run was one command away,
> and ~130 physician judgements would have measured a contrast that did not mean what its label said.

**Do not build Stage 3.** The calibration result decides whether a model call per generation is
justified. Deciding first and measuring afterwards is how you get a number that agrees with you.

---

## 0 · RESOLVED — the deployed `match_chunks` was NOT the checked-in one

Checked 2026-07-29 against the live catalog. There is drift, and it is wider than the landmark question.

| | repo `migration_v2_rag.sql` | **deployed** |
|---|---|---|
| parameters | 6 | **10** |
| return columns | 20 | **24** |

Deployed adds parameters `rcr_weight`, `landmark_boost`, `max_journal_rank`, `elite_journal_boost`
(defaults `0.02, 0.05, 2, 0.06`) and columns `rcr`, `citation_count`, `is_landmark_trial`, `journal_rank`.
No migration in the repo creates any of them — the function was altered out-of-band and never checked in.

Three consequences:

1. **The `[LMK]` markers were real.** I had flagged that claim as unsupported because the checked-in
   `RETURNS TABLE` cannot produce them. The deployed one can. The D-1 landmark-noise observation stands.
2. **Production ranks on four parameters that exist nowhere in this repo.** The Worker sends 6 named
   params, so the other four silently take those defaults on every live request. Reading the repo tells
   you the wrong thing about how sources are ranked.
3. **`test_schema_types.mjs` takes its ground truth from a file that is not what is deployed.** Its
   `chunk_id bigint` assertion happens to still hold — I verified `bigint` against the live catalog — but
   the premise "the repo is the reference" is false, so it holds by luck rather than by construction.

**I called this "not a calibration blocker, the drift is constant across arms". That was wrong**, and
Codex corrected it. The drift is constant in *candidate generation*, but the rerank arms then **replaced**
that ordering with raw cosine — so the boosts survived in two arms and vanished in the other two. Fixed;
see the banner above and §3a.

**Now fixed:** `supabase/migrations/canonical_match_chunks.sql` is the live definition, exported with
`pg_get_functiondef` rather than hand-edited to guess at the difference. `test_schema_types.mjs` reads it
as ground truth, and the stale copy in `migration_v2_rag.sql` is marked SUPERSEDED with a test enforcing
the marker.

---

## 1 · RESOLVED, and it blocks step 2 — there is no staging database

One Chalk Talk project exists: **`chalktalk` / `hrcvcjiefndvytlcbmpa`**, and it is production, currently
serving free-tier users. `score_candidate_chunks` is confirmed absent from it.

A Supabase branch does not solve this: branches copy schema, not data, and calibration is meaningless
against an empty corpus — the whole measurement is which of 559 trials and 84 guidelines come back.

So the real choice is **apply to production, or don't calibrate yet.** Applying is defensible:
`score_candidate_chunks` is additive, creates no table, alters nothing existing, and no code path calls it
unless a request sets `rerank:true` — which the deployed front end never does. But it must be a decision
made on purpose, not a default that happens because there was nowhere else to put it.

## 2 · DONE — migration applied to `chalktalk` (production), 2026-07-29

Applied as migration `add_score_candidate_chunks`. Additive only: one new function, no table touched.

## 3 · DONE — all three functional smoke tests pass, plus the boundary

| test | expected | **actual** |
|---|---|---|
| 1 · signature | `vector, bigint[]` → `chunk_id bigint, similarity` | matches; `anon` / `authenticated` / `service_role` all hold EXECUTE |
| 2 · **it runs** | 3 rows, `max_sim = 1` | `scored=3`, `max_sim=1.000000`, `min_sim=0.586371` |
| 3 · cap raises at 501 | `ERROR … capped at 500, got 501` | `P0001` raised from the RAISE at line 10 |
| 4 · boundary at 500 | accepted, not raised | accepted — 176 of ids 1–500 have embeddings |

Test 2 is the one that mattered: `max_sim` is exactly `1.000000` for the probe chunk against itself, which
is what proves it is scoring the ids asked for against the stored embedding, rather than installing under
the right name and matching nothing.

Test 4 was not in the original list. Test 3 only proves 501 fails; without it, a `>=` instead of a `>`
would reject the largest legal input and look correct.

## 3a · DONE — authority parity, applied and verified live

`score_candidate_chunks` was replaced (migration `score_candidate_chunks_authority_parity`). It now
returns `similarity` **and** `ranked_score`, the latter using production's exact formula and weights.

| check | **result** |
|---|---|
| `match_chunks` vs `score_candidate_chunks` on one embedding, 25 chunks | `ranked_score_agrees = true`, worst delta **0.000000000000** |
| every boost term non-negative | true |
| largest boost observed | **0.36** — on a scale where cosine sits near 0.3–0.9, this decides orderings, it does not break ties |

That last row is why the confound mattered. Discarding a term worth up to 0.36 is not a rounding
difference; it would have dominated the very ordering the experiment was measuring.

Guards added so it cannot silently return:

- `test_ranking_formula.mjs` — 31 assertions binding the two SQL files' expressions and default weights.
  Mutation-tested: sorting on `bare_similarity`, tuning one boost in one file, or dropping the RCR term
  each turn the suite red.
- The Worker **throws** if `ranked_score` is missing, rather than ranking on nulls and still reporting
  `rerank_applied: true`.
- The evaluator **aborts** (exit 8) if a rerank arm returns no `bare_ranked_score`.

## 4 · Start the Worker — **must run on your machine**

The sandbox I work in has no outbound route to Supabase or OpenAI (both curl to `000`), so steps 4–7 are
yours. The migration went in through a separate host-side channel; the calibration cannot.

```
npx wrangler dev            # .env already holds the credentials
```

## 5 · Run calibration only

```
node rag/eval_pipeline_arms.mjs --worker http://127.0.0.1:8787
```

Embedding cost is trivial — 12 topics × 5 facets × 4 arms ≈ 240 `text-embedding-3-small` calls, well
under a cent. There are no writer calls.

It aborts rather than guessing if the Worker predates these stages, or if any arm reports a stage it did
not actually apply. An abort here is the instrument working. **Sanity check before labeling anything:**
the run must report `rerank_applied: true` on the rerank and both arms. If it reports false, the Worker
did not reach the new function and the whole run is measuring baseline four times.

## 5a · WHAT THIS CALIBRATION CANNOT TELL YOU

State this alongside any result. Every arm starts from candidates returned by the same `match_chunks`,
which applies `journal_rank <= 2` as a **hard filter**. So the experiment measures ranking and filtering
**within the already-eligible corpus** — nothing else.

It therefore **cannot**:

- establish overall retrieval recall — the denominator is "directly-relevant sources *some arm returned*",
  not "directly-relevant sources that exist";
- show whether any of the **156 excluded documents** (6% of 2,593) would have helped;
- conclude that the pipeline solves coverage. Precision and coverage are different problems, and stages 1
  and 2 only address the first.

If D-1 turns out to be a coverage problem rather than a ranking problem, a clean sweep here would be
consistent with that and would not refute it. Audit those 156 documents separately — see task #15.

## 6 · Complete the blinded D/A/I sheet

**Budget real time for this.** 12 topics × up to 12 candidates ≈ **100–140 judgments**, each with a full
title, publication type, journal/year, PMID/DOI and a 1200-character excerpt. Arm and scores are hidden.

- **D** directly relevant — supports diagnosis, treatment, mechanism, prognosis or a guideline
  recommendation **for this topic**. Only D counts as grounding.
- **A** adjacent/contextual — same disease area, does not address this topic
- **I** irrelevant

**Open the PMID/DOI whenever the excerpt is not enough.** Scoring refuses a partial sheet, but a complete
sheet of guesses is worse than an incomplete one, because it looks like data.

## 7 · Score it and choose one arm

```
node rag/eval_pipeline_arms.mjs --score rag/runs/arms-calibration-<stamp>-LABELS.md
```

Reports precision@N, directly-relevant count, papers/guidelines split, and **recall against the union of
directly-relevant sources any arm found** — so an arm that buys precision by discarding good sources
shows up as lost recall rather than as a win.

Then record the choice in `rag/runs/SELECTED_STRATEGY.json` (scoring writes it as a stub with
`selected_strategy: null`).

**Reading it honestly:** a *lower* kept count on an `absent` topic is a success. Returning nothing is the
correct answer when the corpus holds nothing.

## 8 · Review the choice before unsealing held-out

Held-out will not open without a scored artifact, a recorded strategy naming one of the four arms, and
`--unseal` repeating that exact name. It is a confirmation, not a second attempt.

---

## What the result decides

| outcome | what follows |
|---|---|
| deterministic stages get precision most of the way | ship them on, skip Stage 3 — a model call per generation is not worth its latency and cost |
| a real relevance gap remains | build Stage 3, the clinical-relevance gate |
| precision rises but recall falls badly | the stages are discarding good sources; tune before shipping either |

Stages 1 and 2 are opt-in and default OFF, so none of this changes the deployed app until you decide it
should.
