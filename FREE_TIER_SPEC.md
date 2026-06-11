# Free Tier Spec — Chalk Talk

**Author:** Jenni Tang, MD (spec drafted with Claude — 2026-06-10)
**Status:** Spec only. Build deferred to a dedicated session.
**Estimated build time:** 3–4 hours focused (Worker + DB + frontend).
**Estimated monthly cost ceiling:** $400 soft cap (configurable).

---

## 1. Goals

Let new users try Chalk Talk end-to-end **without configuring an API key**, so distribution friction drops to zero. Jenni covers the cost up to a configurable monthly cap. After 5 generations, users either bring their own key or stop. BYOK users are unaffected.

### Non-goals
- Unlimited free tier — not subsidizing prolonged usage.
- Free tier for anonymous (not-signed-in) users — every free request must be tied to a Supabase identity to enforce quotas.
- Sophisticated payment / metered billing — this is a "try for free, then BYOK" model, not a SaaS subscription.
- Real-time accurate spend tracking — we estimate cost from Anthropic's `usage` field, not Anthropic's billing API.

---

## 2. User personas + flows

### A. New user, no key (the primary flow this spec enables)
1. Lands on Chalk Talk, signs in (magic link).
2. Hero shows: *"✨ You have 5 free talks + 5 free images to start. After that, bring your own Anthropic key."*
3. Types topic, clicks Generate. Worker uses Jenni's key, decrements user's counter.
4. After 5 talks, sees: *"You've used your 5 free generations. Add your own Anthropic key (~$5 covers ~30 talks) to keep going."* — modal with a paste-key field.

### B. Existing BYOK user
- Unchanged. Their `Authorization` header is forwarded. No quota touched.

### C. Anonymous user (not signed in)
- Must enter a key OR sign in for the free tier. Same as today minus the free-tier offer.

### D. Power user who exhausts free tier
- Pastes their own key → instantly switches to BYOK path, no quota check.
- Their existing private talks, library, profile — all preserved (unrelated to the API key).

### E. Cap-hit state (system-wide)
- When monthly spend exceeds `MAX_MONTHLY_SPEND_USD`, free tier is auto-disabled until the 1st of next month.
- New free-tier requests get 503: *"Chalk Talk's free tier is paused for the month. Add your own key to continue."*
- BYOK users unaffected.
- Jenni gets an email when cap is hit (and when at 50%, 80%, 100%).

---

## 3. Architecture overview

```
┌──────────────┐          ┌──────────────────────┐          ┌────────────────┐
│   Browser    │          │  Cloudflare Worker   │          │   Anthropic    │
│ (Chalk Talk) │  HTTPS   │  chalk-talk-proxy    │  HTTPS   │  / OpenAI API  │
│              │ ───────► │                      │ ───────► │                │
└──────────────┘          │  - JWT verify        │          └────────────────┘
                          │  - Quota check       │
                          │  - Spend cap check   │
                          │  - Forward + meter   │
                          │                      │
                          └──────────┬───────────┘
                                     │
                                     ▼
                          ┌────────────────────┐
                          │     Supabase       │
                          │  - free_tier_usage │
                          │  - spend_ledger    │
                          └────────────────────┘
```

**Key idea:** the Worker stops being a dumb passthrough. For free-tier requests, it now (a) verifies the user, (b) checks/enforces quota, (c) checks the system-wide spend cap, (d) forwards to Anthropic/OpenAI using Jenni's key, (e) computes estimated cost from the response, and (f) atomically updates the user's counter + the spend ledger.

---

## 4. Database schema

Two new Supabase tables.

### `free_tier_usage`
Per-user counter. One row per user, created lazily on first free-tier request.

```sql
CREATE TABLE free_tier_usage (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  talks_used INT NOT NULL DEFAULT 0,
  images_used INT NOT NULL DEFAULT 0,
  bonus_talks INT NOT NULL DEFAULT 0,    -- for gifting extra quota to specific users
  bonus_images INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE free_tier_usage ENABLE ROW LEVEL SECURITY;

-- Users can read their own row (so the badge can show remaining)
CREATE POLICY "own_usage_read" ON free_tier_usage
  FOR SELECT USING (auth.uid() = user_id);

-- Writes happen via the Worker using the service role key.
-- No INSERT/UPDATE policy for users → they can't tamper.
```

