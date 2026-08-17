-- APPLIED to production 2026-08-17 via MCP apply_migration; committed as the record.
-- Work-list items 158, 159.
--
-- Two things that belong together: the column that records WHERE a delivery term came from,
-- and the first value written under it.
--
-- WHY THE COLUMN. A feed-derived term and a term read off the retailer's own checkout have
-- DIFFERENT DECAY RATES. A feed value re-arrives on every import and is wrong only if the
-- advertiser changed it upstream. A checkout observation is a photograph: correct on the day,
-- silently stale afterwards, and nothing re-reads it. delivery_terms_observed_at records WHEN
-- somebody looked and could not record WHAT THEY LOOKED AT, so a reader could not tell whether
-- an old date meant "stale photograph" or "stable feed value".

ALTER TABLE public.retailers
  ADD COLUMN IF NOT EXISTS delivery_terms_source text;

COMMENT ON COLUMN public.retailers.delivery_terms_source IS
  'WHERE the delivery terms came from, free text, paired with delivery_terms_observed_at. '
  '"checkout" = read off the retailer''s own basket/checkout by a person. "site" = stated on a '
  'delivery/help page. "feed" = supplied in the datafeed. NULL = unrecorded, which for a '
  'non-NULL delivery_model means the provenance was lost rather than absent. '
  'THE POINT IS DECAY, NOT CREDIT. A feed value re-arrives every import; a checkout observation '
  'is a photograph that is correct on the day and silently stale afterwards, and nothing '
  're-reads it. delivery_terms_observed_at alone cannot distinguish "old and stable" from '
  '"old and unverified". Work-list item 158.';

-- NICHE BEAUTY (32). Confirmed from their checkout: GBP 9.95 Premium Standard, carried by DHL
-- and FedEx, free above the GBP 75 threshold already confirmed on their site.
--
-- THIS REMOVES AN ADVANTAGE RATHER THAN GRANTING ENTRY. delivery_model = 'unknown' did not keep
-- Niche Beauty out of ranking: lib/delivery.ts returns {known:false}, and both callers then
-- keep the GOODS total -- which RoutineBuilder.tsx:669 sorts against nine rivals' DELIVERED
-- totals. Measured on 1,451 contested products: NB won 202 on that basis and wins 32 once
-- priced. 170 losses, ZERO newly-wins, and the zero is structural -- imputing GBP 0 delivery
-- can only ever flatter, so pricing it can only ever cost.
--
-- HIGHEST TERMS IN THE FLEET ON BOTH AXES, and the cost is the one that bites: GBP 75 threshold
-- against a GBP 50 next-highest and a GBP 30 median (1.5x), but GBP 9.95 against a fleet
-- MAXIMUM of GBP 3.99 (2.5x). The 170 losers average GBP 23.92 of goods, far below the
-- threshold, so they pay the full 9.95.

UPDATE public.retailers
   SET delivery_model = 'tiered',
       delivery_threshold = 75.00,
       delivery_cost = 9.95,
       delivery_terms_observed_at = now(),
       delivery_terms_source = 'checkout'
 WHERE id = 32;

-- --- Verification (convention 4: assert, do not assume) ----------------------
DO $$
DECLARE n_unknown int; r record;
BEGIN
  SELECT * INTO r FROM public.retailers WHERE id = 32;
  IF r.delivery_model <> 'tiered' OR r.delivery_threshold <> 75.00 OR r.delivery_cost <> 9.95
     OR r.delivery_terms_observed_at IS NULL OR r.delivery_terms_source <> 'checkout' THEN
    RAISE EXCEPTION 'Niche Beauty terms did not land: % / % / % / % / %',
      r.delivery_model, r.delivery_threshold, r.delivery_cost,
      r.delivery_terms_observed_at, r.delivery_terms_source;
  END IF;

  -- The whole point of the detector that raised this. It must now be empty.
  SELECT count(*) INTO n_unknown FROM public.retailers_delivery_unknown;
  IF n_unknown <> 0 THEN
    RAISE EXCEPTION 'retailers_delivery_unknown still returns % row(s)', n_unknown;
  END IF;
END $$;

-- VERIFIED AFTER APPLYING: retailers_delivery_unknown returns 0 rows; 0 active retailers at
-- delivery_model='unknown'; 1 of 11 active retailers carries a delivery_terms_source, the other
-- ten being NULL because their provenance was lost rather than absent.
--
-- MONITOR CONFIRMED SILENT: monitor-retailer-feeds line 267 has deliveryUnknown.length === 0 in
-- the SEND CONDITION, not merely in the body, so with no other failure the 09:00 run sends no
-- email at all; and line 381 renders deliverySection as '' at zero, so no delivery section
-- appears even if an email is sent for another reason. The all_healthy payload still asserts
-- delivery_unknown: 0 rather than omitting it -- absent would mean nobody asked.
