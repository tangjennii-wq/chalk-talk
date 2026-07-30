# Workflow runtime probe

Confirms four Cloudflare behaviours that the docs leave open, before the new Chalk Talk architecture is
deployed. **It does not touch Chalk Talk.** Separate Worker, separate name, no shared bindings, no
production routing changed, no paid API called. Roughly 10–15 minutes including cleanup.

I can't run it — my sandbox has no route to Cloudflare and no credentials — so this is yours. Everything
else is prepared.

> ### ⚠ One thing to avoid while the probe is outstanding
>
> The **root** `wrangler.toml` already carries the new `main = "worker_entry.js"` and the
> `[[workflows]]` binding, because those are committed. So running `npx wrangler deploy` **from the repo
> root** would deploy the new Chalk Talk architecture — the thing we agreed not to do until the probe
> passes.
>
> The script below cannot do that: it `cd`s into this folder and uses *this* folder's `wrangler.toml`,
> which describes a separate Worker (`chalk-talk-workflow-probe`) with its own KV namespace, no API keys,
> and no routes. Just don't deploy from the root until the results are in.

---

## The one command

```bash
bash ~/Developer/chalk-talk/rag/workflow-probe/run-probe.sh
```

It creates the KV namespace, writes the id into `wrangler.toml` itself, deploys, reads the URL out of
wrangler's own output, runs all four probes, and prints a verdict. Paste the output back.

> **Why a script rather than commands to copy.** The first attempt failed three ways, none of them your
> typing: interactive zsh does **not** treat `#` as a comment, so my trailing "# paste id here" was
> passed to wrangler as arguments; the `cd` was relative so it failed from your home directory; and
> `<subdomain>` in a curl line was read by the shell as a redirect. The script has no inline comments on
> command lines, uses absolute paths, and never asks you to substitute a placeholder.

---

## If you'd rather run it step by step

Each line is safe to paste on its own. **Do not append comments to these lines.**

```bash
cd ~/Developer/chalk-talk/rag/workflow-probe
```

```bash
npx wrangler kv namespace create PROBE_KV
```

That prints a 32-character hex id. Open `wrangler.toml` in this folder and replace
`PASTE_THE_ID_FROM_THE_COMMAND_ABOVE` with it.

```bash
npx wrangler deploy
```

Deploy prints the URL. Yours is:

```bash
curl -sS https://chalk-talk-workflow-probe.chalktalk.workers.dev/
```

The **first** call starts four workflow instances and returns immediately. Wait ~45 seconds and call the
**same URL again** — it reports either `N/4 finished` or the full verdict. Keep calling until you get the
verdict; each call is instant.

To discard a run and start over:

```bash
curl -sS https://chalk-talk-workflow-probe.chalktalk.workers.dev/reset
```

### If wrangler complains about `~/.Trash`

That happened when it was started from your home directory — it walks upward looking for config and
trips over a folder it can't read. Running from `rag/workflow-probe` (as above) avoids it.

---

## What you should see

The script starts four workflow instances, then polls every 10 seconds and prints the verdict:

```
    [10s] run r5k2j1: 2/4 finished — {"limit0":"errored","limitN":"running",...}
    [20s] run r5k2j1: 3/4 finished — ...

CLOUDFLARE WORKFLOW RUNTIME PROBE
=================================

OK  limit:0 — ...
OK  limit:3 produced N execution(s) → ...
OK  NonRetryableError with limit:5 ran the callback 1 time(s). Stops immediately, as documented.
OK  step caching: the completed first step ran 1 time(s) ...
```

Four `OK` lines means every assumption under `generation_workflow.js` holds. Any `!!` means one doesn't.

> **On the first attempt this returned Cloudflare error `1104`.** The Worker was creating all four
> instances and then polling them *inside the same request*, holding one HTTP request open for up to six
> minutes. I don't know precisely what 1104 means and haven't guessed — the fix doesn't depend on it. A
> request shouldn't sit blocked for minutes waiting on background work, which is the same mistake as the
> `ctx.waitUntil` bug this probe exists to investigate, wearing a different hat. The Worker now starts
> the instances and returns immediately; the *script* does the waiting.

| | question | expected | if it differs |
|---|---|---|---|
| Q1 | Is `retries: { limit: 0 }` accepted, callback running once? | either answer is fine | Informational only. Chalk Talk uses `limit: 1` deliberately and never `limit: 0`. |
| Q2 | Does `limit: 3` give **3** executions or **4**? | either; we need the fact | If 4, `limit` means 1 + N retries, so `PAID_RETRY`'s `limit: 1` permits **two** executions of a paid call. I'll write the real number into the source. |
| Q3 | Does `NonRetryableError` stop after 1 execution despite `limit: 5`? | **exactly 1** | More than 1 is serious — a paid call could repeat despite the guard, leaving the attempt marker as the only protection. |
| **Q4** | **Is a completed step re-executed when a later step fails?** | **first step ran exactly 1** | **Stop and tell me.** Splitting draft from critique exists solely so a critique failure never re-buys the draft. If completed steps aren't cached, the design doesn't hold and needs rethinking, not tuning. |

Only Q4 can invalidate the architecture. Q1–Q3 can each go the wrong way without breaking it, because
`limit: 1`, `NonRetryableError` and the attempt marker are three independent defences and the marker
refuses to re-issue a paid call however the retry count is interpreted.

---

## Cleanup — the probe is temporary

```bash
cd ~/Developer/chalk-talk/rag/workflow-probe
```

```bash
npx wrangler delete
```

Confirm when prompted. Then remove the namespace, which needs the id now sitting in `wrangler.toml`:

```bash
npx wrangler kv namespace list
```

```bash
npx wrangler kv namespace delete --namespace-id PASTE_THE_PROBE_ID_HERE
```

Nothing else to undo: no production routing was changed and Chalk Talk was never deployed.

---

## After the results

**Do not deploy the new Chalk Talk architecture until these pass.** With four `OK`s the order is:

1. server-side approved-writer allowlist
2. server-side quota enforcement
3. end-to-end click test — start, reload, reconnect, finish, cancel, duplicate submit
4. deploy Worker and frontend together

The guarantee stays **at-most-once, fail-closed** regardless of what the probe returns. Nothing here can
make it exactly-once; that needs confirmed idempotency support from Anthropic's Messages API, which I
could not verify because the reference page is client-rendered and returned only "Loading…" to a fetch.
