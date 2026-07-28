# Runtime click-test defect log — build 2026-07-28-01

Rules for this run (Codex, 2026-07-28): record defects, **do not edit mid-run** unless a defect blocks
further testing, so every path exercises the same build.

---

## D-1 · Retrieval returns off-topic sources, and the footer overstates what they contributed

**Severity: MEDIUM — downgraded 2026-07-28 after Jenni asked the right question.**

> **Correction.** I first wrote this up as "the talk claimed grounding it did not have", severity high.
> That was wrong about the architecture. `LECTURE_PROMPT` sends the FULL abstracts, and then explicitly
> instructs: *"Use your full clinical knowledge for teaching; the sources are for citation grounding, not
> to replace your pedagogical voice"* and *"If no source here substantiates a claim, teach it normally
> from your training and SKIP the citation."*
>
> **The retrieved papers are a citation pool, not the source material.** So on the DKA run the system did
> exactly what it was designed to do: it received eight off-topic diabetes trials, cited none of them, and
> taught from model knowledge. **That is the safety design working, not failing.**
>
> The real defects are narrower, and both are real:
> 1. **The footer overstates the contribution.** "Grounded in guidelines + 8 retrieved sources" reads as
>    "built from these eight". Accurate would be nearer "8 sources retrieved for citation · N cited".
> 2. **The corpus wastes the retrieval.** Eight irrelevant abstracts are real tokens buying nothing, and
>    the citation pool is empty precisely when citations would be most valuable.
>
> Everything below stands as evidence of (2). The framing of (1) has been corrected here rather than
> silently edited. This is the third time today I stated a conclusion that outran what I had verified.

- **Topic:** Hypercalcemia of Malignancy · lecture · Concise
- **Writer:** claude-opus-5 · **Build:** 2026-07-27-01 (pre-refresh; re-test on -28-01 pending)
- **Footer displayed:** `✍️ Claude · 📚 Grounded in guidelines + 8 retrieved sources · ✓ Citations checked`

### The eight "retrieved sources"

| # | retrieved title | about hypercalcemia? |
|---|---|---|
| 1 | Early palliative care for patients with metastatic non-small-cell lung cancer | no |
| 2 | Pembrolizumab plus Chemotherapy in Metastatic Non-Small-Cell Lung Cancer | no |
| 3 | Venous Thromboembolism Prophylaxis and Treatment in Patients With Cancer (ASCO) | no |
| 4 | Palliative Care for Patients With Cancer: ASCO Guideline Update | no |
| 5 | Practical Assessment and Management of Vulnerabilities in Older Patients… (ASCO) | no |
| 6 | Prevention and Management of Chemotherapy-Induced Peripheral Neuropathy (ASCO) | no |
| 7 | Management of Fatigue in Adult Survivors of Cancer (ASCO-SIO) | no |
| 8 | Treatment for Brain Metastases (ASCO-SNO-ASTRO) | no |

**Zero of eight mention calcium, PTHrP, bisphosphonates, denosumab or hypercalcemia.** Retrieval appears
to have matched on "malignancy"/"cancer" alone and returned a generic oncology-guideline cluster.

### What the talk then did

- `final_references` = **only 2**, both from that irrelevant set (Temel 2010; ASCO Palliative Care 2024).
  The writer behaved correctly under `pruneFakeReferences` — it cited only what it actually had.
- `guideline_sources` listed **"Endocrine Society/ES clinical practice guidance on hypercalcemia of
  malignancy"** and **"NCCN Supportive Care"** — neither of which was retrieved. `guidelines_matched`
  was **`[]`**, empty.
- So the two genuinely on-topic sources named in the talk came from **model knowledge, not evidence**,
  while the footer told the reader the talk was "grounded in guidelines + 8 retrieved sources".

### Why this matters

The provenance claim is literally true and materially misleading: 8 sources were retrieved, and they
were useless. A reader is told the talk is grounded; the grounding is off-topic. This is the same class
as everything else caught today — a status line reporting an easier fact than the one it implies.

### Candidate fixes (deferred until the matrix finishes)

1. **Relevance gate on retrieval.** If no retrieved chunk matches the topic's key terms, say
   "no on-topic sources retrieved" rather than counting them.
2. **Do not count off-topic chunks** in the footer's "N retrieved sources".
3. **Flag unretrieved `guideline_sources`.** If the talk names a guideline that was never retrieved or
   matched, it is an unverified assertion and should be labelled as one.
4. Investigate why `guidelines.json` had no hypercalcemia match — is the entry missing, or did the
   matcher fail?

### D-1 CONFIRMED SYSTEMATIC — second topic, same failure (2026-07-28, build -28-01)

Re-ran Test 1 on a deliberately different topic to see whether D-1 was specific to oncology matching.
It is not.

