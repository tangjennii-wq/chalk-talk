-- Featured talks (showcase / portfolio) — Jenni 2026-06-08
-- Adds a curator-style "featured" flag so a user can pick a subset of their public talks
-- to surface as a public portfolio at /#showcase (or eventually /u/<handle>).
--
-- Lifecycle: setting is_featured=true REQUIRES is_public=true (a featured-but-private talk
-- would be invisible to portfolio visitors, which would be confusing). We enforce this in
-- a trigger so the frontend can flip both together with a single update.

-- ONE TRANSACTION (added 2026-07-29). psql autocommits each statement unless told otherwise, and
-- `-v ON_ERROR_STOP=1` stops on error WITHOUT undoing what already committed. Unwrapped, a failure
-- partway through this file leaves the database in the half-migrated state — for a file containing
-- DROP or ALTER, that can mean a dropped object that never got recreated. Verified on a live database:
-- a DROP followed by a failure inside a transaction rolls back and the original object survives; the
-- same DROP unwrapped commits on its own and the object is gone.
begin;

ALTER TABLE talks ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE talks ADD COLUMN IF NOT EXISTS featured_at TIMESTAMPTZ;

-- Index for the portfolio query (anon visitors filtering by is_public + is_featured)
CREATE INDEX IF NOT EXISTS talks_featured_idx
  ON talks(user_id, is_featured, featured_at DESC)
  WHERE is_featured = true AND is_public = true;

-- Trigger: when a talk is featured, auto-publish + stamp featured_at
CREATE OR REPLACE FUNCTION ensure_featured_is_public()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_featured = TRUE THEN
    -- Featured → must also be public, and stamp the moment it was featured
    NEW.is_public := TRUE;
    IF NEW.featured_at IS NULL THEN
      NEW.featured_at := NOW();
    END IF;
    -- Ensure share_token exists (some old rows may not have one yet)
    IF NEW.share_token IS NULL THEN
      NEW.share_token := gen_random_uuid();
    END IF;
  ELSE
    NEW.featured_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_featured_implies_public ON talks;
CREATE TRIGGER trg_featured_implies_public
BEFORE INSERT OR UPDATE OF is_featured ON talks
FOR EACH ROW
EXECUTE FUNCTION ensure_featured_is_public();

-- Verification:
-- SELECT id, title, is_public, is_featured, featured_at FROM talks WHERE is_featured = true;

commit;
