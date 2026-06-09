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
