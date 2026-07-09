-- Manual drag-to-reorder for library cards (also drives public showcase order).
-- sort_order was added directly to the live DB (~2026-07-03) but never captured as a migration,
-- so a fresh rebuild from migrations was missing it — the frontend selects/updates sort_order on
-- talks and the showcase query would otherwise fail with "column does not exist". (Reproducibility fix.)
ALTER TABLE talks ADD COLUMN IF NOT EXISTS sort_order double precision;
