-- Keep AI-generated images on public/featured talks (Jenni 2026-06-08)
-- The original scrub_on_publish() trigger stripped imgB64 from savedVisuals[] for storage reasons.
-- But featured talks WANT to show their visuals — Jenni's AI-generated images are hers to share.
-- This migration replaces the trigger so it only nulls refine_context (privacy: user-uploaded refs
-- may contain copyrighted MKSAP excerpts). Visuals stay intact.

CREATE OR REPLACE FUNCTION scrub_on_publish()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_public = TRUE THEN
    -- Always ensure share_token is set
    IF NEW.share_token IS NULL THEN
      NEW.share_token := gen_random_uuid();
    END IF;
    -- Strip refine_context only — may contain copyrighted source material.
    -- AI-generated images (savedVisuals[].imgB64) are intentionally PRESERVED so
    -- featured/shared talks show their full visual content to viewers. (Jenni 2026-06-08)
    NEW.refine_context := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger itself is unchanged — same name, same event spec, just the body of the function is replaced.
-- (CREATE OR REPLACE FUNCTION above; no need to drop/recreate the trigger.)

-- Backfill: restore imgB64 on previously-published talks?
-- Not possible — the data was already stripped. Users will need to regenerate visuals on those talks.
-- For talks featured AFTER this migration, visuals will be preserved automatically.
