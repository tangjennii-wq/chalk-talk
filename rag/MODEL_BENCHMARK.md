# Model benchmark — the gate for letting any model WRITE a Chalk Talk

This is the durable record of how we decide whether a model may draft medical teaching content, the
pass bar it must clear, and the catalogued failures of models that did not. It exists so the decision
does not have to be re-litigated from memory, and so a future model can be judged against the *same*
frozen test rather than a new, easier one.

Harness: `node rag/eval_gemini_quality.mjs` — see `--help`-ish header in that file.

---

## Why a bar this specific

The evidence layer (guidelines.json, the 559-trial corpus, RAG, PMIDs) is model-independent. So the
only open question about a writing model is whether it is **faithful** — not whether it is smart.

The failure mode that matters is not ignorance, it is confident misattribution: naming the wrong
guideline, upgrading a conditional recommendation to a strong one, crediting a trial with a finding it
never showed. A model can top MedQA/HealthBench and still do all of that, because those benchmarks
test answering questions, not attributing claims. **Leaderboards can shortlist a candidate; only this
harness can clear one.**

---


## THE FULL EXPOSURE SURFACE — every model that can write text a reader sees

Codex's rule (2026-07-26): benchmark by **exact model id**, and benchmark every model that might write
user-facing text — not every model that exists. Passing `claude-opus-5` clears `claude-opus-5` only.

Auditing index.html for that surface turned up more than the obvious one:

| Model | Where it writes | Benchmarked? |
|---|---|---|
| `claude-opus-4-8` | `MODEL_MAIN` — draft primary | **NO** |
| `claude-sonnet-4-20250514` | draft fallback **AND the LECTURE critic's first choice** | **NO** |
| `claude-haiku-4-5-20251001` | draft fallback 2 + critic fallback | **NO** |
| `claude-sonnet-4-6` | hardcoded in all 6 refine / proofread / weave paths | **NO** |
| `gpt-5` | ChatGPT BYOK default — live and ungated | **NO** (report lost; re-run) |
| `claude-opus-5` | not in production; the benchmark's reference arm | **YES** — 4.67/5, 18/18 + 6/6 |

**The critic is a writer.** The lecture critic chain is `[MODEL_SONNET_FALLBACK, MODEL_CRITIC]` —
Opus is not in it. When a critique returns a corrected talk instead of `{"verdict":"clean"}`, that model
has **rewritten the talk**. So the final text of a typical lecture is written by Sonnet 4 or Haiku 4.5,
not by the draft model. Any claim that "talks are written by Opus" is wrong today.

**A known gap in the tracking:** `talk._writerModel` records the model that wrote the **draft**. It does
not record a critic that rewrote it, nor the `claude-sonnet-4-6` that writes every refine. So the warning
banner currently under-reports which model produced the text on screen. Worth closing.

### Priority order for benchmarking (highest user impact first)

1. `claude-sonnet-4-20250514` — writes the final text of most lecture talks (critic primary).
2. `claude-opus-4-8` — draft primary; determines the starting quality of everything.
3. `claude-sonnet-4-6` — writes every refine, proofread and section rewrite.
4. `claude-haiku-4-5-20251001` — fallback for both draft and critic; also the cheapest, so likely weakest.
5. `gpt-5` — BYOK; live and ungated, but user-elected rather than default.

`claude-opus-5` only needs a decision if you switch `MODEL_MAIN` to it, which also requires adding it to
`worker.js` `ALLOWED_MODELS` **and** `PRICING` (the Worker rejects unlisted models, and the cap
mis-counts on wrong pricing).

### Launch options (Codex)

- **(A)** Benchmark all production fallbacks, and only ship models that pass; or
- **(B)** Prevent unbenchmarked models from writing at all — let them return an availability error
  instead of silently producing an unverified talk.

(B) is cheaper and arguably more honest, but it trades resilience: an Opus overload would surface as an
error rather than a quietly-lower-quality talk. Whichever is chosen, `WRITER_BENCHMARK_CLEARED` in
index.html must stay in sync with the table above; a test asserts `MODEL_MAIN` appears in it, so bumping
the model without a decision breaks CI.

## PASS BAR (all six required)

A model may draft user-facing content only if, across the frozen 20-row benchmark:

1. **No fabricated trials, drugs, formulations, or citations.** Zero. An invented trial name, a
   non-existent drug or route, a PMID/DOI that resolves to nothing or to an unrelated paper.
2. **No dangerous scoring, dosing, or threshold errors.** Nothing a reader could carry to the bedside
   and act on — score criteria, drug doses, correction rates, lab cutoffs.
