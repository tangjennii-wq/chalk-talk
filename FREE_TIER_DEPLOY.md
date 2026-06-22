# Free Tier — Deploy Checklist

Everything is built and committed. This is the ~15-minute deploy. You already have
Cloudflare (the `chalk-talk-proxy` Worker) and Supabase, so this is config + one migration,
not new infrastructure.

What the free tier does: a signed-in user with **no key of their own** gets **5 free talks +
5 free images** on your Anthropic key, routed through the Worker. After that they're prompted
to add their own key (BYOK goes straight to Anthropic, never touches the Worker). A system-wide
**$400/month spend cap** auto-pauses the free tier if it's ever hit.

---

## 1. Apply the database migration

In the Supabase SQL editor (or CLI), run:

```
supabase/migration_v3_free_tier.sql
```

This creates `free_tier_usage` + `spend_ledger` and the helper functions
(`free_tier_remaining`, `free_tier_consume`, `ledger_add`, `free_tier_grant_bonus`).
Safe to re-run (uses `IF NOT EXISTS` / `CREATE OR REPLACE`).

## 2. Add the Worker secret

The Worker needs your Supabase **service role** key to write quota/spend (bypasses RLS).
Get it from Supabase → Project Settings → API → `service_role` secret.

```bash
cd /path/to/chalk-talk
wrangler secret put SUPABASE_SERVICE_ROLE_KEY    # paste the service_role key
```

Already configured (from the existing proxy), confirm they exist with `wrangler secret list`:
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.

Optional secrets/vars (all have sensible defaults):

```bash
wrangler secret put ADMIN_TOKEN            # only if you want the /admin/bonus endpoint
```

Optional `[vars]` in `wrangler.toml` (defaults shown):

```toml
MAX_MONTHLY_SPEND_USD = "400"   # system-wide free-tier cap
FREE_TALKS  = "5"
FREE_IMAGES = "5"
```

## 3. Deploy the Worker

```bash
wrangler deploy
```

Smoke-test the new endpoint (should say signed_in:false without a token):

```bash
curl https://chalk-talk-proxy.chalktalk.workers.dev/v1/free-tier/status \
  -H "Origin: https://tangjennii.github.io"
# → {"signed_in":false}
```

## 4. Flip the frontend switch, then ship

The free-tier frontend ships **dormant** behind an off-switch so the speed update could go out
first. After steps 1–3 are done, open `index.html`, find `FREE_TIER_CONFIG`, and set:

```js
var FREE_TIER_CONFIG = {
  enabled: true        // was false
};
```

Commit + push so GitHub Pages redeploys. (While it's `false`, the app behaves exactly as
before — signed-in users without a key are asked for their own Anthropic key — so it's safe to
have the code committed before you're ready to launch.)

---

## How to verify end-to-end

1. Open the site **signed out**, type a topic, click Generate → you get the **"Sign in to use
   your 5 free talks"** prompt (not a key prompt).
2. Sign in (Google or magic link). A **"✨ 5 free talks left"** chip appears by your avatar.
3. Generate 5 talks → chip counts down, talks build section-by-section (progressive rendering).
4. On the 6th → the **"You've used your free talks"** modal with "Add my Anthropic key".
5. Paste a key → you're now BYOK (direct to Anthropic), chip disappears, unlimited.

## Quota accounting (how it stays correct)

- Quota is consumed **once per generation** via `POST /v1/free-tier/consume`, called by the
  frontend before it starts — *not* per API call. This matters because one talk = a draft call
  + a peer-review call (+ any 529 retries / model fallbacks); charging per call would burn
  multiple talks for one generation.
- Refines (the chat "make it…" edits) also consume 1 talk — per spec (LOCKED).
- **Spend** (real $ cost) is metered on every free-tier call from the Anthropic `usage` field
  (streamed and non-streamed both handled) into `spend_ledger`. Images add a flat ~$0.08.

## Gifting extra quota to someone

If `ADMIN_TOKEN` is set:

```bash
curl -X POST https://chalk-talk-proxy.chalktalk.workers.dev/v1/free-tier/admin/bonus \
  -H "Origin: https://tangjennii.github.io" \
  -H "X-Admin-Token: YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_email":"colleague@hospital.edu","bonus_talks":10,"bonus_images":10}'
```

## Watching cost

- Current month: `SELECT * FROM spend_ledger WHERE month_key = to_char(now(),'YYYY-MM');`
- Top users: `SELECT user_id, talks_used, images_used FROM free_tier_usage ORDER BY talks_used DESC LIMIT 20;`
- Hard kill if needed: lower `MAX_MONTHLY_SPEND_USD` and `wrangler deploy`, or set an
  [Anthropic usage budget alert](https://console.anthropic.com/settings/limits).

## Notes / known limits (from the spec)

- Cost is **estimated** from the `usage` field, not Anthropic's billing API — keep ~10% headroom.
- If Supabase is down, the free tier is down (BYOK still works).
- Free-tier talks use **Opus 4.8** (your choice) — budget ~$0.50–1.00/talk, so $400 covers
  roughly 80–160 free users/month before the cap pauses it. Lower `MAX_MONTHLY_SPEND_USD` if
  you want a tighter ceiling while you watch adoption.
- Per-spec hardening still open for a later pass: IP rate-limit at the edge, 50/80/100% spend
  alert emails, and the Google one-tap signup polish (§13b).
