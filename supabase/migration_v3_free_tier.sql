-- ─────────────────────────────────────────────────────────────────────────
-- Chalk Talk · Free Tier (migration v3)
-- Author: Jenni Tang, MD — built with Claude, 2026-06-22
-- Implements FREE_TIER_SPEC.md §4: per-user quota + system-wide spend ledger.
--
-- Apply with either:
--   supabase db execute --file supabase/migration_v3_free_tier.sql
-- or paste into the Supabase SQL editor and run.
--
-- All writes happen via the Cloudflare Worker using the SERVICE ROLE key, which
-- bypasses RLS. Users get read-only RLS so the frontend can show "talks left".
-- ─────────────────────────────────────────────────────────────────────────

-- ── Per-user counter ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS free_tier_usage (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  talks_used   INT NOT NULL DEFAULT 0,
  images_used  INT NOT NULL DEFAULT 0,
  bonus_talks  INT NOT NULL DEFAULT 0,   -- gift extra quota to specific users
  bonus_images INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE free_tier_usage ENABLE ROW LEVEL SECURITY;

-- Users can read ONLY their own row (so the badge can show remaining quota).
DROP POLICY IF EXISTS "own_usage_read" ON free_tier_usage;
CREATE POLICY "own_usage_read" ON free_tier_usage
  FOR SELECT USING (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE policy for users → only the service role can write.

-- ── System-wide monthly spend tally ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS spend_ledger (
  month_key            TEXT PRIMARY KEY,          -- e.g. '2026-06'
  total_cents          INT NOT NULL DEFAULT 0,
  talk_count           INT NOT NULL DEFAULT 0,
  image_count          INT NOT NULL DEFAULT 0,
  last_alert_threshold INT NOT NULL DEFAULT 0,    -- 0 / 50 / 80 / 100
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE spend_ledger ENABLE ROW LEVEL SECURITY;

-- Any signed-in user may read the ledger (so the frontend can show a "paused" banner).
DROP POLICY IF EXISTS "spend_ledger_read" ON spend_ledger;
CREATE POLICY "spend_ledger_read" ON spend_ledger FOR SELECT TO authenticated USING (true);
-- Writes via service role only.

-- ── Effective remaining quota (one round trip for the badge) ───────────────
CREATE OR REPLACE FUNCTION free_tier_remaining(
  p_user_id      UUID,
  p_base_talks   INT DEFAULT 5,
  p_base_images  INT DEFAULT 5
)
RETURNS TABLE(talks_remaining INT, images_remaining INT) AS $$
DECLARE
  rec free_tier_usage;
BEGIN
  SELECT * INTO rec FROM free_tier_usage WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT p_base_talks, p_base_images;
  ELSE
    RETURN QUERY SELECT
      GREATEST(0, p_base_talks  + rec.bonus_talks  - rec.talks_used),
      GREATEST(0, p_base_images + rec.bonus_images - rec.images_used);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Atomic, race-safe consume (returns TRUE if quota was available) ────────
CREATE OR REPLACE FUNCTION free_tier_consume(
  p_user_id  UUID,
  p_kind     TEXT,            -- 'talk' or 'image'
  p_amount   INT DEFAULT 1,
  p_base     INT DEFAULT 5
)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO free_tier_usage (user_id) VALUES (p_user_id)
    ON CONFLICT (user_id) DO NOTHING;

  IF p_kind = 'talk' THEN
    UPDATE free_tier_usage
      SET talks_used = talks_used + p_amount, updated_at = NOW()
      WHERE user_id = p_user_id
        AND (p_base + bonus_talks - talks_used) >= p_amount;
  ELSIF p_kind = 'image' THEN
    UPDATE free_tier_usage
      SET images_used = images_used + p_amount, updated_at = NOW()
      WHERE user_id = p_user_id
        AND (p_base + bonus_images - images_used) >= p_amount;
  ELSE
    RETURN FALSE;
  END IF;

  RETURN FOUND;   -- TRUE = consumed; FALSE = quota exceeded (WHERE matched no row)
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Atomic spend add + threshold detection ────────────────────────────────
-- Returns the new running total and which alert threshold (if any) was just
-- crossed (50/80/100), so the Worker can fire an email once per threshold.
CREATE OR REPLACE FUNCTION ledger_add(
  p_month      TEXT,
  p_kind       TEXT,           -- 'talk' or 'image' (for counters)
  p_cost_cents INT,
  p_cap_cents  INT DEFAULT 40000
)
RETURNS TABLE(new_total_cents INT, threshold_crossed INT) AS $$
DECLARE
  old_total     INT;
  v_new_total   INT;
  old_threshold INT;
  new_threshold INT;
BEGIN
  INSERT INTO spend_ledger (month_key) VALUES (p_month)
    ON CONFLICT (month_key) DO NOTHING;

  SELECT total_cents, last_alert_threshold INTO old_total, old_threshold
    FROM spend_ledger WHERE month_key = p_month FOR UPDATE;

  v_new_total   := old_total + GREATEST(0, p_cost_cents);
  new_threshold := old_threshold;

  IF    v_new_total >= p_cap_cents          AND old_threshold < 100 THEN new_threshold := 100;
  ELSIF v_new_total >= (p_cap_cents * 8 / 10) AND old_threshold < 80  THEN new_threshold := 80;
  ELSIF v_new_total >= (p_cap_cents / 2)      AND old_threshold < 50  THEN new_threshold := 50;
  END IF;

  UPDATE spend_ledger
    SET total_cents = v_new_total,
        talk_count  = talk_count  + CASE WHEN p_kind = 'talk'  THEN 1 ELSE 0 END,
        image_count = image_count + CASE WHEN p_kind = 'image' THEN 1 ELSE 0 END,
        last_alert_threshold = new_threshold,
        updated_at = NOW()
    WHERE month_key = p_month;

  RETURN QUERY SELECT v_new_total,
    CASE WHEN new_threshold > old_threshold THEN new_threshold ELSE 0 END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Admin: grant bonus quota by email ─────────────────────────────────────
CREATE OR REPLACE FUNCTION free_tier_grant_bonus(
  p_email        TEXT,
  p_bonus_talks  INT DEFAULT 0,
  p_bonus_images INT DEFAULT 0
)
RETURNS BOOLEAN AS $$
DECLARE
  v_uid UUID;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = lower(p_email) LIMIT 1;
  IF v_uid IS NULL THEN RETURN FALSE; END IF;

  INSERT INTO free_tier_usage (user_id, bonus_talks, bonus_images)
    VALUES (v_uid, p_bonus_talks, p_bonus_images)
  ON CONFLICT (user_id) DO UPDATE
    SET bonus_talks  = free_tier_usage.bonus_talks  + EXCLUDED.bonus_talks,
        bonus_images = free_tier_usage.bonus_images + EXCLUDED.bonus_images,
        updated_at   = NOW();
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
