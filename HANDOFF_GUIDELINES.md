# HANDOFF — Guideline Integrity Work (Chalk Talk)

**Written:** 2026-07-11 · **Updated:** 2026-07-15 · **Last build:** `2026-07-15-01` · **Entries:** 183
**For:** the next Claude session. Read this first.

---

## ✅ SHIPPED 2026-07-15: REFINE CITATION GUARD (was the top-priority task)

Both Option A and Option B below are **built, tested, and committed** (build `2026-07-15-01`).
What was implemented, all in `index.html`:

- **Option A (cite-only-from-paste).** `weaveFeedbackTalk`'s prompt now forbids inventing references
  (identifier must be VERBATIM in the paste; uncited > fabricated). Belt-and-braces enforcement in code:
  `_filterRefsToPaste()` drops any `add_references` whose PMID/DOI/URL isn't literally in `userMsg`.
- **Option B (PubMed verify).** `_esummaryBatch()` — ONE batched eutils esummary call per refine, from
  the browser — verifies every surviving PMID (plus inline `PMID nnnn` tokens carried over from the
  paste). Non-existent PMIDs → ref dropped. Resolving PMIDs → the model's claimed title/journal/year
  are **replaced with PubMed's own**, so a mangled citation can't survive either. **Fails OPEN** on a
  network error (paste-sourced refs kept as claimed) — A is the floor, B is the upgrade.
- Dangling `[N]` chips of rejected refs are stripped (`_stripChipIds()`); ids belonging to existing
  refs are never touched.
- `_normalizeInlinePmids(talk, extraMeta)` grew an optional second param: pasted+PubMed-verified inline
  PMIDs become proper chips with real metadata; unverifiable inline PMIDs are dropped as noise. Runs on
  every refine now, not just generate.
- Guard-created refs carry `src_verified: "pubmed" | "paste"`; `pruneFakeReferences()` has a keep-rule
  for them (they aren't in `S.ragChunks` and PubMed-canonical titles may not appear in prose).
- Refine now kicks off the **same background chip audit** (`verifyCitations`) as generate.
- Honesty UX: the refine success message tells the user when suggested citations were rejected
  ("applied uncited; this app never mints citations from model memory").

**Tests:** `test_refine_guard.mjs` (repo root, `node test_refine_guard.mjs`, no network — eutils is
mocked; it extracts the guard functions from index.html so it always tests live code). Covers the
acceptance test from this handoff: one real PMID in paste → exactly one new verified chip; invented
refs dropped + chips stripped; fail-open on network error. All passing. Syntax check: 0 errors.

**Two loose ends for a future session:**
1. **CORS on eutils was NOT verifiable from the sandbox** (egress allowlist blocks NCBI). eutils has
   sent `Access-Control-Allow-Origin: *` for years, but verify once in the browser: refine a talk with
   a pasted PMID and check DevTools → Network for the `esummary.fcgi` call. If it's CORS-blocked, the
   guard silently degrades to Option A (still safe) — fix would be proxying esummary through worker.js.
2. **The SURGICAL edit path (`weaveTalk` patch schema, ~line 7480) still allows `add_references` from
   memory.** Lower risk (user-directed single edits, and uploads are legit primary sources) but the
   same class of hole. The same two helpers can be reused there; decide how strict to be when the user
   *asks* for a citation from memory ("cite SPRINT") — probably: eutils-verify if a PMID is offered,
   else add UNCITED with a note.

---

## ⭐ ORIGINAL TASK SPEC (2026-07-13, kept for context): REFINE MUST NOT MINT UNVERIFIED CITATIONS

**The problem.** Jenni's real workflow: paste her talk into OpenEvidence, get prose feedback, paste
that feedback back into Chalk Talk's refine box to apply corrections. She noticed **new inline citations
and journal-name chips appear during refine** and asked whether the app looks anything up. It does **not.**

The refine/proofread path is `weaveFeedbackTalk()` (index.html, ~line 7072) → `applyProofreadFeedback()`.
Verified by reading it:
- It does **NOT** call `retrieveRAG()` — no RAG retrieval.
- It passes **NO tools** to the model — no web search. It's a single plain `callAPI()` (line ~7113).
- It lets the model emit `add_references` — brand-new references **invented from the model's memory** (plus
  whatever citation text was in the paste).

