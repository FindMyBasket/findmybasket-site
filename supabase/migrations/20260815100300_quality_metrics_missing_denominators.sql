-- APPLIED to production 2026-08-15 via MCP apply_migration; committed as the record.
--
-- Three metrics shipped as bare counts. "15,593" answers nothing without "of what", and a
-- panel card showing a bare number is the defect this table was reshaped to prevent.

ALTER TABLE public.metrics_quality_weekly
  ADD COLUMN IF NOT EXISTS stale_in_stock_den          integer,
  ADD COLUMN IF NOT EXISTS cross_product_candidate_den integer;

COMMENT ON COLUMN public.metrics_quality_weekly.stale_in_stock_den IS
  'In-stock rows at active, enabled retailers -- the population stale_in_stock_rows is '
  'counted out of. Added 15 Aug 2026: the metric shipped as a bare count, and "15,593" '
  'answers nothing without "of what".';

COMMENT ON COLUMN public.metrics_quality_weekly.cross_product_candidate_den IS
  'Root in-stock products with a usable name and price -- the candidate population both '
  'cross_product_price_outliers and cross_product_identical_pairs are drawn from. Those '
  'two are PAIR counts over this product count, which is why they are stored separately '
  'and never summed.';

-- fmb_quality_snapshot_write() was then patched to populate both.
--
-- METHOD, AND IT SHOULD BE THE DEFAULT FOR ANY LIVE FUNCTION CHANGE: the definition was
-- fetched with pg_get_functiondef, patched in place, and re-applied. IT WAS NEVER RETYPED,
-- so it cannot drift in transcription. Same property as the products_active capture
-- (20260813200000), which asserted a byte-identical pg_get_viewdef for the same reason:
-- an identical rendering is PROOF of fidelity rather than a promise of it.
