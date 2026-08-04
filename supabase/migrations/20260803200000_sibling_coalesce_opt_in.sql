-- Per-retailer opt-in for the AWIN sibling-column coalesce.
--
-- WHAT THE COALESCE FIXES. import-awin-feed requests fixed column names. AWIN
-- advertisers populate one half of each sibling pair and leave the other blank, and
-- WHICH half differs per feed. Requesting only one half silently discards data that is
-- present in the feed.
--
--   ean                            <-> product_GTIN
--   merchant_product_category_path <-> merchant_category
--   category_name                  <-> product_type
--
-- Measured 3 August 2026 by read-only feed-diag runs:
--   Beauty Flash   ean 0.0%   product_GTIN 96.4%   path 0.0%   merchant_category 100%
--   Stylevana      ean 43.9%  product_GTIN 0.0%    path 0.0%   merchant_category 98.6%
--                  category_name 0.0%              product_type 100%
--
-- Five retailers sat at exactly 0.0% ean while six sat at 98.8-100%, which is a
-- column-name mismatch rather than five advertisers declining to supply barcodes.
--
-- WHY OPT-IN RATHER THAN A FLAG DAY. Enabling this changes what MATCHES on the next
-- import for that retailer. Turning it on everywhere at once would change matching for
-- every AWIN retailer simultaneously, on the import path, with no way to attribute an
-- unexpected result to a feed. Staged smallest-first so anything unexpected is legible:
--
--   1. The Organic Pharmacy      114 rows    barcodes
--   2. Beauty Flash           10,862 rows    BARCODES ONLY (see correction below)
--   3. Stylevana              24,598 rows    BARCODES ONLY, and it has none to gain
--   4. Gorgeous Shop                         barcodes
--   5. Escentual                             barcodes
--   6. Boots                  35,912 rows    barcodes, last
--
-- CORRECTION, 4 August 2026: THE CATEGORY HALF IS PROSPECTIVE ONLY.
-- This file originally described stage 2 as delivering "barcodes + category path" and
-- stage 3 as a clean test of the category half. Both were wrong.
--
-- The importer writes top_category / product_type / subcategory ONLY on createActions.
-- updateActions carries price, url, in_stock, ean, mpn and image_url and nothing else.
-- An import therefore NEVER rewrites the category of a product that already exists, with
-- this flag on or off. Every misassigned product already exists, so enabling the flag
-- reads the recovered category column and discards it.
--
-- The rollout is BARCODE-ONLY at every stage. That is still worth doing: five retailers
-- sat at 0.0% ean. It is simply not the fix for work-list item 18, which needs a
-- catalogue-wide backfill of products and carries item 6's search_vector cost.
--
-- Stylevana's ordering no longer has a rationale: its product_GTIN is 0.0%, so it gains
-- no barcodes either. Reorder or drop it; it was placed third to isolate a half that
-- turns out not to exist.
--
-- ORDERING IS PRIMARY-FIRST, NOT SIBLING-FIRST. The row loop prefers the column read
-- today and falls back only when it is empty, so YesStyle, Debenhams, Perfume Click and
-- Beauty Bay are byte-identical after this change. Re-sourcing barcodes for retailers
-- that already work is change for no gain, and change for no gain on the import path is
-- risk without benefit.
--
-- OFF IS THE OLD CODE PATH, not a variant of the new one. A retailer with this false
-- reads the same columns, runs no validation, and produces the same output as before
-- 3 August 2026. That is what makes a rollback a config change rather than a deploy.

ALTER TABLE public.retailer_import_config
  ADD COLUMN IF NOT EXISTS sibling_coalesce boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.retailer_import_config.sibling_coalesce IS
  'Per-retailer opt-in for AWIN sibling-column coalesce (ean<->product_GTIN, '
  'merchant_product_category_path<->merchant_category, category_name<->product_type). '
  'OFF by default: enabling changes what matches on the next import, so it is staged '
  'smallest-first. A retailer with this false takes byte-identical code paths to before '
  '3 Aug 2026.';

-- --- Verification (convention 4: assert, do not assume) ----------------------
-- The whole safety property of this migration is that it changes NOTHING until a
-- retailer is opted in one at a time. Asserting the default actually landed as false
-- is the only thing standing between that and a silent flag day.
DO $$
DECLARE n_on int; n_total int;
BEGIN
  SELECT count(*) FILTER (WHERE sibling_coalesce), count(*) INTO n_on, n_total
  FROM public.retailer_import_config;

  IF n_on <> 0 THEN
    RAISE EXCEPTION 'sibling_coalesce must default OFF for every retailer, found % enabled', n_on;
  END IF;

  RAISE NOTICE 'OK: sibling_coalesce added, 0 of % retailers enabled', n_total;
END
$$;