### `spend_ledger`
Per-month system-wide spend tally. Single row per `month_key` like `'2026-06'`.

```sql
CREATE TABLE spend_ledger (
  month_key TEXT PRIMARY KEY,
  total_cents INT NOT NULL DEFAULT 0,
  talk_count INT NOT NULL DEFAULT 0,
  image_count INT NOT NULL DEFAULT 0,
  last_alert_threshold INT NOT NULL DEFAULT 0,   -- 0, 50, 80, 100 — tracks which email was last sent
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE spend_ledger ENABLE ROW LEVEL SECURITY;

-- Read by authenticated users (so frontend can show "free tier paused" banner if needed)
CREATE POLICY "spend_ledger_read" ON spend_ledger FOR SELECT TO authenticated USING (true);
-- Writes via service role only.
```

### Effective quota helpers (DB functions)
Optional but clean — compute available quota in one round trip:

```sql
CREATE OR REPLACE FUNCTION free_tier_remaining(p_user_id UUID)
RETURNS TABLE(talks_remaining INT, images_remaining INT) AS $$
DECLARE
  base_talks INT := 5;
  base_images INT := 5;
  row free_tier_usage;
BEGIN
  SELECT * INTO row FROM free_tier_usage WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT base_talks, base_images;
  ELSE
    RETURN QUERY SELECT
      GREATEST(0, base_talks + row.bonus_talks - row.talks_used),
      GREATEST(0, base_images + row.bonus_images - row.images_used);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Atomic increment (race-safe)
```sql
CREATE OR REPLACE FUNCTION free_tier_consume(
  p_user_id UUID,
  p_kind TEXT,           -- 'talk' or 'image'
  p_amount INT DEFAULT 1
)
RETURNS BOOLEAN AS $$
DECLARE
  remaining INT;
