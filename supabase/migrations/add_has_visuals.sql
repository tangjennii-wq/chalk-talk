-- Adds a fast boolean for whether a talk has saved visuals,
-- so the library list query doesn't need to fetch the full talk_json (with base64 images) just to display the 🖼 badge.
--
-- v2 (2026-06-04): wrapped the JSONB checks in COALESCE because three-valued SQL logic
-- can produce NULL when savedVisuals is missing — which violates the NOT NULL constraint.

-- ── Roll back any partial v1 state so this script is idempotent ─────────────
DROP TRIGGER IF EXISTS trg_sync_has_visuals ON talks;
DROP FUNCTION IF EXISTS sync_has_visuals();

-- 1. Column with safe default (idempotent)
ALTER TABLE talks ADD COLUMN IF NOT EXISTS has_visuals BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Backfill existing rows — COALESCE protects against NULL from JSONB ops
UPDATE talks
SET has_visuals = COALESCE(
  (talk_json IS NOT NULL)
  AND (jsonb_typeof(talk_json -> 'savedVisuals') = 'array')
  AND (jsonb_array_length(talk_json -> 'savedVisuals') > 0),
  FALSE
);

-- 3. Trigger function: recompute has_visuals whenever talk_json changes
CREATE OR REPLACE FUNCTION sync_has_visuals()
RETURNS TRIGGER AS $$
BEGIN
  NEW.has_visuals := COALESCE(
    (NEW.talk_json IS NOT NULL)
    AND (jsonb_typeof(NEW.talk_json -> 'savedVisuals') = 'array')
    AND (jsonb_array_length(NEW.talk_json -> 'savedVisuals') > 0),
    FALSE
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Attach trigger to INSERT and UPDATE-of-talk_json
CREATE TRIGGER trg_sync_has_visuals
BEFORE INSERT OR UPDATE OF talk_json ON talks
FOR EACH ROW
EXECUTE FUNCTION sync_has_visuals();

-- Verify (optional): SELECT id, title, has_visuals FROM talks WHERE has_visuals = true;
