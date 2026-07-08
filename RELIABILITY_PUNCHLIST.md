# Chalk Talk — Reliability Punch List

_Last updated: 2026-07-07_

Purpose: make the app **boringly reliable** before adding more features. Framing comes from Codex's
objective review (below) plus the bug passes done this week. Ordered P0 → P2. Check items off as done.

---

## Codex's take (the "why" behind this list)

> The app has evolved from "single-file simple" into "single-file complex." Generation, auth, sharing,
> library, provider routing, uploads, async jobs, model keys, image/audio/export all live close
> together — so **most bugs now come from state intersections, not any one feature.** The states that
> multiply: logged in/out · sample/shared/saved/fresh · free-tier/BYOK · Claude/Gemini/ChatGPT ·
> async/sync · lecture/boards · concise/detailed.
>
> Product: the best version isn't "more knobs" — it's "Jenni presses Generate and gets something she
> trusts." Keep advanced controls hidden unless needed. Auto model selection beats visible switching
> (users care about output quality, not provider identity, unless they need a key/workaround).
> Showcased lectures as default samples is the right move — the app feels authored, not demo-seeded.
>
> Engineering: keep single-file for now, but enforce stricter internal boundaries (generation /
> provider / library / render sections; fewer cross-cutting globals). **Highest-value next work is
> reliability, not features:** parse repair, async fallback, quota correctness, uploaded-reference
> robustness, better error messages.
>
> Bottom line: compelling, real-use app. The danger is feature momentum making it brittle. Spend the
> next few passes making it boringly reliable and it could be genuinely excellent.

---

## ✅ Already done this week

- Async quota invariant fixed (server-side consume on the async path; frontend consumes only sync;
  each generation charges exactly once, closed-tab jobs still charge).
- Async submit falls back to sync silently when `JOBS_KV` is absent or submit fails.
- Superseded-generation guards (a restarted async poll can't stomp the new gen or delete its reconnect key).
- Image-key operator-precedence bug (a free-tier 401 no longer wipes the user's saved OpenAI key).
- Refine consumes quota only after its JSON parses (malformed refine no longer burns a credit).
- Gemini text model fixed (`gemini-3-pro` was dead → `gemini-3.1-pro-preview`).
- **Reference-upload robustness**: shared validated handler (type + size + count caps, per-file error
  handling, dedupe, clear reject toast; fixed the multi-file closure bug).
- **Error-message cleanup**: `humanizeError()` maps leaky raw errors to plain guidance across generate,
  resume, refine family, and image gen.

---

## P0 — do before the next real teaching use

- [ ] **Deploy + verify the async path live.** `wrangler deploy` (JOBS_KV now bound) + `git push`.
      Then confirm on a phone: start a talk, lock the screen, come back — it completes. Confirm quota
      decrements exactly once. This is the one thing that can only be validated live.
- [ ] **Run the sharpened Codex review** (`CODEX_REVIEW_PROMPT.md`) against the deployed build and
      triage its findings into this list.
- [ ] **State-intersection smoke test** (the real bug source per Codex). Walk a short matrix by hand:
      {logged out, free-tier, BYOK-Claude, ChatGPT, Gemini} × {lecture, boards} × {generate, refine,
      image}. Note anything that errors, double-charges, or shows a raw message.
- [ ] **Direct-endpoint auth check.** Confirm `/v1/messages`, `/generate-async`, `/v1/openai/chat`
      reject missing/invalid Supabase auth and never run on the owner's key except intended paths.

## P1 — reliability hardening (the core of Codex's "boringly reliable")

- [ ] **Parse-repair coverage.** Audit every `JSON.parse(fixJSON(...))` site (there are ~10) — each
      should be inside a try/catch that yields a humanized error, and `fixJSON` should strip
      preamble/postscript and handle a maxToken-truncated tail. Add a couple of adversarial fixtures
      (preamble text, trailing prose, truncated JSON) and assert `fixJSON` recovers.
- [ ] **Provider parity for ChatGPT/Gemini.** Verify their failures (auth, rate limit, timeout, bad
      JSON) surface cleanly, never fall through to Claude, never touch quota, and get the same
      parse-repair treatment as Claude.
- [ ] **Two parsers, one behavior.** The browser SSE streaming parser and the Worker non-streaming
      parser must both ignore `tool_use`/`input_json`/search-result blocks identically (regression:
      tool-arg JSON leaking into the talk text).
- [ ] **Reconnect UX.** Reload mid-async currently re-polls and renders but skips depth-merge/auto-save.
      Decide if that's acceptable or if a resumed talk should offer Save.
- [ ] **Boards output guarantees.** Enforce (in code, not just the prompt) alphabetized choices +
      non-empty `key_point` on the rendered object, so a bad model response can't ship a malformed item.
- [ ] **Timer/interval leak sweep.** Confirm every `setInterval(loadTimer)` path clears on all early
      returns (async cancel, stale-gen, submit-fail-to-sync).

## P2 — structural & product (reduce future brittleness)

- [ ] **Internal boundaries (no build step).** Group the single file into labeled sections —
      `// ===== GENERATION =====`, `PROVIDERS`, `LIBRARY`, `RENDER`, `AUTH/CLOUD` — and shrink
      cross-cutting globals on `S` where feasible. Makes state-intersection bugs easier to isolate.
- [ ] **Lean toward auto model selection.** Per Codex, default users to "just works" (Claude free) and
      surface provider/model choice only when a key/workaround is needed. Consider collapsing the model
      picker further so the default path has zero knobs.
- [ ] **Centralize state resets.** Several handlers hand-clear the same ~8 `S` fields
      (`S.dg`, `S.dgErr`, `S.podScript`, …). One `resetTalkView()` helper removes copy-paste drift.
- [ ] **Better empty/edge states.** Uploaded-file list, out-of-quota, paused-tier, offline — confirm
      each has a clear, non-technical message and an obvious next step.
- [ ] **Lightweight self-check on generated talks.** Optional: a fast client-side sanity pass (required
      fields present, no empty sections/VMC) before render, with a quiet auto-retry on failure.

---

### Notes

- Keep the single-file architecture for now — the goal is stricter internal discipline, not a rewrite.
- Prioritize reliability over features for the next few passes (Codex's explicit recommendation).