**Why this is dangerous — it's the exact fabrication we spent the audit removing, but happening LIVE:**
1. `pruneFakeReferences()` keeps a new ref if its `source` string merely *appears in the talk body* — which
   is trivially true for text the model just wrote. So invented refs survive.
2. `verifyCitations()` (the background chip audit) only checks inline `PMID nnnn` tokens against abstracts
   **retrieved during the ORIGINAL generation** (`S.ragChunks`). A ref added during refine has no retrieved
   abstract, so it is **never verified** — it just gets a journal chip and looks authoritative.
3. `_normalizeInlinePmids()` (the new inline-PMID→chip converter) only runs in `generate()`, NOT in refine.

**Saving grace:** citations *inside* the OpenEvidence paste are real (OpenEvidence cites real papers). The
danger is the model (a) mangling those or (b) adding EXTRA ones from memory that were never in the paste.

**Two fixes to spec (Jenni approved building this next):**

- **Option A — cite-only-from-paste (safer, simpler, do this first).** In `weaveFeedbackTalk`'s system
  prompt, forbid inventing references: *"You may add a reference ONLY if its identifier (PMID/DOI/URL)
  appears verbatim in the reviewer feedback above. NEVER create a citation from your own knowledge. If a
  correction has no citation in the pasted feedback, apply it but leave it UNCITED."* Then, post-parse,
  **drop any `add_references` whose PMID/DOI/URL is not literally present in `userMsg`.** This is a few
  lines and needs no network call.

- **Option B — verify new PMIDs against PubMed (stronger, needs a lookup).** For each `add_references`
  entry with a PMID, call the worker/eutils to confirm the PMID exists and (ideally) that the title/journal
  match what the model claimed; drop refs that don't resolve. Reuse the logic in
  `rag/validate_guidelines.mjs::checkPmid`. Runs one batched eutils call per refine.

**Recommended:** ship A immediately (it removes the invent-from-memory hole), then layer B for PMIDs.
Also: run `_normalizeInlinePmids()` on the refined talk too, so any real pasted PMIDs become proper chips.
And make the refine result flow through the **same chip audit** — currently the audit only re-runs after
generate, not refine.

**Acceptance test:** paste feedback containing exactly one real PMID and one uncited recommendation →
the talk gains exactly one new chip (the real PMID), and the uncited correction is applied with NO chip.
Paste feedback with a claim and NO citation → the correction applies, zero new references.

---

## THE HEADLINE

The `GUIDELINES` object in `index.html` (183 society-guideline summaries) is the **entire** guideline
grounding this app has. It was **AI-drafted**. A July 2026 audit found **~37 fabricated or
mis-attributed citations out of 184 — roughly 1 in 5.**

This is not staleness. It is **confabulation**, and it has a specific, repeating shape:

