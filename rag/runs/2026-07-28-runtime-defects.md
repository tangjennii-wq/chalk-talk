# Runtime click-test defect log — build 2026-07-28-01

Rules for this run (Codex, 2026-07-28): record defects, **do not edit mid-run** unless a defect blocks
further testing, so every path exercises the same build.

---

## D-1 · Retrieval returned zero topic-relevant sources, and the talk still claimed grounding

**Severity: high.** Not a rendering bug — an evidence-provenance bug.

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
| 1 | Concise lecture, common topic | ✅ PASS (DKA, build -28-01) — renders, 4 sections, provenance at foot, no console errors. Defects D-1, D-3 logged. |
| 2 | Boards question | ⬜ |
| 3 | Detailed toggle on a finished talk | ⬜ |
| 4 | Refine on a finished talk | ⬜ |
| 5 | Check for updates | ⬜ |
| 6 | Apply update, then Refine — reference survives | ⬜ |
| 7 | Apply update → unsaved state + Undo | ⬜ |
| 8 | Reload mid-generation → resume + provenance | ⬜ |
| 9 | Open saved talk after generating → no bleed-through | ⬜ |
| 10 | Signed out / free tier | ⬜ blocked — needs the Worker redeploy |
