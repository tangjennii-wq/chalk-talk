# Codex Onboarding Prompt — Chalk Talk

Copy-paste this into Codex as your initial / system message when you want help editing the app.

---

## Project

**Chalk Talk** is a single-file HTML web app that generates 10-minute Internal Medicine teaching talks for resident physicians. The user (Jenni Tang, MD — IM/Nephrology resident at NYU) types a topic, the app retrieves matching evidence, drafts a structured talk via Claude, peer-reviews it with a second model, and renders it in a teaching-friendly format.

Hosted at `https://tangjennii-wq.github.io/chalk-talk/` (GitHub Pages, no build step).

## Tech stack

- **Frontend:** single `index.html` (vanilla JS, no framework, no build, ~600KB). Pure DOM manipulation via `render()` which rebuilds the page on every state change. No React, no Vue, no bundler.
- **Backend:**
  - **Supabase** for auth (email magic link + Google OAuth), cloud-stored library (`talks` table), profiles, favorites, public sharing
  - **Cloudflare Worker** (`worker.js`) — proxies LLM calls to Anthropic + OpenAI, enforces rate limit per IP, holds API keys
  - **`/share/:token`** endpoint on the Worker serves public talks via Supabase REST + 5-min edge cache
- **LLMs used:**
  - Anthropic Claude (Sonnet for drafting, Haiku for critique pass)
  - OpenAI text-embedding-3-small for RAG retrieval over PubMed corpus in Supabase
  - OpenAI `gpt-image-1.5` and Google Gemini `nano-banana-pro` for optional visual aids

## File layout

```
chalk-talk/
├── index.html              # The whole app — UI, state, prompts, rendering, all of it (~600KB)
├── worker.js               # Cloudflare Worker: AI proxy + /share/:token endpoint
├── wrangler.toml           # Worker config + KV namespace
├── samples.json            # 11 hand-curated sample talks for the landing page
├── rag/
│   ├── trial_expansions.json   # 98 landmark trial cards (auto-injected per topic)
│   └── (legacy files)          # Tier 1 ingestion stubs, deprecated
├── supabase/
│   └── migrations/         # SQL migrations (applied via dashboard, not autorun)
├── generate_samples.js     # Build script for regenerating sample talks
└── DEPLOY.md               # Cloudflare + Supabase + GitHub Pages setup notes
```

The user accesses the running app at `https://tangjennii-wq.github.io/chalk-talk/`. The `worker.js` is deployed via `wrangler deploy` from `~/Developer/chalk-talk/` on the user's MacBook.

## Architecture — the state machine

There is one global object `S` declared near line 4135 of `index.html`. `S` holds **everything**: current topic, style, depth, the generated talk, UI flags, auth state, cloud library cache, the audio queue intent, the generation-id counter, etc.

After any change to `S`, code calls `render()`. `render()` is a single ~3000-line function that rebuilds the entire `<div id="app">` via `innerHTML` based on the current `S`. After `render()`, `bindHandlers()` re-attaches event handlers to the freshly-created DOM nodes by ID/class.

There is no virtual DOM, no React-style reconciliation, no Svelte/Vue reactivity. It's vanilla. This is intentional — the whole app is one file with no build step, deploys instantly via GitHub Pages, runs anywhere with a browser. Don't suggest adding a framework. Adding one would mean abandoning the entire architecture.

State subtleties to know:

- `S.talk` — the current talk JSON. When `null`, the home/compose page renders. When set, the talk-render page renders. The whole UI bifurcates on this.
- `S.loading` — true during generation. Hides compose controls and shows a progress card. Cancelable. Has live in-flight settings (Depth, Verify-with-current-literature, Queue-audio) that restart generation cleanly via `restartGen()` / `genId` counter.
- `S.genId` — incremented every `generate()` call. The function captures `_myGenId` locally; before assigning `S.talk = finalTalk` it checks if `_myGenId !== S.genId` and silently drops stale results. This is what allows mid-flight setting changes.
- `S.isSampleTalk` — true when viewing one of the 11 hand-curated samples. Save defaults to "save as new" so editing a sample doesn't overwrite the template.
- `S.sharedTalk` — true when viewing a public-shared talk loaded via `/share/<token>`. Hides Save/Edit/⋮ — read-only mode.
- `S.loadedTalkId` — non-null when a talk was loaded from the library (vs freshly generated). Used to trigger "update existing vs save as new" prompt.

