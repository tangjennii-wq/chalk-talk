-- Sharing feature — scrub trigger 2026-06-04
--
-- Purpose: when a talk's `is_public` flips to true, automatically:
--   1. Strip refine_context (may contain user-uploaded MKSAP/copyrighted excerpts)
--   2. Strip base64 image data from savedVisuals (storage bloat — keep metadata only)
--   3. Ensure share_token is set
--
-- Public talks remain readable via the existing RLS policy `public_talks_readable`
-- (see migration_v1.sql line 127) — anonymous + authenticated users can SELECT where is_public = true.
--
-- Run via: Supabase dashboard → SQL Editor → paste + execute. Safe to re-run (idempotent).

-- ── Scrub function ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION scrub_on_publish()
RETURNS TRIGGER AS $$
DECLARE
  visuals jsonb;
  cleaned jsonb;
  v jsonb;
BEGIN
  -- Only act when publishing (transitioning to public, or already public on update)
  IF NEW.is_public = TRUE THEN
    -- Always ensure share_token is set (column default usually populates, but defensive)
    IF NEW.share_token IS NULL THEN
      NEW.share_token := gen_random_uuid();
    END IF;

    -- 1. Strip refine_context — may contain copyrighted source material
    NEW.refine_context := NULL;

    -- 2. Strip base64 imgB64 from each saved visual; keep metadata (label, mode, savedAt)
    --    so the talk can render thumbnails or "🖼 N images" badges, but no inline payload.
    IF NEW.talk_json IS NOT NULL AND NEW.talk_json ? 'savedVisuals' THEN
      visuals := NEW.talk_json -> 'savedVisuals';
      IF jsonb_typeof(visuals) = 'array' THEN
        cleaned := '[]'::jsonb;
        FOR v IN SELECT * FROM jsonb_array_elements(visuals) LOOP
          cleaned := cleaned || jsonb_build_array(v - 'imgB64');
        END LOOP;
        NEW.talk_json := jsonb_set(NEW.talk_json, '{savedVisuals}', cleaned);
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Drop + re-create trigger so it's idempotent ─────────────────────────────
DROP TRIGGER IF EXISTS trg_scrub_on_publish ON talks;
CREATE TRIGGER trg_scrub_on_publish
BEFORE INSERT OR UPDATE OF is_public ON talks
FOR EACH ROW
EXECUTE FUNCTION scrub_on_publish();

-- ── Verification queries ────────────────────────────────────────────────────
-- After running, check trigger is attached:
--   SELECT trigger_name FROM information_schema.triggers WHERE event_object_table='talks';
-- And confirm a test publish scrubs as expected:
--   UPDATE talks SET is_public=true WHERE id='<some-test-id>';
--   SELECT id, is_public, share_token, refine_context, talk_json->'savedVisuals' FROM talks WHERE id='<some-test-id>';
