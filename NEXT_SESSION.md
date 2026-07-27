# Next session — Chalk Talk

_Handoff from 2026-07-26. Long session; this replaces the 2026-07-17 handoff._

## One-line status

The evidence foundation and the model decision are **done and verified**. Everything lives on
`launch-integration` (build **2026-07-26-18**), **12 test suites / 499 assertions green**. **`main` is
~52 commits behind and is what the live site still serves** — so none of it is user-visible yet. What
remains is one benchmark run only you can do, your call on merging, plus launch UX.

**Nothing is deployed.** Per Codex: don't ship the production routing until the rerun below is read.

---

## FIRST — four things only you can do

**0. Run the benchmark + the structured-output probe.** These must run on YOUR machine. The Cowork
sandbox routes all egress through a MITM proxy that permits a plain `GET https://api.anthropic.com/v1/models`
but returns a bare `Unauthorized` for an authenticated `POST /v1/messages` — so **no model calls are
possible from there at all**, and `api.openai.com`, `www.ebi.ac.uk`, `rxnav.nlm.nih.gov` and
`api.crossref.org` are unreachable outright. Any claim that a benchmark or API shape was "verified" from
the sandbox is false by construction.
```
cd ~/Developer/chalk-talk

# (a) Confirm the 2026-07-26-17 parse fix on production routing. ~20 Opus rows, no rival arm.
node rag/eval_gemini_quality.mjs --no-candidate
mv rag/eval_gemini_report.json rag/eval_opus5_rerun_after_reorder.json

# (b) The one writer users can already reach that has NEVER been benchmarked.
node rag/eval_gemini_quality.mjs --provider openai --openai-model gpt-5.6-sol
mv rag/eval_gemini_report.json rag/eval_gpt56sol_full20.json
```
Reading (a): the specific question is **20/20 valid JSON + schema-complete**. One structural failure in
20 was the pre-change rate, so a clean 20 is encouraging, not proof — the 95% CI on 1/20 is ~0.1–25%.
If the gate says **INCONCLUSIVE (exit 2)**, a verifier was unreachable and the run cannot clear anything;
that's the new guard working, not a failure of the model.

**1. Push, then decide on merging to main.**
```
cd ~/Developer/chalk-talk
git push origin launch-integration
```
To go live, `launch-integration` → `main`. Before merging, serve locally and click around:
```
python3 -m http.server        # then open localhost:8000
```
Make three talks: a **Concise lecture** (feel the new speed), a **Boards** question, and one where you
**open a saved talk from your Library right after generating** — that last one exercises the state-leak
fixes (the previous talk's image/chips/Undo used to bleed through, and the citation audit could
overwrite the talk you were reading).

Also: **redeploy the Worker.** It was deployed once with the *old* code; the fail-closed
`WRITER_CLEARED` change and the corrected `MODEL_PRICES` are not live yet (`npx wrangler deploy`).

**2. Rotate the exposed keys** — OpenAI + Supabase service-role. Still outstanding from an earlier
session. Nothing blocks on it, but it shouldn't wait.

**3. Regenerate the two bad featured talks** — Infective Endocarditis and Peritoneal Dialysis were 100%
uncited (see `PROFILE_TALK_AUDIT.md`). They're the first thing a visitor sees.

> ⚠️ **Close GitHub Desktop while Claude is editing.** It repeatedly auto-committed in-progress work as
> message `"s"` and pushed it — once capturing a half-resolved merge with literal conflict markers in
> `index.html`. Those commits are already pushed, so don't amend them.

---

## What landed 2026-07-26

**Evidence corpus — verified end to end.** 383 → **559 trials** (multi-specialty sweep across
cardiology, pulm/crit, heme-onc, GI/hep, ID, endo/rheum/neuro, allergy-immunology, primary care). All
559 are `pubmed_2026-07` or `manual_2026-07`, 0 ineligible, live in Supabase with
`is_landmark_trial=true`, 0 orphans. The validator caught **two genuinely wrong citations** — SSaSS and
REPRISE pointed at a correspondence letter and an editorial, not the trials.

**Validator hardened.** PubMed direct → Europe PMC + Crossref agreement → manual. Requires full
title+journal+year agreement, confirms the returned title is actually the trial, never partial-writes,
and always emits `rag/landmark_validation_report.json`. Unit-tested offline.

**Model decision: Claude-only.** Gemini gated behind `ct_dev_gemini`. See `rag/MODEL_BENCHMARK.md` for
the pass bar, the frozen 20-row benchmark, and every catalogued failure. Re-run it for any future model
instead of inventing a new test.

**App fixes** (all regression-tested):
- Concise talks get a targeted 8-check safety review instead of a whole-talk rewrite → much faster.
  (It was dead code for an hour due to a `var`-hoisting bug — `draftTalk` read 60 lines before its
  declaration. Second such bug in this file in a week; watch for the pattern.)
- Background citation audit could **overwrite the talk you were reading** with the previous talk's
  content. Now uses an identity guard.
- A stale generation could eat a newer one's Cancel, then render *and charge* for it.
- `_clearTalkScoped()` — one helper all four talk-entry paths call. Closes ~14 state leaks (Undo
  reaching into a previous talk, uploaded PDFs carrying over, stale RAG chunks falsely upgrading
  citation-confidence chips, a new talk able to overwrite a *different* saved row).
