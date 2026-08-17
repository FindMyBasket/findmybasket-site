-- APPLIED to production 2026-08-17 via MCP apply_migration; committed as the record.
-- Retailers 9 (Amazon) and 10 (eBay). Work-list items 177, 61.
--
-- WHAT THEY HELD: `tiered / cost 0.00 / threshold 0.00` -- free above zero. deliveryFor()
-- returns cost 0 for every basket at every size. Both INACTIVE, so nothing read them -- and
-- INACTIVE IS NOT A DEFENCE: one `active = true` away from ranking Amazon as free delivery
-- for every shopper, and NOBODY CHOSE IT. It is the shape a row takes when someone fills a
-- NOT NULL column to get past a constraint.
--
-- FOUR INSTANCES OF THE SAME SHAPE, not three. Branded Beauty (6) and Skin Cupid (7) carry
-- `tiered / 0.00 / 30.00` -- free above 30 AND free below it, self-contradictory, meaning
-- free everywhere. All four are permitted by retailers_delivery_shape, which tests
-- NULL-NESS RATHER THAN MEANING: it asks whether a tiered retailer HAS a cost and a
-- threshold, never whether the pair says anything.
--
-- WHY `unknown` AND NOT A NUMBER. Amazon's non-Prime UK delivery is not a retailer-level
-- term at all: free over a threshold on ELIGIBLE items, otherwise a charge that varies BY
-- SELLER, with third-party sellers setting their own. Our own live data shows it on one
-- page -- "COSRX Inc." and "Medpak EU" are different sellers with different terms.
--
-- That is item 61's finding restated: delivery here is a property of the SHOPPER and the
-- SELLER, not of the retailer. A tiered pair would be a defensible-looking number that is
-- wrong per listing, which is worse than an honest `unknown`.

UPDATE public.retailers
   SET delivery_model = 'unknown', delivery_cost = NULL, delivery_threshold = NULL,
       delivery_terms_observed_at = now(), delivery_terms_source = 'site',
       delivery_terms_note =
         'Amazon UK non-Prime delivery is not a retailer-level term: free over a threshold on '
         'ELIGIBLE items only, otherwise a charge that varies BY SELLER, and third-party '
         'sellers set their own. Live data on one product page shows COSRX Inc. and Medpak EU '
         'as different sellers with different terms. Any tiered pair would be wrong per '
         'listing. Previously tiered/0.00/0.00 -- free above zero -- which nobody chose. '
         'Amazon must not be activated as a catalogue retailer until item 61 phase 2 decides '
         'how a per-shopper, per-seller delivery cost enters the optimiser. Item 177.'
 WHERE id = 9;

UPDATE public.retailers
   SET delivery_model = 'unknown', delivery_cost = NULL, delivery_threshold = NULL,
       delivery_terms_observed_at = now(), delivery_terms_source = 'site',
       delivery_terms_note =
         'eBay delivery is set PER LISTING by the individual seller and has no retailer-level '
         'value at all -- more variable than Amazon, not less. Previously tiered/0.00/0.00, '
         'free above zero, which nobody chose. eBay is a search link only and must not be '
         'activated as a catalogue retailer. Item 177.'
 WHERE id = 10;

DO $$
DECLARE n int; r record;
BEGIN
  FOR r IN SELECT id, delivery_model, delivery_cost, delivery_threshold, delivery_terms_note
             FROM public.retailers WHERE id IN (9,10) LOOP
    IF r.delivery_model <> 'unknown' OR r.delivery_cost IS NOT NULL
       OR r.delivery_threshold IS NOT NULL OR length(coalesce(r.delivery_terms_note,'')) < 20 THEN
      RAISE EXCEPTION 'retailer % did not land', r.id;
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM public.retailers
   WHERE COALESCE(active,false) AND COALESCE(delivery_model,'unknown') NOT IN ('tiered','flat');
  IF n <> 0 THEN RAISE EXCEPTION '% active retailer(s) now unpriced', n; END IF;
  SELECT count(*) INTO n FROM public.retailers_delivery_unknown;
  IF n <> 0 THEN RAISE EXCEPTION 'retailers_delivery_unknown returned % row(s)', n; END IF;
END $$;

-- BRANDED BEAUTY (6) AND SKIN CUPID (7) ARE DELIBERATELY NOT CHANGED HERE. Both are inactive
-- and both are wrong, but their terms are ESTABLISHABLE from their own sites, so setting them
-- is an observation rather than a rewrite -- different work, different act, and bundling a
-- fixable case with an unfixable one hides which is which. Recorded in item 177.
