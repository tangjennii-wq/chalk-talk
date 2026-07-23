# Tomorrow — Chalk Talk prep

_Handoff from 2026-07-17. You took the night off; here's where to pick up._

## Where things stand
- **App build 2026-07-17-07** — section-edit crash fixed, citation-confidence gate live, reference-pipeline holes fixed, evidence-status (FDA-vs-guideline) lingo in the prompts.
- **Trial corpus: 214 LIVE in the database, verified. Manifest is 263** (batch 4 added 49 specialty trials — neuro/rheum/GI/cardio/heme/pulm/neph/endo/prev/psych — committed but NOT yet ingested).
- **`.env` is set up** on your machine and working. Key helper scripts exist: `bash rag/addkey.sh KEYNAME` to fix any single key.

---

## FIRST — 15 minutes, finish what's in flight

**1. Ingest batch 4 (the 49 new trials → 263 live).** Same runbook you already ran:
```
cd ~/Developer/chalk-talk
git pull
node rag/validate_landmark_pmids.mjs     # expect 263 OK, 0/0/0
node rag/ingest_landmarks.mjs
node rag/reconcile_landmarks.mjs --apply
```
If validate flags any of ~8 (they were checked via Europe PMID, not direct PubMed) — tell Claude the trial name, it's a 2-min fix like BALANCE/NAVIGATE were.

**2. Push today's work** (a stack of commits is local-only):
```
git push origin main
```

---

## SECOND — the thing we kept deferring: SEE IT
**3. Open the app on your phone**, hard-refresh with a `?v=` cache-buster. Make a heart-failure or CKD talk. Confirm: trials show up, citation chips look right, the edit pencil works, save/share works. This is the real launch gate — nothing else matters if a real talk looks wrong.

**4. Codex's 30-min smoke test** — 10 golden topics: HFrEF GDMT, hyponatremia/SIADH, COPD exacerbation, PE risk strat, AKI, cirrhosis/SBP/HRS, CAP, DKA, iron-deficiency anemia, HIT. For each: generate lecture + boards, check chips, save, reopen, share, one mobile-Safari generation, one "fake source" refine challenge. Pass bar: no crash, no fake-authoritative citation, save/share works.

---

## THIRD — launch-critical UX (pick by demo value)
5. **First-run / empty state** — the opening shot of your demo video.
6. **Generation-wait experience** — the middle of the demo; where it drags.
7. **Dev-only confidence tint** (spec §7) — small; lets you SEE high/med/uncited on a real talk before recording.
8. **Edit + save formatting cleanup** (the tabled item) + general edit polish.

---

## BATCH 6 — recent trials pending validate + ingest (added 2026-07-21)
77 recent NEJM/JAMA/Lancet practice-changing trials (2021-2026, emphasis 2024-2026) added to `rag/landmark_trials.json` (now 357 total), tagged `source_batch:"batch6_recent_2026-07"`, `pmid_verified:"websearch_2026-07"` (agent DOI-verified, NOT yet run through the repo validator). Includes CLOSURE-AF (NEJM 2026, PMID 41849741).

Run on your machine (needs .env + network):
```
cd ~/Developer/chalk-talk && git pull
node rag/validate_landmark_pmids.mjs --write     # verifies PMIDs vs PubMed, promotes OK -> pubmed_2026-07
# fix any flagged (year tweak, or set pmid_verified:"manual_2026-07" if canonical but odd pubtype — like BaSICS/CLL14/DOTS were)
node rag/ingest_landmarks.mjs
node rag/reconcile_landmarks.mjs --apply
```
Watch the 4 phase-2 entries (Retatrutide-P2, SYNERGY-NASH, survodutide-MASH, HARMONY-MASH) — flagged via `pmid_note`; validator may want `manual_2026-07`. They're emerging, not guideline-standard.

## GUIDELINE JSON SOURCE-OF-TRUTH — IMPLEMENTED on branch `guidelines-json-source` (Jenni 2026-07-21)
Status: built + all offline gates green. Source of truth is now `guidelines.json` (repo root); the embedded
GUIDELINES object was removed from index.html (349 lines out). Equivalence gate PASSED (guidelines.json
byte-identical to the pre-migration embed; getGuidelinesForTopic context identical across 7 topics incl.
cross-specialty). `extract_guidelines.mjs` repointed to guidelines.json; manifest audit hard:0.