- Withheld drafts are owner-scoped; sign-out clears the screen.
- Refine charged a credit on parse success even when the result was then discarded. Now charges only
  when the talk actually changes.
- **DOIs are trust-but-verified** like PMIDs, with an identity check (a real DOI for an unrelated paper
  is dropped, not relabelled).

**Never render partially parsed medical content** (builds -14 → -18). `parseTalkStrict()` now gates
*every* path that can assign `S.talk`, including the async/resume path most mobile generations use and
critic-produced rewrites. The async review gate **retries once, then withholds** — it will no longer
fall back to showing an unreviewed draft. And the prompt schemas now emit the big nested structure
(`sections[]` / `question{}`) **last**, so the brace drift that caused both benchmark parse failures can
only orphan trailing nesting rather than `key_point` / `summary_points` / `visual_memory_card`; a failed
parse gets exactly **one** bounded repair retry, then fails the generation.

**The benchmark harness itself had a reporting defect.** Its citation and drug verifiers fail open by
design, but "could not check" was printed as `fabricated citations 0 · ✔ GATE PASSED` — identical to a
verified-clean run. An unmeasured run is now **GATE INCONCLUSIVE (exit 2)**. Worth remembering as a
pattern: the instrument that grants clearances needs its own tests (`test_eval_harness.mjs`).

**Retry paths were not preserving the evidence** (build -18, Codex). The draft repair retry did
`uc + note` where `uc` is a content-parts ARRAY — it stringified to `[object Object]`, so the retry went
out with no topic, no guidelines, no trials, no retrieved sources and none of your uploaded PDFs, while
the result would still have been labelled "Grounded in guidelines + N sources". The resumed async review
rebuilt its ground-truth context from `S.ragChunks`, which is empty after a reload, so the critic checked
claims against less evidence than wrote them; the job record now persists a `{title,pmid}` digest. And the
resume path stamped **no provenance at all** — no chips, and the unverified-model warning could never fire
on the path most mobile generations use. All three now go through one `_stampProvenance()`.

**Still open, and Codex is right about it:** the Anthropic request is *not* schema-constrained. The field
reorder plus a free-text repair retry reduces the damage a brace slip can do; it does not make invalid
JSON impossible. Run `node rag/probe_structured_output.mjs` (a few cents) before changing the request
shape — and note `worker.js` currently forwards no `tool_choice`, so the free tier would silently keep the
unconstrained shape.

---

## NEXT — launch UX (the remaining work)

1. **First-run / empty state** — the opening shot of the demo video.
2. **Kebab menu + Share** — the floating kebab is fiddly; make Share first-class instead of buried.
3. **Mobile pass** — one real generation on mobile Safari, check the wait experience.
4. **Rework `DEMO_SCRIPT.md`** (from May). Script around trial-heavy topics where the evidence is
   strongest — "Diuretic Classes in HF" was the cleanest talk.
5. Launch copy framing: "educational beta — grounded in retrieved sources; physicians verify primary
   sources." NOT "validated database."

---

## Backlog

- **Low-coverage warning** when a detailed lecture ends with <3-4 grounded refs (Codex).
- **Edit + save formatting cleanup** (tabled): normalize format on section save.
- Guideline layer: populate empty `do_not_teach`/`supersedes`/`caveats` from `DO_NOT_TEACH_REVIEW.md`;
  merge the two ANCA vasculitis entries.
- **RAG currency** — the PubMed corpus ingest is ~6 months stale.
- Deferred trial sets: Oncology (29), Ophthalmology (5), Dermatology (4) — own curated pass.
- **Cost lever:** A/B a cheaper model for *generation* on the frozen benchmark before switching. Keep
  OpenAI for embeddings (swapping = re-ingest everything).
- **Ideas worth borrowing** (from Thinking Machines' Inkling post): a *claims grader* that verifies each
  factual claim via web search alongside a rubric grader; and fine-tuning an open-weights model on the
  559-trial corpus + guidelines.json for attribution fidelity — the one thing prompting couldn't fix.

---

## Runbooks

**Corpus (after editing `rag/landmark_trials.json`):**
```
node rag/validate_landmark_pmids.mjs --write   # promotes ONLY on a fully clean run
node rag/ingest_landmarks.mjs                  # want failed=0, not_found=0
node rag/reconcile_landmarks.mjs               # dry run — inspect orphans
node rag/reconcile_landmarks.mjs --apply       # only if the dry run looks right
```

**Guidelines (after editing `guidelines.json`):**
```
node rag/extract_guidelines.mjs && node rag/build_manifest.mjs && node rag/audit_manifest.mjs
```
Audit must report `hard: 0`.

**Tests (11 suites, all offline, no keys needed):**
```
for t in test_*.mjs; do node $t || echo "RED: $t"; done
```
Every suite is wired into `.github/workflows/tests.yml` — if you add one, add it there in the *same*
commit (an unwired test has been missed before).

**Benchmark (needs keys + reachable verifiers):** see `rag/MODEL_BENCHMARK.md` → "Pending: the full
20-row runs". `--no-candidate` reruns production routing alone; the report is overwritten every run, so
`mv` it.

**Keys:** `node rag/setkey.mjs` — prompts, sanitizes, live-validates, de-duplicates. Use it instead of
`echo >> .env`; a literal `your_key_here` placeholder once shadowed two real keys because `loadenv`
takes the FIRST match.
