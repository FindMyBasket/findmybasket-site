-- amazon_asin_map — the harvested Amazon ASIN ↔ catalogue mapping (work-list item 60,
-- tranche 1: K-beauty).
--
-- NOTHING READS THIS TABLE, AND THAT IS THE POINT.
--
-- `products.amazon_asin` already exists and IS the consumption point: app/product/[id]
-- reads it to build the affiliate URL, falling back to a search URL when it is null.
-- Writing harvest output straight into that column would make HARVESTING AND PUBLISHING
-- THE SAME ACT — a script run would change what visitors see, with no step in between
-- where a human looked at the match.
--
-- Keeping the map separate makes promotion (map -> products.amazon_asin) a deliberate,
-- reviewable step gated on `human_verified`. That is the whole argument for the table.
--
-- WHY A TABLE AND NOT A COMMITTED JSON FILE:
--   1. The map is a MEASUREMENT, not a constant. ASINs rotate, listings merge and split,
--      and the catalogue moves nightly. A committed JSON is a frozen catalogue state that
--      goes stale silently — the standing rule against baking counts, prices and ids into
--      the repo applies to this exactly.
--   2. It must hold the NON-MATCHES. The 45 unmatched and the 42 without identifiers are
--      the working set for the manual pass; a file keyed on successful matches throws away
--      the half that needs the work.
--   3. It carries provenance a single column cannot: WHICH identifier matched, when it was
--      harvested, and which brand query surfaced the ASIN.
--
-- THE ROWS ARE NOT LOADED HERE, DELIBERATELY. Harvest output is re-derivable measurement
-- data and would freeze a dated snapshot into schema history if it shipped as DDL. The
-- table is the artefact under version control; its contents are loaded by
-- `scripts/amazon-asin-map.mjs` plus a resolve step, and can be reloaded at any time.

CREATE TABLE IF NOT EXISTS public.amazon_asin_map (
  asin            text PRIMARY KEY,
  product_id      integer REFERENCES public.products(id) ON DELETE SET NULL,
  matched_ean     text,
  amazon_title    text,
  amazon_brand    text,
  -- CONFIRMATION ONLY, NEVER A GATE. Amazon reported "1 g" for a 100g cream carried by
  -- nine retailers, and "3 count" against our "34g". `size` is a merchandising field, not
  -- a spec. Stored so a human reviewing a match can eyeball it; never compared in code.
  amazon_size     text,
  via_brand       text,
  match_state     text NOT NULL,
  -- Every identifier the listing returned, not just the one that matched. One ASIN
  -- returned THIRTEEN EANs because an Amazon listing aggregates variants and many
  -- sellers' stock. Keeping all of them is what makes a re-match possible when the
  -- catalogue gains a product that one of the other twelve would have hit.
  identifiers     text[] NOT NULL DEFAULT '{}',
  human_verified  boolean NOT NULL DEFAULT false,
  harvested_at    timestamptz NOT NULL DEFAULT now(),
  notes           text,
  CONSTRAINT amazon_asin_map_state_check CHECK (match_state IN (
    'matched',               -- an identifier hit a live catalogue product
    'unmatched',             -- identifiers present, none hit — THE MANUAL PASS
    'ambiguous',             -- an identifier hit more than one product; ours to resolve
    'no_identifier',         -- a single product Amazon holds no barcode for
    'no_identifier_bundle'   -- OUT OF SCOPE BY CONSTRUCTION — see below
  ))
);

COMMENT ON TABLE public.amazon_asin_map IS
  'Harvested Amazon ASIN to catalogue mapping (work-list item 60). NOTHING READS THIS. '
  'products.amazon_asin is the consumption point; promotion from this table into that '
  'column is a separate deliberate step gated on human_verified, so that harvesting and '
  'publishing are not one act. Reloadable from scripts/amazon-asin-map.mjs.';

COMMENT ON COLUMN public.amazon_asin_map.match_state IS
  'matched | unmatched | ambiguous | no_identifier | no_identifier_bundle. '
  'no_identifier_bundle is NOT A COVERAGE GAP: an Amazon multi-pack has no manufacturer '
  'barcode because it is not a manufactured item — it is a merchandising unit Amazon '
  'assembled. Those rows can never match on EAN however good the pipeline gets, and the '
  'manual pass SKIPS them rather than working them. 38 of the 42 identifier-less ASINs in '
  'the 14 Aug 2026 harvest were medicube multi-packs. See work-list item 95.';

COMMENT ON COLUMN public.amazon_asin_map.amazon_size IS
  'Merchandising field, NOT a spec. Amazon reported "1 g" for a 100g cream. For human '
  'eyeballing only — never gate a match on it (item 60).';

CREATE INDEX IF NOT EXISTS amazon_asin_map_product_id_idx
  ON public.amazon_asin_map (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS amazon_asin_map_state_idx
  ON public.amazon_asin_map (match_state);

-- --- Verification (convention 4: assert, do not assume) ----------------------
DO $$
DECLARE n_rows int; ok boolean;
BEGIN
  SELECT count(*) INTO n_rows FROM public.amazon_asin_map;
  IF n_rows <> 0 THEN
    RAISE EXCEPTION 'amazon_asin_map should arrive empty; found % rows', n_rows;
  END IF;

  -- The CHECK must actually reject an unlisted state, so a typo in a loader cannot
  -- write 'no_match' and have it look like data.
  BEGIN
    INSERT INTO public.amazon_asin_map (asin, match_state) VALUES ('TEST', 'no_match');
    ok := false;
  EXCEPTION WHEN check_violation THEN
    ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'the match_state CHECK accepted an invalid value';
  END IF;

  -- Nothing may read this table yet: assert no view depends on it.
  IF EXISTS (
    SELECT 1 FROM pg_depend d
     JOIN pg_rewrite r ON r.oid = d.objid
     JOIN pg_class c ON c.oid = r.ev_class AND c.relkind = 'v'
    WHERE d.refobjid = 'public.amazon_asin_map'::regclass
  ) THEN
    RAISE EXCEPTION 'a view already depends on amazon_asin_map; it is meant to be unread';
  END IF;

  RAISE NOTICE 'amazon_asin_map created, empty, CHECK verified, no dependent views';
END $$;
