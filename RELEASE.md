# Release sequence — shipping `launch-integration`

(First-time Worker setup lives in `DEPLOY.md`. This is the procedure for shipping a branch.)

State 2026-07-28: `origin/launch-integration` = `058b9ac`, **92 commits ahead of `main`**, all pushed.
`main` = `676fa81` (2026-07-21). **GitHub Pages serves `main`, so the live site is still the old code.**

---

## A · Use the new build TODAY without deploying anything

You do not need to deploy to start writing talks. With your own key the app calls Anthropic directly
(`anthropic-dangerous-direct-browser-access`) and never touches the Worker:

```
cd ~/Developer/chalk-talk
git checkout launch-integration
python3 -m http.server 8000        # "address already in use" just means it's already running
```

Open <http://localhost:8000> → **Set key** in the header → paste your Anthropic key.

- Writes and reviews with `claude-opus-5`, the only model the frozen benchmark has cleared.
- Bypasses the Worker entirely, so none of the coupling in §B applies.
- Billed to your own key; the Worker's $250 cap is not involved.

This is the recommended way to use the new build while the stabilization gate is still open.

---

## B · The coupling — read this before deploying either half

| | writes with | Worker side |
|---|---|---|
| **live site** (`main`, build 2026-07-21-08) | `claude-opus-4-8` | deployed Worker: opus-4-8 ✓, **opus-5 ✗** |
| **new build** (`launch-integration`, 2026-07-27-01) | `claude-opus-5` | new Worker: **only `claude-opus-5` may write** |

- Deploy the **Worker alone** → the live site still asks for `claude-opus-4-8` to write, the
  fail-closed `WRITER_CLEARED` gate refuses it, **generation breaks for everyone**.
- Deploy the **front-end alone** → the new site asks for `claude-opus-5`, the deployed Worker's
  `ALLOWED_MODELS` rejects it, **generation breaks for everyone**.

They ship together. A few seconds of gap is unavoidable; the order in §C minimises it.

> **Do not "fix" the window by adding `claude-opus-4-8` to `WRITER_CLEARED`.** That list is the
> fail-closed gate keeping unbenchmarked models from writing medical teaching content. Widening it for
> deployment convenience defeats the only thing it does.

BYOK users are unaffected by any of this — they never hit the Worker.

---

## C · Full deploy

**Prerequisite — confirm the Worker secret is set** (this was missing once before):

```
cd ~/Developer/chalk-talk
npx wrangler secret list          # expect ANTHROPIC_API_KEY
```
If missing: `npx wrangler secret put ANTHROPIC_API_KEY`

**1 · Merge and push the front-end**

```
git checkout main
git merge --ff-only launch-integration     # refuses rather than making a surprise merge commit
git push origin main
```

**2 · Wait for Pages to go green** in the Actions tab. Do not proceed while it is still building.

**3 · Deploy the Worker immediately after** — ~10 s, and it closes the window:

```
npx wrangler deploy
```

**4 · Smoke test on the LIVE site, not localhost**

- [ ] Hard-reload; footer build reads **2026-07-27-01**
- [ ] Concise lecture → renders, provenance line at the **foot**, no console errors
- [ ] Boards question → 5 choices, exactly one correct, explanation present
- [ ] Detailed toggle on a finished talk → expands in place, does **not** wipe the talk
- [ ] Check for updates → amber prompt, proposals verified, refusals listed with reasons
- [ ] Apply an update, then Refine → **the added reference survives**
- [ ] Signed-out / free tier → returns a talk (exercises the Worker's own key)

**5 · Roll back BOTH halves together if anything fails**

```
git checkout main && git reset --hard 676fa81 && git push --force-with-lease origin main
npx wrangler rollback
```

---

## D · Still open before this is ready for other people

The stabilization gate in `NEXT_SESSION.md` is not finished:

1. **Runtime click tests** — the 10 paths above, against localhost first.
2. **Independent diff review** by Codex across all 92 commits.
3. **Twenty judge-flagged medical claims unreviewed** — `rag/runs/2026-07-27-gpt-5.6-sol-paired.md`.
   No automated check in this repo can see any of them.
4. **No drug-name guard in production.** The RxNorm check exists only in the benchmark harness. Opus
   produced zero misspellings across 19 rows — that is the model behaving, not a check catching.

§A (local, your own key, you reading your own talks before teaching from them) is a reasonable risk
today. Serving this to residents is not, until at least 1–3 are done.