- **Topic:** Diabetic ketoacidosis · lecture · Concise
- **Footer displayed:** `Grounded in guidelines + 8 retrieved sources`

| # | retrieved title | about DKA? |
|---|---|---|
| 1 | DCCT — intensive treatment of diabetes, long-term complications | no |
| 2 | ACCORD — effects of intensive glucose lowering in type 2 diabetes | no |
| 3 | CREDENCE — canagliflozin and renal outcomes | no |
| 4 | UKPDS 33 — sulphonylureas or insulin vs conventional | no |
| 5 | UKPDS 34 — metformin in overweight type 2 diabetes | no |
| 6 | FIDELIO — finerenone in CKD and type 2 diabetes | no |
| 7 | DECLARE — dapagliflozin and cardiovascular outcomes | no |
| 8 | VADT — glucose control and vascular complications in veterans | no |

**Zero of eight mention ketoacidosis.** Retrieval matched the chronic disease category ("diabetes") and
returned its landmark glycemic-control trials — none of which bear on an acute metabolic emergency.

The talk's `guideline_sources` correctly name the **ADA/EASD/AACE/DTS 2024 Consensus Report on
Hyperglycemic Crises** and **ADA Standards of Care 2025**, and the final references cite them. Neither
was retrieved. As with hypercalcemia, the on-topic evidence came from **model knowledge**, and the
retrieved set contributed nothing while being counted in the footer.

**Two topics, two categories, identical shape.** The hypothesis is that retrieval embeds/matches the
topic against a corpus keyed to chronic disease areas, so acute presentations within a disease area
return that area's landmark chronic trials. Worth testing a third acute topic (e.g. "hyperkalemia",
"status epilepticus") to confirm the pattern before designing the fix.

---

## D-3 · `S.genPhase` is never reset after a successful generation

**Severity: low-medium.** Observed on both runs. After the talk finalises — `S.loading === false`, talk
rendered, footer drawn — `S.genPhase` is still `"reviewing"`.

The render layer computes `var _reviewing = (S.genPhase === "reviewing")` to decide whether a streaming
preview wears the amber **DRAFT · UNDER REVIEW** label. A phase that never returns to idle means any
later code path keyed on `genPhase` reads a stale value. Not user-visible in the paths tested so far,
because the preview is retired at success, but it is a latent trap of exactly the kind that produced the
dead "reviewing" UI in the first place.

Not blocking. Deferred until the matrix finishes, per the run rules.

---

## D-2 · "A second AI model checks it for accuracy" — FIXED mid-run (blocking honesty defect)

Fixed before the matrix proper began, in `8c4bdcc`. Five user-visible places claimed a second model
reviewed the draft; drafting and review are both `claude-opus-5`. The guarding test searched for a
string that appears nowhere in the file and passed green every run. Test now matches the claim, not one
phrasing, and was proven by reintroducing the bug.

---

## Matrix status · build 2026-07-28-01

| # | path | result |
|---|---|---|
| 1 | Concise lecture, common topic | ✅ **PASS** — DKA. Renders, 4 sections, provenance at foot, no console errors. D-1/D-3 logged. |
| 2 | Boards question | ✅ **PASS** — Hyperkalemia, difficulty 4. 5 choices all with real text, one correct (C), explanation, 4 wrong-explanations, 5 pearls, stem 158 words (in range). ABIM breadcrumb correct; Slides/Visual tabs correctly hidden. |
| 3 | Detailed toggle on a finished talk | ✅ **PASS** — 4→5 sections, 20→32 bullets, refs 2→3. Talk stayed on screen throughout ("Regenerating in background — you can keep reading"). The old wipe-on-toggle bug is gone. ~150 s. |
| 4 | Refine on a finished talk | ✅ **PASS** — title unchanged, all 5 headings preserved, bullets 32→34, **all 3 prior refs intact**, 1 correct new ref added (Glaser, paediatric cerebral edema, NEJM). Talk marked unsaved. |
| 5 | Check for updates | ✅ **PASS** — 4 newer sources proposed, not applied. Each PubMed-confirmed, each labelled "AI SUMMARY · NOT VERIFIED AGAINST THE PAPER", each with a rationale. Correctly spotted that PECARN 2018 supersedes the Glaser 2001 paper the talk cites. |
| 6 | Apply update, then Refine — reference survives | ✅ **PASS** — both added PMIDs (39052901, 29897851) present after a full refine. Codex bug #2 confirmed fixed. |
| 7 | Apply update → unsaved state + Undo | ✅ **PASS** — refs 4→6, each stamped `src_verified:"pubmed"`, `confidence:"high"`, `provenance:"pubmed_verified"`. `talkIsSaved:false`, undo history depth 2, Undo button rendered. |
| 8 | Reload mid-generation → resume + provenance | ⛔ **NOT TESTABLE IN THIS CONFIG** — see note below. |
| 9 | Open saved talk after generating → no bleed-through | ⚠️ **INCONCLUSIVE** — see D-4. Partial positive: zero contamination from any of the three talks generated this session. |
| 10 | Signed out / free tier | ⛔ **BLOCKED** — needs the Worker redeploy. |

