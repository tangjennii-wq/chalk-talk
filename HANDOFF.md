# Chalk Talk — session handoff (paste this into a new Claude chat)

I'm continuing work on **Chalk Talk**, a single-page web app (`index.html`, vanilla JS) that
generates 10-minute teaching "chalk talks" for internal-medicine educators. Backend is a
Cloudflare Worker (`worker.js`) + Supabase. The folder is open in Cowork.

## What was done in the last session

**1. Faster generation (LIVE — already pushed):**
- Progressive section rendering: talks now build section-by-section in real time during
  generation instead of showing a blank spinner. Driven by a tolerant partial-JSON parser
  (`parsePartialJSON` in `index.html`) feeding a live preview in the loading state.
- Concise is the default depth; **Detailed is gated** until the concise talk is generated
  (you upgrade afterward via the in-talk toggle).
- Kept Opus 4.8 as the draft model. Peer-review step still blocks before display (intentional).

**2. Free tier — 5 free talks + 5 free images (BUILT but DORMANT, not deployed):**
- Signed-in users with no API key generate on my Anthropic key via the Worker; after 5 they're
  prompted to add their own key (BYOK goes direct, untouched). $400/mo system spend cap.
- Code is committed but **switched OFF** via `FREE_TIER_CONFIG = { enabled: false }` in
  `index.html`. With it off, the app behaves exactly as before. Nothing free-tier activates.
- Backend NOT deployed yet: migration not applied, Worker not redeployed.

Files for the free tier: `worker.js` (free-tier endpoints), `supabase/migration_v3_free_tier.sql`
(new tables/functions), and `FREE_TIER_DEPLOY.md` (the deploy checklist).

## What I want to do next

Help me **launch the free tier**. The steps are in `FREE_TIER_DEPLOY.md`:
1. Apply `supabase/migration_v3_free_tier.sql` in Supabase.
2. `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`, then `wrangler deploy`.
3. In `index.html`, set `FREE_TIER_CONFIG.enabled = true`.
4. Commit + push (GitHub Pages auto-redeploys).
Then test: signed-out → "sign in for 5 free talks"; generate 5 → 6th shows the upsell modal.

Please read `FREE_TIER_DEPLOY.md`, `worker.js`, and the `FREE TIER` sections of `index.html`
first to get oriented, then walk me through deploying — one step at a time, checking each works
before moving on. Use Opus 4.8.

## Repo
GitHub: https://github.com/tangjennii-wq/chalk-talk (branch `main`).
If this Mac is behind, run `git pull` first.
