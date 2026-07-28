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

---

## D-6 · The Updates button becomes an unlabelled ⚠️ and stops looking like a button

**Found by Jenni, 2026-07-28, on a Boards question.** She asked "what am I supposed to do for boards?
there's no button to double check anyway with search." There is one — she was looking straight at it.

`checkUpdatesBtn` renders `⚠️` instead of `🔎` whenever `talkIsFastMoving(t)` is true, and the word
"Updates" carries `hide-mobile-text`, so at narrower window widths the control collapses to a bare amber
warning triangle sitting between Edit and Save. It reads as an error indicator, not an action.

Meanwhile the banner directly below says **"check for updates before teaching it"** — an instruction to
press a button the user cannot identify. A UI that tells someone to do something and then hides the way
to do it is worse than saying nothing.

Fix (deferred — build is frozen for staging): keep 🔎 as the icon and carry the amber in the LABEL or a
dot, never by replacing the only affordance that identifies the control. Ensure the text label survives
at the widths the action row actually gets used at.

---

## D-7 · The "topic changes often" banner fires on Boards questions

Same screenshot. `talkIsFastMoving()` matches `FAST_MOVING_RE` against title + subtitle + topic; the
subtitle "Recognizing lymphoma risk factors…" hit `lymphoma`, so a Sjögren parotid-mass question was
labelled a fast-moving topic.

Jenni: *"I don't think we need the topic changes often for the boards questions."* She is right about the
framing. A lecture is teaching material that can drift out of date and should be re-checked before it is
taught again. A board question is a fixed vignette with one keyed answer — "check for updates before
teaching it" is not the right instruction for it, and the amber chip adds noise to an item that is
supposed to read cleanly.

The underlying match is also loose: the trigger was a risk factor *mentioned in the subtitle*, not the
subject of the question.

Fix (deferred): suppress the fast-moving banner in boards style, or match on the ABIM classification /
topic rather than free text from the subtitle.

---

## FREEZE — build 2026-07-28-03

Per Codex 2026-07-28: no more feature or UX changes before the staging deployment. D-6 and D-7 are
recorded here and deliberately NOT fixed, so the deployed commit is the one that was tested.

---

# D-1 · ROOT CAUSE FOUND (2026-07-28, investigation only — build frozen)

**Retrieval is not broken. The corpus does not contain the evidence being asked for.** Two separate
causes, and only one of them is a fixable gap.

### Cause 1 — the trial corpus is 559 LANDMARK TRIALS, which are chronic-outcome RCTs by definition

| topic | papers in `rag/landmark_trials.json` |
|---|---|
| diabetic ketoacidosis | **0** |
| hypercalcemia of malignancy | **0** |
| spontaneous bacterial peritonitis | **0** |
| adrenal crisis | **0** |
| thyroid storm | **0** |
| status epilepticus | **0** |
| hyperkalemia | 3 |
| heart failure | 18 · type 2 diabetes 8 · CKD 9 · hypertension 12 |

This is structural, not a defect: **there is no landmark RCT for how to treat DKA.** Acute-management
evidence lives in guidelines and consensus statements, not in outcome trials. So when the topic is acute,
vector search returns the nearest thing it has — that disease area's chronic trials. Exactly what was
observed: hypercalcemia → oncology administration papers; DKA → DCCT/UKPDS/ACCORD; hyperkalemia → RAAS
and heart-failure trials.

It also explains the one anomaly: hyperkalemia scored **1/8** rather than 0/8 because it is the only one
of the three with any landmark trials at all (3).

### Cause 2 — the guideline corpus has real, specific gaps

`guidelines.json`: 84 entries across 21 specialties.

| topic | guideline entry |
|---|---|
| DKA / hyperglycemic crises | **ABSENT** |
| hypercalcemia of malignancy | **ABSENT** |
| hyperkalemia · SBP/ascites · adrenal · thyroid storm · COPD · GCA | present |

The two absences are precisely the two topics that returned `guidelines_matched: []` and scored 0/8.
**This is the fixable half.** The ADA/EASD/AACE/DTS 2024 Hyperglycemic Crises consensus exists and the
model named it correctly from its own knowledge — it simply is not in the corpus.

### Why the talks were still good

Both layers missing did not damage the teaching, because `LECTURE_PROMPT` instructs the model to teach
from clinical knowledge and cite only what the retrieved set genuinely supports. It cited nothing and
taught correctly. **The safety design absorbed a corpus gap** — which is the system working, and also the
reason the gap stayed invisible until someone looked at the retrieved titles.

### The fix list, now concrete

1. **Add the missing guideline entries** — DKA/hyperglycemic crises and hypercalcemia of malignancy
   first. `rag/audit_coverage.mjs` already exists and audits all **1003** ABIM topics in
   `rag/abim_topics.json` against the corpus; run it to find every other gap systematically rather than
   one screenshot at a time. (Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY.)
