-- Manual drag-to-reorder for library cards (also drives public showcase order).
-- sort_order was added directly to the live DB (~2026-07-03) but never captured as a migration,
-- so a fresh rebuild from migrations was missing it — the frontend selects/updates sort_order on
-- talks and the showcase query would otherwise fail with "column does not exist". (Reproducibility fix.)
-- ONE TRANSACTION (added 2026-07-29). psql autocommits each statement unless told otherwise, and
-- `-v ON_ERROR_STOP=1` stops on error WITHOUT undoing what already committed. Unwrapped, a failure
-- partway through this file leaves the database in the half-migrated state — for a file containing
-- DROP or ALTER, that can mean a dropped object that never got recreated. Verified on a live database:
-- a DROP followed by a failure inside a transaction rolls back and the original object survives; the
-- same DROP unwrapped commits on its own and the object is gone.
begin;

ALTER TABLE talks ADD COLUMN IF NOT EXISTS sort_order double precision;

commit;