1. **Phantom update years.** A plausible recent year bolted onto a real older guideline.
   `IDSA SSTI 2014/2024` (no 2024 update exists) · `KDIGO 2024 Blood Pressure` (it's 2021) ·
   `KDIGO 2024 CKD-MBD` (it's 2017) · `APA Schizophrenia 2020/2024` · `AASM Insomnia 2017/2024` ·
   `IDSA Febrile Neutropenia 2024` (it's **2010** — a 16-year-old guideline wearing a 2024 badge).
2. **Society blending.** Two real societies fused into a pairing that never existed.
   `AAN/AAOS Anti-Amyloid` (**AAOS is the ORTHOPAEDIC academy**) · `ASCO/SITC` irAE (ASCO alone) ·
   `AACE/ATA` hypothyroidism (ATA alone) · `ATS/ERS` bronchiectasis (ERS alone) ·
   `ATS/ESICM` ARDS (two separate guidelines that **actively disagree**) ·
   `WHO/IDSA Travel Medicine` (**IDSA doesn't publish travel medicine at all**) ·
   `AHA 2023 IE Update` (the 2023 endocarditis guideline is **ESC's**).
3. **Wholly invented documents.** All **three** AAHPM entries — **AAHPM publishes no clinical practice
   guidelines**, only position statements/EPAs. `APA PTSD 2023` — the *psychiatric* APA has no PTSD
   guideline; that's the American **PSYCHOLOGICAL** Association, a different organization.

**Why one-by-one human review missed it:** the *clinical content was mostly correct*. Jenni read
"ATA Hyperthyroidism: methimazole first-line…" and it was right — so she nodded. The fabrication lives
in the **metadata** (year, society), which is exactly what a physician skims. **Confabulation hides
behind competence.** Never assume a citation is real because the medicine around it is.

---

## WHAT'S DONE

- ✅ **pre-2020 band audited** (22 entries) — 9 superseded, fixed
- ✅ **2020–2022 band audited** (47) — 24 fixes
- ✅ **2023–2024 band audited** (97) — batches A + B complete
- ✅ **Two-year-title screen** run across all entries — the highest-yield tell; 12/17 confirmed phantom
- ✅ ~14 duplicate entries removed (197 → 183)
- ✅ **Honesty pass on app copy** — "peer-reviewed" removed (it's an LLM checking an LLM), "verify with
  current literature" toggle renamed, citations toast no longer fires when nothing was checked
- ✅ **Citation behavior changed** — prompts now say an *uncited* bullet is preferable to a
  *mis-attributed* one; critique hunts mis-attribution instead of stuffing `[N]` onto every bullet
- ✅ **`rag/validate_guidelines.mjs`** built (see below)

## WHAT'S NOT DONE — START HERE

### 1. Finish the validator run (IN PROGRESS — Jenni was running it when the session ended)
```
node rag/extract_guidelines.mjs && node rag/validate_guidelines.mjs 2>&1 | tee /tmp/val.txt
grep "DEAD LINK\|PMID\|YEAR MISMATCH\|NO URL" /tmp/val.txt     # the real problems
```
**Must run on Jenni's machine** — the Claude sandbox has no outbound network and will report every URL
as unreachable (it exits 2 and says so; don't be fooled).

**Only 404/410, invalid PMID, year-mismatch, and missing-URL are HARD FAILURES.** 403s from ACR/IDSA/
AASLD/ASCO are bot-blocking, not dead links — they're warnings. An earlier run reported **77 failures
before this fix**; expect that number to drop a lot. Work the real failures.

**Known limit:** the validator proves a URL *resolves*, not that it's the *right document*.
`AAN/AAOS Anti-Amyloid 2024` pointed at a real AAN page that loaded fine. The **PMID year-check is the
sharp edge** — migrate entries from society landing pages to PubMed links wherever possible, because a
PMID is verifiable in a way a marketing URL never is.

### 2. Audit the 2025–2026 band (~40 entries, NEVER AUDITED)
The last real gap. They're newest so least likely stale — but *the fabrications invented recency on
purpose*, so "new" is not "safe." Use the same method: subagent with WebSearch/WebFetch, verify against
the **society's own guideline register**, `UNVERIFIED` rather than guess.

### 3. Migrate to `guidelines_manifest.json` (Codex's proposal — Jenni approved the direction)
Current shape is `{name, year, access, url, keys}` per specialty, with duplicates across specialties.
Target: **one canonical entry, many specialties**, with real metadata:
```json
{
  "id": "cardio-pe-aha-acc-2026",
  "title": "AHA/ACC Acute Pulmonary Embolism Guideline",
  "societies": ["AHA", "ACC"],
  "year": 2026,
  "pmid": null,
  "source_url": "https://...",
  "specialties": ["Cardiovascular", "Pulmonary"],
  "evidence_type": "guideline | living_guideline | fda_approval | landmark_trial | position_statement | society_disagreement",
  "status": "verified | needs_review | superseded",
  "last_verified": "2026-07-11",
  "review_due": "2027-01-11",
  "supersedes": [],
  "practice_changers": [],
  "do_not_teach": []
}
```
**`do_not_teach` is the most valuable field** — it encodes negative knowledge, which is what a stale
guideline actually creates. Real examples already discovered:
- "Do not teach that a DEA **X-waiver** is needed for buprenorphine" (abolished 2023)
- "Do not teach the **WHI black box**" (FDA removed it Nov 2025)
- "Do not teach **massive/submassive** PE" (2026 AHA/ACC retired it for categories A–E)
- "Do not teach **self-collected HPV** as a USPSTF rec" (still draft)
- "Do not teach that **any male UTI is complicated**" (IDSA 2025 redefined it)
- "Do not teach **step-up therapy** in Crohn" (AGA 2025 reversed to upfront advanced therapy)

### 4. THEN run the guideline ingest — NOT BEFORE
```
node rag/extract_guidelines.mjs && node rag/ingest_guidelines.mjs   # needs .env with keys
```
**Do not ingest until the validator is green.** Embedding a citation makes it *retrievable* and lends it
false authority. A retrievable fabrication is worse than a dormant one. The ingest is idempotent —
re-run freely after each fix wave.

---

## KEY FILES

| File | What |
|---|---|
| `index.html` → `var GUIDELINES` (~line 1004) | **Source of truth.** 183 entries, 21 specialties. |
| `GUIDELINE_SUMMARIES.md` | Human-readable export for Jenni to audit. Regenerate after every change. |
| `rag/extract_guidelines.mjs` | index.html → `rag/guidelines_extracted.json` |
| `rag/validate_guidelines.mjs` | **The citation validator.** Run on Jenni's machine. |
| `rag/ingest_guidelines.mjs` | Embeds summaries into the vector store. Dedupes by name. |

**After ANY change to GUIDELINES:** re-run `extract_guidelines.mjs`, re-run the validator, regenerate
`GUIDELINE_SUMMARIES.md`, bump **both** `BUILD_ID` in index.html **and** `build.txt`, verify syntax:
```
node -e "const h=require('fs').readFileSync('index.html','utf8');const c=h.match(/<script>([\s\S]*?)<\/script>/g).map(b=>b.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,''));let n=0;for(const b of c){try{new Function(b)}catch(e){console.log('ERR',e.message);n++}}console.log('syntax errors:',n)"
```
⚠️ **The GUIDELINES `keys` strings are inside DOUBLE-quoted JS strings — never insert a `"` into them.**
I broke the file twice this session: once with an apostrophe in a single-quoted prompt string, once with
a double `}`. Always syntax-check before committing.

---

## OTHER WORK COMPLETED THIS SESSION (context, not tasks)

- **RAG:** added `documents.journal_rank` — 156 junk docs (MDPI mega-journals: Int J Molecular Sciences,
  Nutrients, IJERPH) **excluded** from retrieval; 499 elite journals boosted.
- **Fixed a real ranking bug:** `match_chunks` added `(rcr − 1) × 0.02` **unbounded**, so an RCR-167 paper
  (NEJM) scored **+3.3** against a similarity term capped at 1.0 — famous-but-off-topic papers outranked
  relevant ones. Now log-scaled and capped.
- **Query expansion:** retrieval embedded only the bare topic string, so treatment/outcomes sections went
  ungrounded. Now fans out into 5 facet sub-queries, batch-embedded, merged.
- **`[N]` chip audit:** `verifyCitations()` only ever checked inline `PMID` tokens, **never the chips the
  reader sees**. It now audits the chips themselves.
- **Mobile:** live generation preview via server-streamed partial drafts (survives phone lock);
  right-side Library drawer; web-search toggle removed (always searches); References is a third block.

**⚠️ PENDING DEPLOY:** worker.js changes (query expansion + mobile streaming) need `npx wrangler deploy`.
Frontend needs `git push origin main`.

---

## THE LESSON WORTH KEEPING

The fix for this class of bug is **not better AI drafting** — a model can always produce a plausible
citation, and more care at drafting time just makes fabrications harder to spot. The fix is **changing
the source of truth**:

> **Machines fetch citations. Models summarize. The physician judges the clinical content.**

We had the model doing all three. That's the whole story.