### Why 8 and 10 could not be run

The browser is in **BYOK mode**: `PROXY_CONFIG.enabled === false` and a personal key is set, so every call
goes straight to `api.anthropic.com` and generation is **synchronous in the page**. There is no
server-side JOBS_KV job to resume, so a mid-generation reload can only lose the work — the resume path
does not exist in this configuration. Test 8 exercises the Worker's async path and Test 10 exercises the
Worker's own key; both require the redeploy in `RELEASE.md` §C and must be run against the deployed site.

**This matters more than a normal skipped test.** The resume path is what mobile generations actually
use, and it is the path that silently stamped no provenance until it was fixed. It remains the least
exercised code in the release.

---

## D-4 · Library "Open" — could not confirm it loads the talk you clicked

**Severity: unknown. Needs a deliberate re-test.**

Clicked **Open** on the "Atrial Fibrillation" row; a new tab opened showing a talk titled **"LDL Lowering
in Coronary & Ischemic Heart Disease"**, which is not a visible card label in the library.

What I could establish:
- Each row's Open is a real per-talk link (`#t=<uuid>`), distinct per row — routing is by id, not index.
- **The opened tab's `location.hash` was empty.** So that tab never received the `#t=` fragment; it is a
  fresh load that restored a talk from storage, not an Open-by-id.

So this may be nothing more than "a new tab restores your last session", and my click may simply not have
driven that tab at all. **I am recording it as unresolved rather than as a defect** — asserting a bug I
have not demonstrated is the exact error this log exists to avoid. Re-test deliberately: navigate a tab
directly to `#t=<uuid>` for a known card and compare the loaded title against the card label.

(Note: card labels and stored `title` fields may legitimately differ — "Statins, etc. in CAD" plausibly
stores "LDL Lowering in Coronary & Ischemic Heart Disease". That alone would explain everything.)

---

## D-1 · third data point (Hyperkalemia, boards)

| retrieved | on-topic? |
|---|---|
| EMPHASIS-HF (eplerenone) · FIDELIO · EPHESUS · ALLHAT · MERIT-HF · CONSENSUS · PARADIGM-HF | no (7) |
| Sodium zirconium cyclosilicate in hyperkalemia | **yes (1)** |

**1 of 8 on-topic** — better than 0/8, still 87% miss. These are drugs that *cause* hyperkalemia, so the
corpus is returning disease-area landmark trials again rather than management evidence for the topic.

**Three topics, three categories, same shape: 0/8, 0/8, 1/8.**

Decisive contrast, same session: the **update check** — which uses web search plus PubMed rather than the
local corpus — returned four precisely on-topic, PubMed-verified sources for the same DKA talk, including
one that correctly supersedes a reference the talk was citing. **The query is fine. The corpus is the
problem.**

---

## D-5 · The correct answer never lands on A or B (candidate — needs n≈40 to confirm)

Found mechanically, no clinician required, from the 2026-07-28 question set (build 2026-07-28-02,
claude-opus-5, difficulty 4, 10 items) plus the hyperkalemia boards item from the click tests.

| keyed letter | A | B | C | D | E |
|---|---|---|---|---|---|
| count (n=11) | **0** | **0** | 6 | 3 | 2 |

P(zero A and zero B in 11 items | uniform 1/5) ≈ **0.36%**.

**The alphabetical sort is NOT the problem — it is working perfectly.** All 10 items sorted their choices
correctly by text (0 violations, checked programmatically, leading articles ignored). BOARDS_PROMPT
requires that sort precisely to kill position bias, and it does.

So the bias has moved upstream into DISTRACTOR WORDING: the model appears to be composing distractors
whose text alphabetically precedes the correct answer. The mechanism intended to remove position bias is
being routed around rather than defeated — which is why the internal consistency check (`correct_letter`
matches the flagged choice, 10/10 clean) cannot see it.

**Why it matters for a teaching product:** a test-wise resident who notices "never A or B on Chalk Talk"
is rewarded for it. A question bank that trains letter-guessing instead of reasoning is working against
its own purpose, and it is the kind of artefact a reviewer would find quickly.

**Confirm before fixing.** n=11 is suggestive, not conclusive:

```
node rag/gen_question_set.mjs --n 15      # then repeat; pool to n≈40-50
```

If it holds, the fix is in BOARDS_PROMPT distractor design, not in the sort. NO CODE CHANGE YET —
per the run rules, results are reported before anything is touched.

**Independent of this:** internal key consistency was **10/10** — `correct_letter` agreed with the choice
flagged `correct:true` in every item. That is a genuine mechanical pass.
