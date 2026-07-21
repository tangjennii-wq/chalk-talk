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

## BACKLOG (not launch-blocking)
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