2. **Add a relevance floor.** If the best-matching chunk is below a similarity threshold, return nothing
   rather than the nearest chronic trial. Better to cite nothing than to pad the pool with noise.
3. **UI wording — already done** in build 2026-07-28-02: the chip now reads "N papers found to cite from"
   rather than "Grounded in guidelines + N retrieved sources".
4. **Consider whether the trial corpus should be told apart from the guideline corpus in the UI**, since
   they answer different questions and fail in different ways.

**Codex's bar for public launch — "D-1 understood and corrected" — is now half met: it is understood,
and the correction is (1) plus (2).** Neither is required for Jenni's own use, and neither is a code
change to the generation path.

---

# D-1 · CORRECTIONS TO MY OWN ANALYSIS (Codex, 2026-07-28)

Four errors, all mine, corrected here rather than quietly dropped.

**1. "Add a similarity floor" — there already is one, and D-1 happened through it.**
`worker.js:506` defaults `min_similarity` to **0.30**; `index.html:6780` sets `ABS_FLOOR = 0.30`, plus a
relative-delta gate. So option B is CALIBRATION, not addition. The question is not whether to gate but
why the gate admitted DCCT for a DKA query.

**2. The "159 of 810" figure is not a coverage prevalence and I should not have presented it as one.**
It came from generous word matching, which can mark a document covered for sharing one word and mark real
coverage absent when terminology differs. The denominator is also an artifact of MY filtering, not the
data: `abim_topics.json` holds ~1003 nested strings; my flattener deduplicated and dropped strings ≤3
chars (855 unique), then scored only those with a word >4 chars outside a stoplist (810). Roughly 193
topics were excluded by my own filter. **Withdrawn as a number.** The only coverage evidence that stands
is the three observed retrievals: 0/8, 0/8 and 1/8.

**3. "No society guideline is worth much either" / "for a fifth of the blueprint there's nothing to
ingest" — wrong, and flippant.** Dermatology, allergy, arrhythmia and pericardial disease all have
society guidelines, consensus statements, systematic reviews and authoritative practice reviews (AAD,
AAAAI, HRS, ESC pericardial disease 2015, among others). **A topic does not need a landmark RCT to have
usable evidence.** The missing corpus layer is broader practice evidence, not more trials.

**4. PMID verification proves paper IDENTITY, not topic relevance or claim support.** My option C
conflated the two. A live-search fallback must additionally judge relevance, article type and whether the
abstract actually supports the claim — otherwise it trades a relevance problem for a fabrication problem.

## The likely mechanism, now testable

Production does not embed the bare topic. `retrieveRAG` fans out into facet sub-queries:

    "<topic>"
    "<topic> pathophysiology and mechanism"
    "<topic> diagnosis, workup and diagnostic testing"
    "<topic> treatment, management and guideline recommendations"

For an acute topic inside a chronic disease area, the **treatment facet** is the suspect: *"diabetic
ketoacidosis treatment, management and guideline recommendations"* is embedding-close to UKPDS and
ACCORD, because those genuinely are diabetes treatment-and-management trials. Every off-topic chunk may
be clearing 0.30 honestly, on a facet the user never asked about.

If that is what the scores show, a higher global floor is the WRONG lever — it would starve legitimate
topics, which is precisely why ABS_FLOOR is set low. The levers would be per-facet gating, metadata
filtering on the `source_tier` / `is_landmark_trial` columns the table **already carries**, or reranking.

`rag/diagnose_retrieval.mjs` captures the real scores per facet. Read-only. Needs SUPABASE_URL,
SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY — both the Supabase service-role key and the OpenAI key are
still flagged for rotation.

## Agreed plan (B calibrated + conditional C)

1. **Three guideline entries first** — 2024 ADA/EASD/AACE/JBDS/DTS Hyperglycemic Crises Consensus
   (PMID 39052901, DOI 10.2337/dci24-0032); Endocrine Society hypercalcemia of malignancy
   (PMID 36545746, DOI 10.1210/clinem/dgac621); Fifth International Workshop primary hyperparathyroidism
   (PMID 36245251, DOI 10.1002/jbmr.4677). Codex is right that hypercalcemia is not one disease — without
   the third, the commonest outpatient pathway stays uncovered.
2. **Capture real scores, then calibrate the gate.** Not done by adding a floor that exists.
3. **Live search only when local coverage is insufficient** — never on every generation.
4. **Verify more than existence**: identity, topic relevance, article type/authority, and whether the
   abstract supports the claim.
5. **Log query, scores, identifiers and selected sources** so the result is auditable and publishable.
6. **Keep expanding the local corpus selectively** for high-yield gaps. Do not abandon it.

**Completion test for (1) is retrieval, not insertion.** Rows in `guidelines.json` prove nothing; the
test is querying DKA, HHS, hypercalcemia of malignancy and primary hyperparathyroidism after ingestion
and seeing the right guideline in the top results, then generating one talk of each and inspecting what
actually reached the prompt.