## The LLM prompts live in the file

Three system prompts you should know about:

- **`LECTURE_PROMPT`** (around line 1266) — main generation prompt for Lecture-style talks. Defines the JSON schema for the output, the reasoning order, the citation requirements, the Visual Memory Card quadrants (`top_left` = MECHANISM, `top_right` = FINDINGS, `bottom_left` = WORKUP, `bottom_right` = TREATMENT), and a recently-added DRUG NAMES guidance block listing canonical INN spellings for high-frequency drug classes.
- **`BOARDS_PROMPT`** (around line 1268) — generation prompt for ABIM board-style practice questions. UWorld/MKSAP stem format, 5 choices, distractor design rules, ABIM blueprint classification.
- **`critiqueSystem`** (around line 5913) — second-model peer-review prompt. Checks for factual errors, outdated guidelines, internal contradictions, wrong trial attributions, shallow physiology, and drug-name misspellings. Returns either `{"verdict":"clean"}` or the full corrected talk JSON.

The drug-name guidance was added 2026-06-08 after the LLM produced "rivarelbaxaban" instead of "rivaroxaban." It lists Xa inhibitors, P2Y12 inhibitors, SGLT2i, GLP-1 agonists, ACEi, ARBs, BBs, statins, ABx, antifungals, biologics, TKIs, checkpoint inhibitors — all in their canonical INN spellings — and tells the model to use a brand name (Xarelto, Eliquis, Plavix) if uncertain rather than guess.

## Render & UI conventions

- CSS variables in `:root` (around line 30): `--plum`, `--plum-deep`, `--plum-rich`, `--cream`, `--lavender-bg`, `--lavender-soft`, `--ink`, `--ink-muted`, `--ink-soft`, `--line`, `--line-soft`.
- Inline styles preferred over CSS classes for one-off positioning. Use classes for repeated patterns (`.tk-capsule`, `.cap-actions`, `.cap-save`, `.tk-acc-head`, `.outline-head`, `.overflow-menu`, etc.).
- Section headings: `.tk-acc-head .tk-acc-ttl` — uses ellipsis on mobile.
- Edit affordance: amber-gold ✎ icon (no pill background) — appears on each section header in Lecture mode.
- Capsule header on every rendered talk: `+ New talk` outlined pill (left) → Undo (if history) · Save pill · ✏️ Edit settings · ⋮ overflow (right).
- Mobile breakpoint is `640px`. There's a tighter `430px` rule for the hero card. There's a third `720px` rule for the Slides poster.
- Mobile-specific rules force `font-size: 16px` on all `<input>` and `<textarea>` to suppress iOS Safari's auto-zoom-on-focus.

## Tabs in the talk-render view

`S.tab` toggles between four views of the same talk:

1. **`overview`** — accordion lesson outline, expandable sections, citation chips, References block, Guidelines pill, RAG sources. Has a "📊 See this as a one-screen poster" CTA at the bottom that switches to Slides.
2. **`slides`** — single-screen visual poster (`#slidesCapture`). Hero title band → 4-tile flow (Pathophys → Diagnosis → Treatment → Findings) → Teaching Pearls + Board Tips callouts → Key Takeaways → References band. The whole `#slidesCapture` div is captured by html2canvas when user hits "📸 Save as image."
3. **`visual`** — optional AI-generated illustration via Gemini Nano Banana Pro or OpenAI gpt-image-1.5.
4. **`audio`** — TTS podcast version. Generated on-demand via the in-tab "Generate Podcast" button. The home page also offers a "Queue audio version" toggle during loading; when toggled, audio auto-fires after generation completes.