BEFORE MERGING TO MAIN — run the BROWSER gates Codex required (can't be done offline):
1. Serve over http (`python3 -m http.server`), hard-refresh: talk generation works, guideline chips present.
2. Direct-link / reload into a shared talk: still loads.
3. Failure mode: temporarily rename guidelines.json → generation is blocked with the visible error + Retry (never a silent talk).
4. Mobile Safari: one generation succeeds.
5. Deploy check: confirm guidelines.json is actually published next to index.html (GitHub Pages serves repo root; fetch is `guidelines.json?v=BUILD_ID`).
Then merge + push. INTERIM edit rule below still applies (edit guidelines.json, re-run the 3 scripts).

--- original decision (kept for context) ---
Decision: DO IT, but as a controlled migration AFTER launch UX + smoke testing — not a pre-launch cleanup.

Current (duplicate representations, derivative can go stale):
  index.html GUIDELINES  →  guidelines_extracted.json  →  guidelines_manifest.json
Target (edit once, no stale copy):
  guidelines_manifest.json  →  app retrieval/generation, validators, ingestion

Why later: the migration rewrites the hot path (`getGuidelinesForTopic` keyword→specialty matcher + prompt-context assembly in generate()). Destabilizing that right before launch is the wrong risk. The stale-derivative problem is mitigated for now (derivatives resynced 2026-07-21; `audit_manifest.mjs` is the guard).

When implementing:
1. PRESERVE the existing topic→specialty keyword matching exactly.
2. Add EQUIVALENCE TESTS proving `getGuidelinesForTopic(topic).context` is byte-identical before vs after the migration across a topic corpus (HFrEF, hyponatremia, COPD, AKI, cirrhosis, ANCA, etc.).
3. Then delete the GUIDELINES object from index.html and load the manifest instead.

INTERIM RULE until then: after editing GUIDELINES in index.html, ALWAYS re-run
`node rag/extract_guidelines.mjs && node rag/build_manifest.mjs && node rag/audit_manifest.mjs`
(audit must report hard: 0) so the derivative never drifts again.

## BACKLOG (not launch-blocking)
- **UX polish (Jenni 2026-07-21):** the floating kebab menu (Copy link / Share / Make private / Export PDF / Save as image / Print / Delete) is fiddly — make it easier to hit; **make Share a first-class, more prominent action** rather than buried in the kebab.
- **Boards difficulty system (Jenni 2026-07-21):** calibrated 5-star difficulty selector in Boards mode — see report + spec; recon done (functions mapped). Critique lives in the Worker, not index.html → difficulty self-critique baked into BOARDS_PROMPT.
- **Deferred trials:** Oncology (29), Ophthalmology (5), Dermatology (4) — own curated pass so oncology doesn't swamp general IM. Same pipeline.
- **Batch 3 clinical audit** — Codex hasn't reviewed the 19 newest trials' teaching notes trial-by-trial (PMIDs already verified).
- **Guideline layer:** populate the empty `do_not_teach`/`supersedes`/`caveats` from `DO_NOT_TEACH_REVIEW.md`; merge the two ANCA vasculitis entries; soften KDIGO GD "base being retired" wording.
- **RAG currency:** the PubMed corpus ingest is ~6 months stale — refresh `rag/ingest_pubmed.mjs` when convenient.
- **Cost lever:** consider Kimi K2.6 / DeepSeek via OpenRouter for *generation* (~80-90% cheaper, one model-string swap). Keep OpenAI for embeddings (swapping = re-ingest everything). A/B on golden topics before switching.

## Launch
- Rework `DEMO_SCRIPT.md` (exists from May). Script around trial-heavy topics where evidence is strongest (Diuretic Classes in HF was your cleanest talk).
- Launch copy framing (per Codex): "educational beta — grounded in retrieved sources; physicians verify primary sources." NOT "validated database."
- Two featured talks to unpublish/regenerate first: **Infective Endocarditis** and **Peritoneal Dialysis** were 100% uncited (see `PROFILE_TALK_AUDIT.md`).

---
**One-line status for your own head:** evidence foundation is done and verified (263 trials, 214 live tonight / 263 after tomorrow's ingest). Remaining work is UX + launch prep, none of it blocked by data.