BEGIN
  -- Lock the row (or insert default)
  INSERT INTO free_tier_usage (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

  -- Atomic check + decrement
  IF p_kind = 'talk' THEN
    UPDATE free_tier_usage
      SET talks_used = talks_used + p_amount, updated_at = NOW()
      WHERE user_id = p_user_id
        AND (5 + bonus_talks - talks_used) >= p_amount;
  ELSIF p_kind = 'image' THEN
    UPDATE free_tier_usage
      SET images_used = images_used + p_amount, updated_at = NOW()
      WHERE user_id = p_user_id
        AND (5 + bonus_images - images_used) >= p_amount;
  END IF;

  RETURN FOUND;   -- TRUE = consumed successfully, FALSE = quota exceeded
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

This solves the race condition: if two concurrent requests both see `talks_used=4`, only one succeeds the `UPDATE` (the other's `WHERE` clause fails the quota check after the first commits).

---

## 5. Worker endpoints

### `POST /v1/messages` (extended)
Already proxies to `api.anthropic.com/v1/messages`. New behavior:

```js
async function handleMessages(request, env) {
  const auth = request.headers.get("Authorization");
  const supabaseJWT = request.headers.get("X-Supabase-Auth");

  // BYOK path — pass through unchanged
  if (auth && auth.startsWith("Bearer sk-ant-")) {
    return forwardToAnthropic(request, auth);
  }

  // Free tier path
  if (!supabaseJWT) {
    return new Response(JSON.stringify({error:"auth required"}), {status: 401});
  }
  const user = await verifySupabaseJWT(supabaseJWT, env.SUPABASE_JWT_SECRET);
  if (!user) return new Response(JSON.stringify({error:"invalid jwt"}), {status: 401});

  // System-wide spend cap check
  const monthKey = new Date().toISOString().slice(0, 7);   // "2026-06"
  const spend = await getMonthlySpend(env, monthKey);
  const capCents = parseInt(env.MAX_MONTHLY_SPEND_USD || "400") * 100;
  if (spend.total_cents >= capCents) {
    return new Response(JSON.stringify({
      error: "free_tier_paused",
      message: "Chalk Talk's free tier is paused for the month. Add your own key to continue.",
      resumes_on: nextMonthFirstDay()
    }), {status: 503});
  }

  // Per-user quota check + atomic consume
  const consumed = await consumeQuota(env, user.id, "talk");
  if (!consumed) {
    return new Response(JSON.stringify({
      error: "quota_exceeded",
      message: "You've used your 5 free talks. Add your own Anthropic key to continue."
    }), {status: 429});
  }

  // Forward to Anthropic using Jenni's key
  const upstream = await forwardToAnthropic(request, env.ANTHROPIC_API_KEY);

  // Meter cost from response usage field
  ctx.waitUntil(meterCost(env, upstream.clone(), "talk", monthKey, user.id));

  return upstream;
}
```

### `POST /v1/images/generations` (new)
Same pattern as `/v1/messages` but for OpenAI image gen. Quota key = `'image'`.

### `GET /v1/free-tier/status`
Returns the user's remaining quota and the system-wide cap status. Frontend calls this on app load to show the badge:

```json
{
  "signed_in": true,
  "talks_remaining": 3,
  "images_remaining": 5,
  "talks_total": 5,
  "images_total": 5,
  "cap_hit": false,
  "cap_pct_used": 32
}
```

### `POST /v1/free-tier/admin/bonus` (admin only)
Lets Jenni gift extra quota to specific users:

```json
{ "user_email": "coworker@nyu.edu", "bonus_talks": 10, "bonus_images": 10 }
```

Protected by `X-Admin-Token` env var (rotate as needed).

---

## 6. Cost metering

After Anthropic responds, the Worker reads the `usage` field and computes estimated cost. Update `spend_ledger` atomically.

### Claude pricing (as of 2026-05)
| Model | Input / 1M tok | Output / 1M tok |
|---|---|---|
| Opus 4.6 | $15.00 | $75.00 |
| Sonnet 4.6 | $3.00 | $15.00 |
| Haiku 4.5 | $0.80 | $4.00 |
| **Cache read** | $0.30 | — |

### Image pricing
- gpt-image-1.5, 1536×1024 high quality: **~$0.08 per image**
- Gemini Nano Banana Pro: **~$0.04 per image**

### Estimator pseudo-code
```js
function estimateCostCents(model, usage) {
  const rates = {
    "claude-opus-4-6":    { in: 1500, out: 7500, cache: 30 },
    "claude-sonnet-4-6":  { in: 300,  out: 1500, cache: 30 },
    "claude-haiku-4-5":   { in: 80,   out: 400,  cache: 30 },
  }[model] || { in: 300, out: 1500, cache: 30 };

  const inputCents     = (usage.input_tokens / 1_000_000) * rates.in;
  const cacheReadCents = (usage.cache_read_input_tokens / 1_000_000) * rates.cache;
  const outputCents    = (usage.output_tokens / 1_000_000) * rates.out;

  return Math.ceil((inputCents + cacheReadCents + outputCents) * 100);
}
```

Image gen: flat `8` (for gpt-image-1.5) or `4` (for Gemini), since usage isn't returned by either API.

### Atomic ledger update
```sql
CREATE OR REPLACE FUNCTION ledger_add(p_month TEXT, p_kind TEXT, p_cost_cents INT)
RETURNS TABLE(new_total_cents INT, threshold_crossed INT) AS $$
DECLARE
  old_total INT;
  new_total INT;
  old_threshold INT;
  new_threshold INT;
  cap_cents INT := 40000;  -- $400 default; Worker can override per env
BEGIN
  INSERT INTO spend_ledger (month_key) VALUES (p_month)
    ON CONFLICT (month_key) DO NOTHING;

  SELECT total_cents, last_alert_threshold INTO old_total, old_threshold
    FROM spend_ledger WHERE month_key = p_month FOR UPDATE;

  new_total := old_total + p_cost_cents;
  new_threshold := old_threshold;

  IF new_total >= cap_cents AND old_threshold < 100 THEN
    new_threshold := 100;
  ELSIF new_total >= cap_cents * 0.8 AND old_threshold < 80 THEN
    new_threshold := 80;
  ELSIF new_total >= cap_cents * 0.5 AND old_threshold < 50 THEN
    new_threshold := 50;
  END IF;

  UPDATE spend_ledger
    SET total_cents = new_total,
        talk_count = talk_count + CASE WHEN p_kind='talk' THEN 1 ELSE 0 END,
        image_count = image_count + CASE WHEN p_kind='image' THEN 1 ELSE 0 END,
        last_alert_threshold = new_threshold,
        updated_at = NOW()
    WHERE month_key = p_month;

  RETURN QUERY SELECT new_total, CASE WHEN new_threshold > old_threshold THEN new_threshold ELSE 0 END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

When `threshold_crossed > 0`, the Worker enqueues an alert email via Resend / Postmark / SES (whatever's easiest — can punt this to phase 2).

---

## 7. Frontend changes

### Quota badge in header
On app load, if `S.user && !S.userByokKey`, GET `/v1/free-tier/status`. Show in header next to "Sign in":

```
✨ 3 talks · 4 images left
```

When `talks_remaining <= 1`, color = orange. When 0, color = red + "Add your key →".

### Pre-generation check
Before calling `/v1/messages`, if free tier:
- If `talks_remaining === 0` → open the "out of free tier" modal instead of submitting.

### Error handling
- `429 quota_exceeded` → modal with paste-key field + "Get a key at console.anthropic.com (free signup)".
- `503 free_tier_paused` → banner: "Free tier paused this month. Bring your own key to continue."

### `S.useByok` flag
Currently exists. New behavior:
- `true` → send `Authorization: Bearer <user-key>`
- `false` (and user signed in) → send `X-Supabase-Auth: <jwt>`, no Authorization
- `false` (and user not signed in) → require sign-in or BYOK

### "Add your own key" modal (new)
Open after quota exceeded. Inputs:
- Paste field for `sk-ant-...`
- "How to get a key" inline explainer (link to console.anthropic.com, note "the free trial gives $5 of credits = ~10 talks").

---

## 8. Abuse vectors + mitigations

### Multi-account farming
**Risk:** User creates many emails to get 5×N free talks.

**Mitigations:**
- Supabase magic-link requires email verification → can't sign up with fake addresses.
- Add `signups_per_ip_per_day INT` table; if same IP creates >3 accounts/day, soft-block or flag.
- (Phase 2) Add hCaptcha to the sign-up flow.

### Token-bombing
**Risk:** User submits maximally long prompts to burn quota fast.

**Mitigations:**
- Worker enforces `max_tokens <= 8192` on free-tier requests (Anthropic param).
- Worker enforces input prompt length cap (e.g., 50k chars) before forwarding.
- Per-request cost cap: if estimated cost > $1.00, reject before forwarding.

### Distributed attack
**Risk:** Bot army uses the free tier to extract talks.

**Mitigations:**
- Cloudflare rate-limit: max 30 free-tier requests / IP / hour at the edge.
- Spend cap is the ultimate backstop — when hit, free tier disables system-wide.

### JWT replay
**Risk:** Captured JWT used after sign-out.

**Mitigations:**
- Supabase JWTs expire (1h default). Worker rejects expired tokens via `exp` claim.
- Worker MUST verify `iss` claim matches Supabase project URL.

---

## 9. Edge cases

| Scenario | Behavior |
|---|---|
| Concurrent requests at quota boundary | DB-level atomic `consume()` prevents double-spend (only one wins). |
| Anthropic returns 500 after quota consumed | Quota NOT refunded. Reasoning: refunding on transient failures is abusable (force-fail to get free quota back). User can retry, will be told "quota exceeded" if at 0. Document as "your free tier counts attempts, not successes." |
| User signs out mid-generation | Worker doesn't care — JWT was valid at request time. Talk completes normally. |
| User adds their own key mid-session | `S.useByok` flips to true. Future requests are BYOK, no quota touched. |
| Free tier paused → BYOK user generates | Unaffected. Their `Authorization` header bypasses all quota/cap checks. |
| Cap hit but already-in-flight requests | They complete (Worker forwarded before cap was hit). The threshold-crossed alert fires after. |
| User has 1 talk left, asks for a Boards-style talk (Sonnet only, cheap) | Charged 1 talk regardless of which model — keep accounting simple. (Phase 2: differentiate.) |
| Anthropic API key is invalid (Jenni rotated and forgot to update env) | Worker returns 503 to all free-tier requests with `{error:"upstream_auth_failed"}`. BYOK unaffected. |
| Spend ledger missing for current month | DB function `ledger_add` upserts on first write — no manual seeding needed. |
| User reaches quota, then Jenni grants bonus | `bonus_talks` adds to effective limit. User can immediately resume without quota reset. |
| Refine call (`weaveRevision`) | Counts as 1 talk against quota. (Refines are full Claude calls.) Alternative: don't charge for refines. Decide before build. |

---

## 10. Telemetry + monitoring

### Per-request log (CF Workers Logpush or Tail)
```json
{
  "ts": "2026-06-10T22:31:04Z",
  "user_id": "uuid",
  "endpoint": "/v1/messages",
  "model": "claude-sonnet-4-6",
  "input_tokens": 4521,
  "output_tokens": 3201,
  "cost_cents": 7,
  "quota_after": { "talks_remaining": 2 },
  "month_total_cents": 18432,
  "month_cap_pct": 46
}
```

### Dashboard queries
- Current month spend + days remaining: `SELECT * FROM spend_ledger WHERE month_key = to_char(now(), 'YYYY-MM')`
- Top spenders this month: `SELECT user_id, talks_used, images_used FROM free_tier_usage ORDER BY talks_used + images_used DESC LIMIT 20`
- Conversion to BYOK: track in frontend by counting users with `has_own_key=true` vs `talks_used=5`.

### Alerts (Phase 2)
- 50% / 80% / 100% spend thresholds → email to Jenni
- Single-user generates 50+ talks in a day → flag for review

---

## 11. Rollout phases

### Phase 1 — MVP build (3-4 hours)
- DB migrations (free_tier_usage, spend_ledger, helper functions)
- Worker endpoints (`/v1/messages` extended, `/v1/images/generations` added, `/v1/free-tier/status`)
- Frontend: quota badge, pre-generation check, error modals, paste-key modal
- Manual smoke test: sign up, generate 5 talks, get blocked, paste key, resume

### Phase 2 — Hardening (next session)
- IP rate-limit at edge (CF rule)
- Spend alert emails (Resend or Postmark)
- Admin bonus grant UI in the app (not just SQL)
- Refine vs initial-generate quota differentiation (if desired)

### Phase 3 — Polish (later)
- Pretty "out of free tier" upsell modal with credit-cost transparency
- Public usage dashboard ("we've covered N free talks for M residents this month")
- A/B test the free-tier limit (3 vs 5 vs 10) once data exists

---

## 12. Environment variables (CF Worker)

```
ANTHROPIC_API_KEY          # Jenni's Anthropic key (existing)
OPENAI_API_KEY             # Jenni's OpenAI key (NEW — for image gen free tier)
SUPABASE_URL               # https://<project>.supabase.co (existing or NEW)
SUPABASE_SERVICE_ROLE_KEY  # Service role, for DB writes (NEW)
SUPABASE_JWT_SECRET        # For JWT verification (NEW)
MAX_MONTHLY_SPEND_USD      # Default: 400. Override per environment.
ADMIN_TOKEN                # For /admin/bonus endpoint (NEW)
RESEND_API_KEY             # Phase 2 — for alert emails
ALERT_EMAIL_TO             # Phase 2 — where alerts go (e.g., tangjennii@gmail.com)
```

---

## 13. Decisions to lock before build

| Decision | Default | Status |
|---|---|---|
| Free quota per user | 5 talks + 5 images | **LOCKED** |
| Quota period | Lifetime (not monthly) | **LOCKED** |
| Monthly spend cap | $400 | **LOCKED** |
| Refines count against quota? | YES (1 talk per refine) | **LOCKED 2026-06-10** |
| Free tier requires sign-in? | YES (no anonymous free tier) | **LOCKED 2026-06-10** |
| Signup must be frictionless | YES (see §13b) | **LOCKED 2026-06-10** |
| Email alerts at 50/80/100% | YES (phase 2) | — |
| Spend ledger granularity | Per-month | — |
| Image provider default | TBD — Gemini ($0.04) or gpt-image ($0.08) | OPEN |
| Quota badge location | TBD — hero vs header-right vs floating | OPEN |
| Quota-exhausted tone | TBD — friendly handoff (lean YES) | OPEN |

---

## 13b. Signup polish — make it as easy as possible

The free tier is gated by Supabase auth, so signup IS the funnel. Friction here kills adoption. Current state: Google OAuth + email magic link. Decisions to make signup feel effortless:

### Lock-ins
- **Google one-tap** — render the Google sign-in prompt automatically on first visit (not just when user clicks "Sign in"). Single tap → signed in → instantly enters free tier with 5 talks.
- **Inline sign-in at the Generate click** — if user types a topic and hits Generate while logged out, show the sign-in modal INLINE with a contextual message: *"Sign in to use your 5 free talks — takes 5 seconds with Google."* Pre-fills the topic so they don't lose state.
- **Persistent sessions** — Supabase JWT auto-refresh is already on. No re-auth nagging.
- **Friendly CTA copy** — "Sign in" → **"Get started free"** in the hero (psychologically the offer not the gate).

### Worth considering
- **Apple Sign In** — meaningful share of iOS users. Supabase supports it natively, ~30 min to wire up.
- **Magic link "click button to send" with no email field if browser autofills** — let `<input type="email">` autocomplete from Apple Keychain / Chrome.
- **Welcome state** — after first sign-in, hero changes to *"Welcome ✨ You have 5 free talks. Try generating one now."*

### Skip for v1 (revisit if needed)
- Twitter / GitHub / Microsoft OAuth — too niche for medical residents
- Phone OTP — Supabase supports but Twilio cost adds up
- Social proof / "join 500 residents using Chalk Talk" — premature

### Magic link UX gotchas
- Make sure the magic link email has clear Chalk Talk branding (currently default Supabase template — bland and looks like spam). Custom template in Supabase dashboard → Auth → Email templates.
- Subject line: "Sign in to Chalk Talk" not "Confirm your email for [project name]".
- Body: short, "Click to open Chalk Talk in your browser. This link expires in 1 hour."

### Telemetry to add at signup
Track in a new `signup_funnel` table or just CF Workers Logpush:
- Modal opened (with source: hero CTA vs Generate-click vs share-banner)
- Google clicked vs Email entered
- Successful sign-in
- First-generation-after-signup completed
- Drop-off between each step

Gives Jenni real data on where the funnel leaks.

---

## 14. Open questions for Jenni

(Updated 2026-06-10 — items 1 and 3 locked above.)

1. ~~Refine counting~~ → **LOCKED:** refines count.
2. **Image gen provider.** Default to gpt-image-1.5 ($0.08/image) or Gemini Nano Banana Pro ($0.04)? Gemini halves your cost; gpt-image is sharper. Could also default to Gemini for free tier, gpt-image for BYOK.
3. ~~Anonymous tier~~ → **LOCKED:** sign-in required.
4. **Where does the free-tier badge live?** Hero is crowded. Options: (a) tiny chip next to the account avatar, (b) inline in the "How it works" pill, (c) under the topic input, (d) only show when low (≤2 remaining).
5. **Quota-exhausted tone.** Lean friendly: *"✨ You've used your free trial — bring your own Anthropic key (~$5 covers ~30 talks)"*. Confirm vs the clinical option.
6. **Add Apple Sign In to v1 of signup polish?** ~30 min, meaningful for iOS users. Or punt to phase 2.
7. **Custom Supabase email template tonight, or punt?** The default magic-link email looks generic/spammy. 15 min to fix in dashboard.

---

## 15. Notes / risks

- **Cost estimation isn't exact.** Anthropic's billing may differ slightly from `usage`-based estimates. Build in a 10% safety margin — set `MAX_MONTHLY_SPEND_USD=400` but trigger the 100% alert at $360 actual estimated spend to leave headroom.
- **Supabase JWT verification in CF Workers.** No native lib. Use the `jose` package (works in Workers via `npm install jose`). HS256 verify with `SUPABASE_JWT_SECRET` — ~10 lines.
- **The Worker becomes stateful.** Currently it's a pure proxy. Spend ledger / quota writes add coupling to Supabase. If Supabase is down, free tier is down (BYOK still works).
- **Don't rotate `ANTHROPIC_API_KEY` without warning.** All free-tier requests fail until env updated.
- **Test path for "spend cap reached" must exist.** Otherwise it's untested until production hits it. Suggest: a `SIMULATE_CAP_REACHED=true` env override for staging.

---

*End of spec. Ready to build in a dedicated session — likely paired with the Server-Side Generation Spec since they touch the same Worker.*