## Image exports are JPEG (since 2026-06-08)

The four export paths all output JPEG at quality 0.92 instead of PNG. Visually lossless for poster/text content, ~5–10× smaller files for messaging apps. Filenames end in `.jpg`. Don't switch back to PNG unless you need transparency.

## Public sharing

A talk's `is_public` column (Supabase `talks` table) drives sharing. The `share_token` column is a UUID. A trigger called `trg_scrub_on_publish` (defined in `supabase/migrations/add_sharing_scrub.sql`) runs BEFORE INSERT OR UPDATE OF `is_public` — if `is_public` becomes true, it nulls `refine_context` (user-uploaded MKSAP/copyrighted excerpts) and strips `imgB64` base64 from `talk_json.savedVisuals[]`. Public viewers fetch via the Worker's `/share/:token` endpoint, which uses the Supabase anon key (RLS allows anon SELECT where `is_public = true`).

## Working style preferences

- **Terse responses.** Don't summarize what you just did at the end of every reply — the user can read the diff.
- **Push back if you disagree.** The user values an opinion. If a request will produce a bad outcome, say so before shipping.
- **Ship fast.** Small iterations, frequent commits. The user runs the app in production via GitHub Pages — every push lands live on her phone within ~60 seconds.
- **No build step.** Don't introduce TypeScript, bundlers, frameworks, or test runners. The file must remain editable and deployable as-is.
- **Don't auto-add tests.** There is no test suite. Smoke-testing is manual on mobile (iPhone Safari) and desktop. Don't suggest Jest, Playwright, etc.
- **Comments in the file are signed.** When the user makes a UX decision, the comment includes "(Jenni YYYY-MM-DD)" so future-you knows the design rationale's source. Mirror this convention.
- **The user is an MD, not a software engineer.** Explain technical tradeoffs in product-impact terms first, technical detail second. Don't lecture.

## Things to avoid

- Never echo API keys, GitHub tokens, or Supabase service-role keys back to chat. The user has accidentally pasted secrets before — always remind to rotate immediately at the provider dashboard if leaked.
- Never auto-add tracking, analytics, or telemetry.
- Don't store paywalled full-text (NEJM, JAMA, Lancet) in the repo or DB.
- Don't re-share user-uploaded MKSAP / copyrighted reference material — the scrub trigger handles this automatically, but never write code that re-exposes `refine_context` or `imgB64` on a public talk.
- Don't break the single-file architecture. If you propose splitting `index.html`, justify it strongly first.

## Recently-shipped (week of 2026-06-08, for context)

- Phase 1 sharing infra (publish/unpublish, share modal, public viewer, 🌐 badge on library cards)
- Generation state UX overhaul (Cancel button, progress card, live Depth/Verify/Audio controls, genId stale-drop)
- Mobile UX cluster (hero shrink, single-line titles, outline-head reflow, composer fix, no-zoom inputs)
- Slides poster (4-tile flow with Pathophys/Diagnosis/Treatment/Findings, callouts, takeaways, References band)
- Image exports switched PNG → JPEG @0.92
- Drug-name spell guidance in all three LLM prompts

## How to verify your changes

After editing, the user will:
1. Push `index.html` via GitHub Desktop → GitHub Pages auto-deploys in ~60s
2. `wrangler deploy` from `~/Developer/chalk-talk/` for any `worker.js` change
3. Apply any new SQL migration via Supabase Dashboard → SQL Editor
4. Hard-refresh (Cmd+Shift+R) on her phone (Safari) and desktop and walk through the affected flow

There is no CI, no smoke-test script. Your "test" is the user reporting back whether it works.

---

End of onboarding. Start by asking what specifically the user wants changed.
