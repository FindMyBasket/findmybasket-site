-- metrics_quality_weekly, reshaped — and given MEANINGS for the first time.
--
-- WHY THIS EXISTS. The table was created on 28 July with eight metric columns. SEVEN OF
-- THEM WERE NAMES WITH NO DEFINITION ANYWHERE: no SQL, no view, no script, no workflow.
-- Only comparison_depth_pct had an agreed query, and only its NUMERATOR — the column is a
-- percentage and the denominator existed solely as prose in the table comment.
--
-- The definitions were supposed to come from Step 7 of the dashboard brief, which is
-- REPORT ONLY and never ran. Step 8 (the puller) and Step 9 (the panel) both depend on it.
-- THE SCHEMA LANDED AND THE MEANINGS DID NOT, and the table has held zero rows since
-- 5 August. Work-list item 110.
--
-- ── WHAT CHANGED, AND WHY ──────────────────────────────────────────────────────
--
-- DROPPED bad_price_count. It had no definition at all; the only recorded property was
-- "reads 0". The brief argued to keep it as a regression detector — "a metric that is zero
-- today and non-zero later". But A ZERO FROM AN UNDEFINED QUERY CANNOT GO NON-ZERO. It is
-- a blank tile, not an alarm.
--
-- DROPPED null_ean_product_pct, unmatched_row_rate, placeholder_ean_count. Three of the
-- eight were views of one thing — barcode PRESENCE — while barcode COLLISION, which blocks
-- tier 1 on thousands of products every night, had no column at all.
--
--   THE SET ANSWERED "IS THE DATA CLEAN?". EVERY FAILURE THIS FORTNIGHT WAS RELATIONAL:
--   is this row on the right product, and is this price comparable to the ones beside it.
--   There was not one relational column in the eight.
--
-- ADDED six, each replacing a figure that had been re-derived by hand because there was
-- nowhere to put it: ambiguous_ean_groups, sole_supplier_share_pct, no_in_stock_offer_count,
-- stale_in_stock_rows, pack_mismatch_suspects, cross_product_price_outliers.
--
-- ── EVERY RATIO STORES ITS OWN DENOMINATOR ─────────────────────────────────────
--
-- A percentage without its denominator is the defect this fortnight kept producing. The
-- sole-supplier figure was derived twice and abandoned once because no definition
-- reproduced it. Storing num/den means a future reader can check the ratio rather than
-- trust it, and can tell a moved denominator from a moved numerator.
--
-- ── THE THRESHOLD IS STORED IN THE ROW ─────────────────────────────────────────
--
-- suspect_price_threshold is a COLUMN, not a constant in the writer. Two metrics with the
-- same name and different predicates is exactly what this fortnight kept finding. If the
-- threshold ever changes, the series says so instead of silently becoming a different
-- measurement.
--
-- ── LIVE VERSUS BARE: FOLLOWED FROM dq_snapshot, NOT COPIED ────────────────────
--
-- dq_snapshot is the only executable data-quality SQL in the repo and its split is
-- deliberate: headline comparison/savings metrics read retailer_prices_live, per-retailer
-- diagnostics read the bare table. The rule, and the reason:
--
--   A DEPARTED RETAILER'S ROWS MUST SHOW IN COVERAGE AND FRESHNESS, AND MUST NEVER SHOW
--   IN COMPARISON DEPTH.
--
-- Seeing an inactive retailer in an identifier-coverage or staleness diagnostic is correct
-- — that is the point of a diagnostic. Letting it count toward comparison depth overstated
-- that metric by 35.7% in July. So metrics 1-6 and 8-9 read retailer_prices_live;
-- stale_in_stock_rows reads the bare table by design.

ALTER TABLE public.metrics_quality_weekly
  DROP COLUMN IF EXISTS bad_price_count,
  DROP COLUMN IF EXISTS null_ean_product_pct,
  DROP COLUMN IF EXISTS unmatched_row_rate,
  DROP COLUMN IF EXISTS placeholder_ean_count;