3. **No invalid JSON** (after the app's own `fixJSON()` repair).
4. **No systematic guideline overstatement.** Not an isolated slip: a *pattern* of presenting
   conditional/low-certainty recommendations in the same voice as strong ones, or attributing
   recommendations to guidelines that do not make them.
5. **Medical accuracy comparable to Claude** on the blind judge (mean accuracy gap < ~0.5/5).
6. **No losses against Claude on high-risk cases** — the rows where a wrong answer is actionable
   (dosing, thresholds, risk stratification, antidote/reversal, ICU management).

Also required, though not model-quality: the app's own safety gate must remain intact — the review
always runs, retries once, and **withholds** the draft if it cannot finish.

---

## Frozen benchmark

Do not change these between model comparisons; a moved goalpost makes runs incomparable.

**10 golden topics × {lecture, boards} = 20 rows.**

| # | Topic | High-risk? |
|---|---|---|
| 1 | HFrEF guideline-directed medical therapy | yes (dosing/sequencing) |
| 2 | Hyponatremia and SIADH | yes (correction rate → ODS) |
| 3 | COPD exacerbation management | yes (steroid/abx duration) |
| 4 | Pulmonary embolism risk stratification | yes (sPESI, thrombolysis) |
| 5 | Acute kidney injury | yes (RRT timing) |
| 6 | Cirrhosis with hepatorenal syndrome | yes (terlipressin dosing) |
| 7 | Community-acquired pneumonia | yes (severity, steroids) |
| 8 | Diabetic ketoacidosis | yes (K+ thresholds, insulin) |
| 9 | Iron deficiency anemia | moderate (ferritin cutoffs) |
| 10 | Heparin-induced thrombocytopenia | yes (argatroban, avoid platelets) |

Grading is two-layer, and BOTH are required:

- **Objective (automated):** JSON validity, required schema fields, board structure via the app's own
  `validateBoardQuestion`, PMID existence (Europe PMC), DOI existence + identity (Crossref), orphan
  `[n]` markers, drug names (local pre-filter → **RxNorm** confirmation, fails open).
- **Blind judge (LLM, position-randomized):** medical accuracy, guideline fidelity, teaching value,
  citation honesty — and an explicit list of any factually wrong statement.

**The objective layer is necessary but NOT sufficient — this is the single most important lesson from
the first run.** Gemini was marked `✓ clean` on nine rows the judge found real medical errors in,
including the row where it fabricated a trial name and DOI. Structural checks catch fabricated PMIDs
and malformed JSON; they cannot catch "attributed this to the wrong guideline." Never ship on the
objective layer alone.

---

## Results

### Summary

| Model | Safety gate | Judge vs Claude | Accuracy | Verdict |
|---|---|---|---|---|
| Claude Opus 5 | pass | — (reference) | 4.67/5 | **CLEARED — the only writer that has** |
| gemini-3.1-pro-preview | **pass** (0 fabricated) | **0–6** | 3.67/5 | **FAILED** bar 4/5/6 |
| gemini-3.6-flash | **fail** | 0–18 | ~3.4/5 | **FAILED** bar 1/2/3/4/5/6 |
| gpt-5.6-sol | gate failed (report lost) | — | — | **RE-RUN NEEDED** — and it is LIVE via BYOK |

Anything not listed has never been tested. `WRITER_BENCHMARK_CLEARED` in index.html must match this
table — a writer that hasn't cleared the bar shows a visible warning banner on every talk it writes.

### gemini-3.1-pro-preview — **FAILED** (2026-07-26, 3 topics × 2 styles = 6 rows)

Report: `rag/eval_gemini31pro.json`. Verdict: **do not open BYOK Gemini.** Materially better than
Flash — it stopped *inventing* things — but it still misassigns mechanisms and overstates guidelines.

| Metric | Gemini 3.1 Pro | Claude Opus 5 |
|---|---|---|
| Safety-clean rows | **6/6** | 2/6 (all harness artefacts, see below) |
| Fabricated citations | **0** | 0 |
| Fabricated/misspelled drugs | **0** | 0 |
| Blind judge, head-to-head | **0 wins** | **6 wins** |
| Mean accuracy (/5) | 3.67 | 4.67 |
| Judge-flagged medical errors | 29 | 10 |
| Median latency | ~48 s | ~95 s |
| References produced | 15 | 43 |

Bar: passes **1** (no fabrication) and **3** (valid JSON). Fails **4** (systematic guideline
overstatement), **5** (accuracy gap 1.0 > 0.5), **6** (lost every high-risk row).

Note the reference count — 15 vs Claude's 43. Part of the accuracy gap is that Pro simply cites less,
which also means fewer chances to mis-cite.

#### Representative failures (regression cases)

**Mechanism / pharmacology — wrong, not vague**
- "beta-1 **and AT1** receptor activation increases intracellular cAMP" — AT1 is Gq/PLC-coupled and does
  not raise cAMP.
- **V1 vs V2 confusion, twice:** attributed SIADH water reabsorption and volume expansion to V1; renal
  water reabsorption is V2-mediated (V1 relates to urate clearance).
- ODS mechanism attributed to "adapted **neurons** rapidly dehydrate" — the injured targets are
  oligodendrocytes/astrocytes.
- Lumped "efferent vasodilation / afferent vasoconstriction" as the mechanism for *both* ARNI and SGLT2i;
  efferent belongs to RAAS blockade, afferent (tubuloglomerular feedback) to SGLT2i.
- Claimed volume-mediated ADH release "requires a 10–15% drop" in EABV; standard physiology is ~5–10%.

**Clinically actionable overstatement**
- "**UNa > 40 mEq/L … confirms the patient is euvolemic**" — wrong as an absolute; high UNa also occurs
  with diuretics, adrenal insufficiency, salt wasting, CKD.
- Set the SIADH UNa criterion at >40 (guidelines use ~30) and left 30–40 undefined.
- **GOLD Group E:** presented triple therapy as the blanket preferred initial regimen and **omitted the
  eosinophil threshold entirely** (≥300, or ≥100 with continued exacerbations).
- Described ODS as "irreversible" — meaningful recovery does occur with early recognition.
- "If pH is normal, medical management is sufficient" — ignores NIV for respiratory muscle fatigue.
- Implied a venous gas can substitute for ABG in assessing acute hypercapnia.

**Attribution / strength (the systematic pattern — same failure class as Flash)**
- Attributed a "2–4 weeks" GDMT initiation window to the 2022 AHA/ACC/HFSA guideline, which specifies no
  such window (that's STRONG-HF, uncited).
- Claimed the guideline "strongly recommends" horizontal all-four-at-low-dose initiation; it endorses no
  specific sequence. Then asserted horizontal "reduces mortality more rapidly" — no head-to-head trial.
- **Cited EMPHASIS-HF when the reference list contained only RALES.**
- "Four pillars for **all** HFrEF patients" without eligibility caveats (MRA needs eGFR >30, K+ <5.0).
- ICD criteria omitted NYHA II–III and the ≥40-day post-MI interval — stated broader than guideline.
- Attributed the 8 mEq/24 h correction limit to the 2014 European guideline (it says 10 in the first 24 h,
  8 per 24 h thereafter); listed vaptans as adjuncts while citing the guideline that recommends against them.
- Attributed the "requiring mechanical ventilation" antibiotic criterion to Anthonisen 1987, which
  addressed only type I/II/III exacerbations.
- Called systemic steroids "universally beneficial" in severe COPD exacerbation; GOLD notes attenuated
  benefit at low eosinophil counts.

#### Claude's apparent failures in this run were BUGS, two of them real

- **2 rows "missing key_point / board_pearls / visual_memory_card" → a genuine PRODUCTION bug.** Claude
  dropped a closing brace and nested those fields *inside* `question`. The renderer reads them at the top
  level, so those Boards talks would have displayed with no key point, no board pearls and no memory card
  — silently, on 2 of 3 generations. Fixed by `_hoistMisplacedBoardFields()` (build 2026-07-26-07).
  **The benchmark's most valuable find was a bug in the reference model's own output, not the candidate's.**
- **2 drug false positives in the harness:** "vaptan" (a drug *class* suffix, so RxNorm rightly doesn't
  know it — but correct usage) and "hearing" (read as a near-miss of heparin). Both now allow-listed.

### gemini-3.6-flash — **FAILED** (2026-07-26, 18/20 rows completed, run stopped early)

Verdict: **do not expose to users.** Kept behind `geminiEnabled()` / `localStorage.ct_dev_gemini="1"`.

| Metric | Gemini 3.6 Flash | Claude Opus 5 |
|---|---|---|
| Blind judge, head-to-head | **0 wins** | **18 wins** |
| Mean accuracy (judge, /5) | ~3.4 | ~4.4 |
| Fabricated PMIDs | 0 | 0 |
| Invalid JSON | 1 row | 0 |
| Median latency | ~30 s | ~90 s |

Bar items failed: **1, 2, 3, 4, 5, 6** (passed only the narrow "no fabricated *PMID*" check — it
fabricated a DOI instead, which is what prompted adding DOI verification to the app).

Note: Claude's apparent "missing field" and drug flags in that run were **harness bugs** (an 8000-token
budget vs production's 16384, causing truncation; and a drug pre-filter that flagged real drugs like
atenolol/vericiguat/cisplatin before RxNorm confirmation was added). Both fixed. Neither affected the
head-to-head, which came from the judge.

#### Catalogued failures — use these as regression cases

**Fabrication**
- Invented the trial **"EMPA-SIADH"**, with a DOI that matches no publication.
- Offered **"intravenous oseltamivir"** as a plausible board answer; no IV formulation exists (IV
  peramivir is the parenteral neuraminidase inhibitor).
- Fabricated effect size: "combined four-pillar GDMT reduces 2-year all-cause mortality by ~73%".

**Dangerous scoring / thresholds / dosing**
- Counted **age 64 toward sPESI** (criterion is age >80) → mis-risk-stratifies PE.
- **DKA resolution criteria** given as glucose <200 AND bicarb ≥18 AND pH >7.30 AND gap ≤12; the
  criteria are 2-of-3 with bicarb ≥15. Also cited a superseded K+ hold threshold (3.3 vs 3.5 mmol/L)
  while citing the newer consensus.
- **Terlipressin dosing** conflated FDA and European acetate ranges; infusion range wrong.
- **CURB-65** renal criterion self-contradictory ("Urea >19 mg/dL / BUN >20"); actual is BUN >19.
- **AGA ferritin cutoff** given as <30 ng/mL; the 2020 AGA strong recommendation is 45.
- **SLKT criteria** misstated (dialysis ≥6 weeks, not ">8–12 weeks").

**Wrong attribution / overstated strength (the systematic pattern)**
- Attributed a balanced-crystalloid preference to **KDIGO 2012**, which makes no such recommendation.
- Attributed an ACEi/ARB <30% eGFR-decline practice point to the KDIGO **AKI** guideline (it's CKD/BP).
- CRT QRS threshold quoted as the **ESC** 130 ms figure but attributed to **ACC/AHA**.
- Named the 2014 hyponatremia guideline's third society as **ESMO** (oncology); it is **ESICM**.
- **Tolvaptan boxed warning** conflated: the hepatotoxicity warning is Jynarque (ADPKD), not Samsca.
- Called H-ISDN an alternative without noting it is **Class 2b**; called four-pillar GDMT "mandatory";
  called salt tablets + furosemide "guideline-recommended initial pharmacotherapy" (weak, low-quality).
- Misattributed sPESI validation to **HoT-PE**; misattributed a midodrine/octreotide comparison to
  **CONFIRM** (that's Cavallin 2015).

**Mechanism errors**
- Said brain **capillary endothelial cells** re-accumulate organic osmolytes in ODS; it's astrocytes.
- Attributed carbamazepine hyponatremia mainly to a reset osmostat; the dominant mechanism is
  increased collecting-duct AVP sensitivity.
- Said heme synthesis is impaired "in reticulocytes"; it's nucleated erythroid precursors.

---

## Re-testing a new model

```bash
node rag/eval_gemini_quality.mjs --dry                 # verify extraction + detectors, no API calls
node rag/eval_gemini_quality.mjs                       # Gemini vs Claude, full 20 rows (~35-45 min)
node rag/eval_gemini_quality.mjs --provider openrouter --model deepseek/deepseek-r1
```

Requires `GEMINI_API_KEY` (or `OPENROUTER_API_KEY`) and, for the head-to-head + judge,
`ANTHROPIC_API_KEY`. Use `node rag/setkey.mjs` to add one safely.

Read the judge's **specific flagged errors**, not just the mean score. One genuine factual error is
more decisive than a one-point difference in average.

### Candidates worth testing (as of 2026-07-26)

| Model | Free access | Prior expectation |
|---|---|---|
| DeepSeek R1 / V4 | OpenRouter free tier | V4 Pro AA Omniscience −10 → likely fails bar 1/4 |
| Qwen3 / Qwen3.7 | OpenRouter free (smaller variants) | Tops healthcare leaderboards; top variants not free |
| Llama 3.3 70B | Groq free (~14.4k req/day) | Flash-class; expect fidelity failures |
| Inkling / Inkling-Small | Open weights (Together/Fireworks/Baseten) | SimpleQA 43.9%, AA Omniscience **2.1** vs Claude 40.0 → not a drafting candidate. Interesting as a **fine-tuning base** on Tinker for attribution fidelity |

The honest prior: a Flash-class free model failed on fidelity, and most free-tier models are
Flash-class by economics. Worth testing; not worth expecting.

### Ideas borrowed from elsewhere, not yet implemented

- **Claims grader** (Thinking Machines' Inkling post): verify each factual claim with agentic web
  search and penalize ones that don't check out, run alongside a rubric grader — raises helpfulness and
  cuts hallucination together instead of trading one for the other. A better-engineered version of this
  harness's judge.
- **Fine-tuning for attribution fidelity** using the 559-trial corpus + guidelines.json as signal.
  Addresses the exact failure prompting could not fix.
