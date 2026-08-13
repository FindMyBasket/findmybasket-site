-- retailer_import_config.reassignment_detect — per-retailer, default OFF.
--
-- WHAT IT DETECTS. A merchant that reassigns an external_product_id from one product to
-- another silently repoints tier 0. The row keeps its product_id and, through the sticky
-- COALESCE in bulk_update_retailer_prices, its barcode — while url, image_url and
-- description follow the NEW product. Commit a43e2ed is the worked example: Stylevana
-- moved merchant_product_id 112499 from an Isntree sunscreen to a Euthymol toothbrush
-- set, and /product/7547 showed a toothbrush under a sunscreen's name and barcode.
--
-- COUNT, LOG, AND STILL WRITE. The detector does not skip the write. A count-only mode
-- that skipped would already be acting, leaving no untouched period to measure the rate
-- against — so the per-retailer rate it exists to establish would be unobtainable. One
-- bounded cycle of continued corruption, on rows already corrupted, buys a clean baseline.
--
-- STYLEVANA ONLY, AND THE REASON IS THE BOOTS INVERSION rather than caution. Measured on
-- live feeds, 14 August 2026, zero shared name tokens between the feed row and the stored
-- product:
--
--   Stylevana      137 of  8,796   1.56%    137, then 19 / 6 / 13 / 20 — a valley
--   Beauty Flash    13 of  8,115   0.16%    13, then 3 / 8 — a trough
--   Escentual        3 of  6,888   0.04%    3, then 0 / 1 — a trough
--   Boots            1 of 22,540   0.004%   1, then 7 / 46 / 56 — IT RISES
--
-- At Stylevana, Beauty Flash and Escentual the zero bucket is a SEPARABLE POPULATION and
-- the threshold cuts where the data is empty. AT BOOTS THERE IS NO GAP TO CUT AT: the
-- curve rises out of zero, so the zero-token rule has no evidence there and would be
-- measuring noise across 22,540 rows. Item 79's shape on a different rule — fitted to the
-- catalogue, not to the concept.
--
-- THAT WOULD HAVE BEEN INVISIBLE HAD ONLY STYLEVANA BEEN MEASURED, which is the argument
-- for having measured all four before switching any on.
--
-- AND THE SPREAD IS THE DIAGNOSIS. 1.56% against 0.004% is not one defect with varying
-- incidence across the fleet. It is a Stylevana behaviour — a merchant reassigning
-- merchant_product_id — and the detector is aimed accordingly.
--
-- Beauty Flash and Escentual stay OFF until Stylevana's count-only cycle confirms the log
-- is readable and the trip reasons are what we expect. Boots stays off on the evidence.

ALTER TABLE public.retailer_import_config
  ADD COLUMN IF NOT EXISTS reassignment_detect boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.retailer_import_config.reassignment_detect IS
  'Per-retailer opt-in for the tier-0 reassignment detector (work-list item 84). COUNT, LOG '
  'AND STILL WRITE — it never skips a write, so the rate can be measured against an '
  'untouched baseline. Trips when a feed row and its tier-0-matched product share ZERO name '
  'tokens. On 14 Aug 2026 only Stylevana (11) is true: its rate is 1.56% against Boots'' '
  '0.004%, and Boots has no trough at zero so the threshold has no evidence there. Read the '
  'scrape_log details sample_reassignment_suspect rows before switching on another retailer.';

UPDATE public.retailer_import_config SET reassignment_detect = true WHERE retailer_id = 11;

-- --- Verification (convention 4: assert, do not assume) ----------------------
DO $$
DECLARE n_on int; n_total int; sv boolean; boots boolean;
BEGIN
  SELECT count(*) INTO n_total FROM public.retailer_import_config;
  SELECT count(*) INTO n_on    FROM public.retailer_import_config WHERE reassignment_detect;
  SELECT reassignment_detect INTO sv    FROM public.retailer_import_config WHERE retailer_id = 11;
  SELECT reassignment_detect INTO boots FROM public.retailer_import_config WHERE retailer_id = 23;

  IF sv IS NOT TRUE THEN
    RAISE EXCEPTION 'Stylevana (11) should be the one retailer with the detector on';
  END IF;
  IF boots IS NOT FALSE THEN
    RAISE EXCEPTION 'Boots (23) must stay OFF: no trough at zero, 1 row of 22,540';
  END IF;
  IF n_on <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 retailer with the detector on, found %', n_on;
  END IF;

  RAISE NOTICE 'reassignment_detect added to % config rows; ON for Stylevana only', n_total;
END $$;