ALTER TABLE public.metrics_quality_weekly
  ADD COLUMN IF NOT EXISTS comparison_depth_num          integer,
  ADD COLUMN IF NOT EXISTS comparison_depth_den          integer,
  ADD COLUMN IF NOT EXISTS suspect_price_den             integer,
  ADD COLUMN IF NOT EXISTS suspect_price_threshold       numeric,
  ADD COLUMN IF NOT EXISTS ean_coverage_num              integer,
  ADD COLUMN IF NOT EXISTS ean_coverage_den              integer,
  ADD COLUMN IF NOT EXISTS ambiguous_ean_groups          integer,
  ADD COLUMN IF NOT EXISTS ambiguous_ean_den             integer,
  ADD COLUMN IF NOT EXISTS sole_supplier_share_pct       numeric,
  ADD COLUMN IF NOT EXISTS sole_supplier_num             integer,
  ADD COLUMN IF NOT EXISTS sole_supplier_den             integer,
  ADD COLUMN IF NOT EXISTS no_in_stock_offer_count       integer,
  ADD COLUMN IF NOT EXISTS no_in_stock_offer_den         integer,
  ADD COLUMN IF NOT EXISTS stale_in_stock_rows           integer,
  ADD COLUMN IF NOT EXISTS pack_mismatch_suspects        integer,
  ADD COLUMN IF NOT EXISTS pack_mismatch_testable        integer,
  ADD COLUMN IF NOT EXISTS pack_mismatch_den             integer,
  ADD COLUMN IF NOT EXISTS cross_product_price_outliers  integer,
  ADD COLUMN IF NOT EXISTS cross_product_identical_pairs integer;

COMMENT ON TABLE public.metrics_quality_weekly IS
$c$Weekly data-quality rollup. Nine metrics, each with its denominator stored beside it.

WRITTEN BY public.fmb_quality_snapshot_write(). Do not populate by hand: the definitions
live in that function and nowhere else, so there is exactly one place a meaning can change.

LIVE VS BARE. Metrics 1-6 and 8-9 read retailer_prices_live (active retailers only).
stale_in_stock_rows reads the bare retailer_prices deliberately: a departed retailer's rows
must show in a freshness diagnostic and must never show in comparison depth. Split
inherited from dq_snapshot, whose reasoning is followed rather than whose SQL is copied.

THE THRESHOLD IS A COLUMN. suspect_price_threshold is stored per row, so changing it
records a new definition instead of silently continuing an old series.$c$;

COMMENT ON COLUMN public.metrics_quality_weekly.suspect_price_threshold IS
  'Fraction of the product peer median below which a live in-stock row is flagged. Set to '
  '0.50 on 14 Aug 2026, derived from three real defects rather than chosen for roundness: '
  'at 0.35 the rule catches one of the three, at 0.50 it catches two. This is a REVIEW '
  'QUEUE a human works, not an alert stream, so manageable volume is not the constraint. '
  'Work-list item 110.';

COMMENT ON COLUMN public.metrics_quality_weekly.cross_product_price_outliers IS
  'Pairs of root in-stock products, same brand, names differing by exactly one NUMERIC or '
  'PACK token, where the cheaper best price is under 50% of the dearer. Exists because a '
  'within-product comparator (suspect_price_count) cannot see a between-product defect at '
  'any threshold. Restricted to numeric/pack tokens because item 102 measured one-token '
  'name differences as dominated by shade names: 902 pairs unrestricted, 319 restricted, '
  'and the founding case survives the restriction.';

COMMENT ON COLUMN public.metrics_quality_weekly.pack_mismatch_suspects IS
  'Live in-stock rows whose URL states a SMALLER pack than the product name AND which are '
  'the cheapest row on that product. pack_mismatch_testable records how many rows state a '
  'count on BOTH sides -- about 2.5% -- so an empty result reads as "nothing found in the '
  'tested slice", never as "nothing wrong". Work-list items 98, 99, 108.';
