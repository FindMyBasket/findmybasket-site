-- Phase 1 (final) bath_body backfill: 11 clearly-miscategorised body products.
-- APPLIED to production 2026-07-01 (with a fmb_bathbody_phase1_snapshot_20260701
-- snapshot for rollback). Verified: bath_body +11, makeup -9, hair -2.
-- Committed here as the idempotent record.
--
-- These are body lotions/creams/butters + one hand cream sitting in the wrong
-- top_category (Sachajuan lotions in hair; Clarins/NYX/Versace/innisfree in
-- makeup). They get a REAL bath_body subcategory so they are filterable:
--   10 body lotions/creams/butters -> bath_body/body/Body Moisturiser
--    1 hand cream (innisfree)       -> bath_body/hand/Hand Care
--
-- Safety:
--   * snapshot table captures current values first (reversible);
--   * every UPDATE guarded by top_category in ('makeup','hair') so a row that has
--     since changed category is skipped, not clobbered;
--   * ids are explicit (no name predicate) — exactly the 11 named rows.
-- Idempotent: re-running is a no-op (rows are no longer makeup/hair after apply).

begin;

create table if not exists fmb_bathbody_phase1_snapshot_20260701 as
select id, top_category, subcategory, product_type, tags, now() as snapshot_at
from products
where id in (17512,17513,20481,20482,20483,20487,22837,24766,24772,70928,114816);

-- body lotions/creams/butters (10) -> bath_body/body/Body Moisturiser
update products set
  top_category='bath_body', subcategory='body', product_type='Body Moisturiser', tags=array['bath_body','body']
where top_category in ('makeup','hair')
  and id = any(array[17512,17513,20481,20482,20483,20487,22837,24766,24772,70928]::int[]);

-- hand cream (1) -> bath_body/hand/Hand Care
update products set
  top_category='bath_body', subcategory='hand', product_type='Hand Care', tags=array['bath_body','hand']
where top_category in ('makeup','hair')
  and id = 114816;

commit;

-- Rollback (if needed, after apply): restore every row from the snapshot.
-- begin;
-- update products p set
--   top_category = s.top_category, subcategory = s.subcategory,
--   product_type = s.product_type, tags = s.tags
-- from fmb_bathbody_phase1_snapshot_20260701 s where p.id = s.id;
-- commit;
