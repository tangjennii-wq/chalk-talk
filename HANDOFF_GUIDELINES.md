# HANDOFF — Guideline Integrity Work (Chalk Talk)

**Written:** 2026-07-11 · **Last build:** `2026-07-07-43` · **Entries:** 183
**For:** the next Claude session. Read this first.

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
