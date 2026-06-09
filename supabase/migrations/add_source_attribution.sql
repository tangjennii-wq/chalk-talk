-- Save-to-my-library attribution columns (Phase 5 — Jenni 2026-06-08)
-- When a user "Save copy" of someone else's public talk, the resulting row carries provenance:
-- source_id (original talk row, nullable so original deletion doesn't cascade-destroy clones)
-- source_curator_user_id (original author's user_id — for future handle resolution)
-- source_curator_name (denormalized display name — survives even if original author deletes profile)

ALTER TABLE talks ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES talks(id) ON DELETE SET NULL;
ALTER TABLE talks ADD COLUMN IF NOT EXISTS source_curator_user_id UUID;
ALTER TABLE talks ADD COLUMN IF NOT EXISTS source_curator_name TEXT;

-- Index for "show me all my copied talks" queries
CREATE INDEX IF NOT EXISTS talks_source_id_idx ON talks(source_id) WHERE source_id IS NOT NULL;

-- Verification:
-- SELECT id, title, source_id, source_curator_name FROM talks WHERE source_id IS NOT NULL;
