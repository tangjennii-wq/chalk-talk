-- Depth variants in a single talk row (Phase 6.5 — Jenni 2026-06-08)
-- Replaces the "two rows per topic" pattern (one for concise, one for detailed) with a single
-- row holding both depths under depth_variants. New saves use this; existing rows stay as-is
-- (their second-depth saves will start consolidating into one row going forward).
--
-- Schema: depth_variants = { "concise": <talk_json>, "detailed": <talk_json> }
-- Only the depth that was actually generated/saved is present until the user generates the other.
--
-- talk_json column is preserved as the "current depth" snapshot for backwards compatibility with
-- existing readers (Worker /share/:token, RAG indexers, etc). New code prefers depth_variants[depth].

-- ONE TRANSACTION (added 2026-07-29). psql autocommits each statement unless told otherwise, and
-- `-v ON_ERROR_STOP=1` stops on error WITHOUT undoing what already committed. Unwrapped, a failure
-- partway through this file leaves the database in the half-migrated state — for a file containing
-- DROP or ALTER, that can mean a dropped object that never got recreated. Verified on a live database:
-- a DROP followed by a failure inside a transaction rolls back and the original object survives; the
-- same DROP unwrapped commits on its own and the object is gone.
begin;

ALTER TABLE talks ADD COLUMN IF NOT EXISTS depth_variants JSONB;

-- Optional: backfill — wrap existing single-talk_json rows into a depth_variants shape using their
-- own `depth` column as the key. Commented out by default so it can be opt-in.
-- UPDATE talks SET depth_variants = jsonb_build_object(COALESCE(depth, 'concise'), talk_json)
--   WHERE depth_variants IS NULL AND talk_json IS NOT NULL;

-- Verification:
-- SELECT id, title, depth,
--        depth_variants ? 'concise' AS has_concise,
--        depth_variants ? 'detailed' AS has_detailed
-- FROM talks WHERE user_id = auth.uid() LIMIT 5;

commit;
