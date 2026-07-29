-- Save-to-my-library attribution columns (Phase 5 — Jenni 2026-06-08)
-- When a user "Save copy" of someone else's public talk, the resulting row carries provenance:
-- source_id (original talk row, nullable so original deletion doesn't cascade-destroy clones)
-- source_curator_user_id (original author's user_id — for future handle resolution)
-- source_curator_name (denormalized display name — survives even if original author deletes profile)

-- ONE TRANSACTION (added 2026-07-29). psql autocommits each statement unless told otherwise, and
-- `-v ON_ERROR_STOP=1` stops on error WITHOUT undoing what already committed. Unwrapped, a failure
-- partway through this file leaves the database in the half-migrated state — for a file containing
-- DROP or ALTER, that can mean a dropped object that never got recreated. Verified on a live database:
-- a DROP followed by a failure inside a transaction rolls back and the original object survives; the
-- same DROP unwrapped commits on its own and the object is gone.
begin;

ALTER TABLE talks ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES talks(id) ON DELETE SET NULL;
ALTER TABLE talks ADD COLUMN IF NOT EXISTS source_curator_user_id UUID;
ALTER TABLE talks ADD COLUMN IF NOT EXISTS source_curator_name TEXT;

-- Index for "show me all my copied talks" queries
CREATE INDEX IF NOT EXISTS talks_source_id_idx ON talks(source_id) WHERE source_id IS NOT NULL;

-- Verification:
-- SELECT id, title, source_id, source_curator_name FROM talks WHERE source_id IS NOT NULL;

commit;
