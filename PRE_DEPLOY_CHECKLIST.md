# Pre-deploy checklist — build 2026-07-28-03

State: `launch-integration`, **102 commits ahead of `main`**, working tree clean, 19 suites / 746
assertions green. The live site is still `main` (build 2026-07-21-08), so **nothing you did today is live**.

Two different bars, and it matters which one you are aiming at:

- **Bar A — you use it.** You are a nephrologist reading your own talks before you teach from them.
- **Bar B — residents use it.** Someone trusts the output without your read.

Everything in §1 applies to both. §3 is what separates them.

---

## 1 · Must do before you deploy anything

### 1.1 Let the teaching-transfer run finish ⬜
It is mid-flight and reads `index.html` at startup. Switching branches under it produces a result you
cannot interpret. Wait for `rag/runs/teaching-transfer-*.json` to appear.

### 1.2 One real Boards generation on build -03 ⬜  ← **the actual gap**
The choice shuffle is verified two ways — 19 harness assertions, and 300 runs of the real
`_repairBoardQuestionInPlace` inside the live browser (placement A:65 B:59 C:63 D:57 E:56, identity and
key preserved). **What has NOT been tested is a full round trip**, and the change touched
`BOARDS_CRITIQUE_PROMPT` as well as the writer prompt. The critic used to be told to re-sort choices
alphabetically; it is now told not to reorder. Nobody has watched a real critic obey that.

```
# localhost:8000, Boards mode, any topic
```
Check: question renders · 5 choices · exactly one correct · explanation present · **and the keyed
letter is not always C/D/E across a few runs.**

### 1.3 One real Lecture generation on build -03 ⬜
Confirms the copy rewrite did not break the generation path. Check the new wording appears —
"Checking it", "Writing your talk", "N papers found to cite from" — and no console errors.

### 1.4 Confirm the Worker secret ⬜
```
npx wrangler secret list          # expect ANTHROPIC_API_KEY
```
This was missing once before. If absent: `npx wrangler secret put ANTHROPIC_API_KEY`.

### 1.5 Push the branch ⬜
```
git push origin launch-integration
```
Changes nothing live. Just gets 102 commits off your laptop.

---

## 2 · Deploy — the two halves must ship together

**The live front-end writes with `claude-opus-4-8`. The new Worker's fail-closed `WRITER_CLEARED` gate
permits only `claude-opus-5`.** So deploying either half alone breaks generation for everyone. Do not
"fix" the gap by widening `WRITER_CLEARED` — that list is the only thing stopping an unbenchmarked model
from writing medical teaching content.

```
git checkout main
git merge --ff-only launch-integration     # refuses rather than making a surprise merge commit
git push origin main
# WAIT for the Pages build to go green in the Actions tab
npx wrangler deploy                        # ~10s — this closes the window
```

### 2.1 Smoke test on the LIVE site, not localhost ⬜

- [ ] Hard-reload; footer build reads **2026-07-28-03**
- [ ] **Depth is gone from the compose panel** (this is how you will know the deploy actually landed)
- [ ] Concise lecture renders · provenance line at the foot · no console errors
- [ ] Boards question · 5 choices · one correct · **keyed letter varies across runs**
- [ ] Detailed toggle expands in place, does not wipe the talk
- [ ] Check for updates → amber proposals, refusals listed with reasons
- [ ] Apply an update, then Refine → **the added reference survives**
- [ ] **Reload mid-generation → the talk resumes and stamps provenance** ← never tested; needs the Worker
- [ ] **Signed-out / free tier returns a talk** ← never tested; needs the Worker

The last two are the reason the smoke test matters more than usual. They are click-test paths 8 and 10,
they could not run locally in BYOK mode, and **the resume path is what mobile generations actually use** —
it is also the path that silently stamped no provenance until it was fixed.

### 2.2 Roll back BOTH halves together if anything fails ⬜
```
git checkout main && git reset --hard 676fa81 && git push --force-with-lease origin main
npx wrangler rollback
```

---

## 3 · Before residents use it (not blocking your own use)

### 3.1 Grade the 10 generated questions ⬜
`rag/runs/question-set-2026-07-28-22-28.md` — Part 1 blind, then Part 2. Automated checks passed 10/10
on internal key consistency, **which only means `correct_letter` matched the option the same model
flagged.** A confidently wrong key scores 10/10. Only your read establishes correctness.

**Q6 (immune thrombocytopenia) needs your call specifically.** The vignette is well built — 8 months,
steroid-dependent with toxicity, and *anti-HBc positive*, which is a deliberate argument against
rituximab. But the explanation itself says the ASH recommendation is **conditional, very low certainty**.
A single-best-answer item keyed on a conditional low-certainty recommendation may not have an
unambiguously best answer, which the prompt itself requires. Is "TPO-RA over rituximab" firm enough to
key on, or is it reasonable-people-differ?

### 3.2 The 20 judge-flagged claims from the paired benchmark ⬜
`rag/runs/2026-07-27-gpt-5.6-sol-paired.md`. Ten per arm, none visible to any automated check. Start with
Claude's #3 (SALSA credited with a non-significant primary outcome) and #4 (pregnancy listed as an ODS
risk factor).

### 3.3 Independent diff review ⬜
102 commits. Codex has not reviewed the day's work end to end.

---

## 4 · Known, logged, NOT blocking

| id | what | why it can wait |
|---|---|---|
| D-1 | Retrieval returns off-topic papers (0/8, 0/8, 1/8) | They are a citation pool, not source material — the talk is taught from model knowledge either way. The footer now says "N papers found to cite from" rather than "Grounded in". Real waste, not a safety issue. |
| D-3 | `S.genPhase` never resets after success | Latent; not user-visible on any tested path. |
| D-4 | Library "Open" — could not confirm it loads the clicked talk | Unresolved, not demonstrated. The opened tab had no `#t=` hash, so it may simply have been a session restore. Re-test deliberately. |
| — | No drug-name guard in production | The RxNorm check exists only in the benchmark. Opus produced zero misspellings in 19 rows, but that is the model behaving, not a check catching. |

---

## The one-line version

**§1 is about 15 minutes and is genuinely required** — mostly because a Boards round trip has never run
on this build and the critic prompt changed. **§3 is what stands between "Jenni uses it" and "residents
use it", and only you can do most of it.**
