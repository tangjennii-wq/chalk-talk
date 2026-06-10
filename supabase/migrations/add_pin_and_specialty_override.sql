-- Pin to top + Specialty override (Jenni 2026-06-09 Pattern A)
-- Two simple knobs that let users curate their library without drag-and-drop.
--
-- specialty_override: when set, the library uses this value instead of the inferred specialty.
--   Lets users move a talk from "Other" → "Cardiovascular" (or fix any mis-categorization).
--
-- is_pinned: a simple boolean. Pinned talks sort to the top of their tab in the library view.
--   Within "Lectures" tab, pinned lectures come first; same for Boards. Pin order itself is
--   by pinned_at DESC (most recently pinned first), so re-pinning bumps something back to top.

ALTER TABLE talks ADD COLUMN IF NOT EXISTS specialty_override TEXT;
ALTER TABLE talks ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE talks ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

-- Index for the "pinned first" sort within a user's library
CREATE INDEX IF NOT EXISTS talks_user_pinned_idx
  ON talks(user_id, is_pinned, pinned_at DESC NULLS LAST, created_at DESC);

-- Trigger: stamp pinned_at when is_pinned flips to true, null it when flipped back
CREATE OR REPLACE FUNCTION stamp_pinned_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_pinned = TRUE AND (OLD IS NULL OR OLD.is_pinned = FALSE) THEN
    NEW.pinned_at := NOW();
  ELSIF NEW.is_pinned = FALSE THEN
    NEW.pinned_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stamp_pinned_at ON talks;
CREATE TRIGGER trg_stamp_pinned_at
BEFORE INSERT OR UPDATE OF is_pinned ON talks
FOR EACH ROW
EXECUTE FUNCTION stamp_pinned_at();

-- Verification:
-- SELECT id, title, specialty_override, is_pinned, pinned_at FROM talks WHERE is_pinned = true;
