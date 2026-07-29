-- metrics_ga4_weekly: add outbound_clicks_other, the fourth by-network column.
--
-- WHY. `AffiliateNetwork` in lib/analytics.ts:37 has FIVE values:
--   awin | rakuten | amazon | ebay | other
-- and it is the value sent as the `affiliate_network` event parameter on every
-- retailer_click (lib/analytics.ts:141), which is the custom dimension the Step 4
-- puller reads. The table as built in 20260728180000_dashboard_schema.sql carries
-- THREE by-network columns, so ebay and other clicks had nowhere to land and the
-- parts could never sum to total outbound clicks.
--
-- This is a different defect from the one the table comment already described.
-- That one is a boundary: before the custom dimensions were registered, GA4
-- cannot break the total down at all, so the by-network columns are NULL for
-- those weeks and correctly do not sum. This one would have persisted AFTER the
-- boundary, for every week, permanently.
--
-- Not hypothetical. The server-side outbound_clicks table carried 6 rows with
-- source='ebay_search' when this was written (eBay is a cross-check destination
-- in RoutineBuilder, and lib/analytics.ts:59 sends EBAY_RETAILER_ID = -1 rather
-- than omitting the parameter, precisely so those clicks stay countable).
--
-- WHY A COLUMN RATHER THAN A COMMENT. A column comment explaining that the parts
-- do not sum is a permanent explanation burden: every future reader has to be
-- told, and the first one who is not files a bug. With four columns the invariant
-- is checkable instead of narrated. The table is empty today, so this is trivial
-- now and awkward once there is history to backfill.
--
-- Do NOT "simplify" this later by folding ebay into amazon or dropping the
-- column because it reads low. It is the residual that makes the sum provable;
-- a residual that is usually near zero is doing its job, not failing to.
--
-- VERIFIED BEFORE RUNNING: metrics_ga4_weekly held 0 rows, so no backfill
-- question arises and every existing week is unaffected. Additive and nullable,
-- so nothing that reads the table today can break.

ALTER TABLE public.metrics_ga4_weekly
  ADD COLUMN IF NOT EXISTS outbound_clicks_other integer;

COMMENT ON COLUMN public.metrics_ga4_weekly.outbound_clicks_other IS
  'Outbound retailer_click count for the ebay and other values of AffiliateNetwork (lib/analytics.ts:37), which have no column of their own. Exists so the four by-network columns sum EXACTLY to total outbound clicks for every week from the by-network start date onward. NULL = not measured (weeks before customEvent:affiliate_network was collecting), 0 = measured as none. A gap in the sum AFTER that date is a defect, not the boundary showing through.';

COMMENT ON TABLE public.metrics_ga4_weekly IS
  'Weekly GA4 rollup. NULL = not measured, 0 = measured as none. week_start is the ISO week start (Monday), matching date_trunc(''week'', ...) on the server-side tables; it is derived by bucketing the GA4 `date` dimension in code, NOT from GA4''s `week` dimension, which starts on SUNDAY. The FOUR by-network columns (awin, rakuten, amazon, other) cover all five AffiliateNetwork values and must sum exactly to total outbound clicks from the by-network start date onward; before that date they are NULL, so they will not sum, and that is the registration boundary rather than a fault. Outbound clicks come from retailer_click ONLY; affiliate_clickout fires on the same user action and must never be added. Every figure here is a CONSENTING-visitor figure: gtag.js does not load until cookie consent, so this table structurally undercounts the server-side outbound_clicks table, which writes regardless.';

-- --- Verification (convention 4: assert, do not assume) --------------------
-- ADD COLUMN does not touch relacl, but the failure mode being defended against
-- is a statement that succeeds and does nothing, so read the catalogue back
-- rather than trusting the ALTER. Asserts the column landed with the right type
-- and nullability, that all four by-network columns are present, and that the
-- table's privileges are STILL closed: Step 3 secured these eleven tables and a
-- later migration must not quietly re-open one.
DO $$
DECLARE
  col_type text;
  col_null text;
  n_network_cols int;
  acl text;
BEGIN
  SELECT data_type, is_nullable INTO col_type, col_null
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'metrics_ga4_weekly'
    AND column_name = 'outbound_clicks_other';

  IF col_type IS NULL THEN
    RAISE EXCEPTION 'outbound_clicks_other was not created';
  END IF;
  IF col_type <> 'integer' THEN
    RAISE EXCEPTION 'outbound_clicks_other is %, expected integer', col_type;
  END IF;
  -- Nullable is load-bearing, not incidental: NOT NULL would force 0 into weeks
  -- that were never measured, and "measurement never taken" cannot be recovered
  -- from "measured as none" once written.
  IF col_null <> 'YES' THEN
    RAISE EXCEPTION 'outbound_clicks_other is NOT NULL; it must be nullable so unmeasured weeks stay distinguishable from zero';
  END IF;

  SELECT count(*) INTO n_network_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'metrics_ga4_weekly'
    AND column_name IN ('outbound_clicks_awin','outbound_clicks_rakuten',
                        'outbound_clicks_amazon','outbound_clicks_other');
  IF n_network_cols <> 4 THEN
    RAISE EXCEPTION 'expected 4 by-network columns, found %', n_network_cols;
  END IF;

  -- Read relacl directly. has_table_privilege rolls PUBLIC up into every role's
  -- answer and reports success on a table that is still open.
  SELECT coalesce(relacl::text, '(default)') INTO acl
  FROM pg_class WHERE oid = 'public.metrics_ga4_weekly'::regclass;

  IF acl ~ '(^|,)=' OR acl ~ 'anon=' OR acl ~ 'authenticated=' THEN
    RAISE EXCEPTION 'metrics_ga4_weekly privileges regressed: %', acl;
  END IF;
  IF acl !~ 'service_role=' THEN
    RAISE EXCEPTION 'metrics_ga4_weekly lost service_role access: %', acl;
  END IF;

  RAISE NOTICE 'OK: outbound_clicks_other integer NULL, 4 by-network columns, relacl %', acl;
END
$$;
