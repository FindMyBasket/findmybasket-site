-- Brand search index: accent-folded, punctuation-stripped brand lookup.
--
-- WHY THIS EXISTS
-- The english text search parser splits "L'Oréal" into separate tokens, so the
-- leading letter detaches and the accent never folds. A shopper typing the brand
-- the natural way gets almost nothing: "loreal paris" returned 9 results against
-- 1,470 products, "l'occitane" typed as "loccitane" returned 0 against 17.
-- searchBrands had the same defect from a different cause, matching brand with
-- ILIKE, so %loreal%, %kerastase% and %loccitane% all returned nothing at all.
--
-- Apostrophes are NOT the predictor. Kiehl's, Burt's Bees, Palmer's and
-- Victoria's Secret all work, and Lancôme works despite the accent. What matters
-- is whether the product name spells the brand the way a shopper types it.
--
-- WHY A DERIVED TABLE rather than folding at query time. Measured over the 127
-- real queries in search_events:
--   current ILIKE over products_active      p50 182.3 ms   p95 201.7 ms
--   folded LIKE over products_active        p50 309.7 ms   p95 400.8 ms
--   folded LIKE over this index (~2k rows)  p50   0.0 ms   p95   0.0 ms
-- Folding at query time doubles a leg that already dominates end-to-end search
-- latency. One row per brand rather than per product removes it instead.
--
-- Rejected alternatives, both verified rather than assumed:
--   brand_aliases      196 rows covering 134 brands against 2,520 in the
--                      catalogue. It would fix whichever brands someone
--                      remembered to add and silently miss the rest.
--   normalised_brand   lowercased only. Still holds "l'oréal paris" and
--                      "d'alba", and is internally inconsistent, carrying both
--                      "kerastase" and "kérastase" as separate values.

CREATE TABLE IF NOT EXISTS public.brand_search_index (
  brand            text PRIMARY KEY,
  brand_folded     text NOT NULL,
  normalised_brand text,
  product_count    int  NOT NULL,
  refreshed_at     timestamptz NOT NULL DEFAULT now(),
  -- max(retailer_import_config.last_imported_at) observed when this row was
  -- built. The refresh decision is driven by this watermark, never by a clock.
  source_watermark timestamptz
);

CREATE INDEX IF NOT EXISTS idx_brand_search_index_folded
  ON public.brand_search_index (brand_folded text_pattern_ops);

COMMENT ON TABLE public.brand_search_index IS
  'Derived cache: one row per catalogue brand with an accent-folded, apostrophe-stripped form for search. Rebuilt by fmb_refresh_brand_index() when the catalogue watermark moves. Never write to this by hand.';


-- Rebuild. Measured at ~105 ms for ~2,053 brands, so it is cheap enough to run
-- on every catalogue movement rather than trying to compute a delta.
CREATE OR REPLACE FUNCTION public.fmb_refresh_brand_index()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_watermark timestamptz;
  v_rows int;
BEGIN
  -- DELIBERATE: the watermark is max(last_imported_at) with NO filter on
  -- last_import_status. Do not "fix" this by adding `WHERE last_import_status =
  -- 'ok'`. A failed or partial run may still have written product rows, so a
  -- status filter would hold the watermark back and leave the index stale on
  -- exactly the runs most likely to have changed the catalogue unpredictably.
  -- The watermark must err toward rebuilding. A needless rebuild costs ~105 ms;
  -- a missed one means new brands silently stop resolving in search.
  SELECT max(last_imported_at) INTO v_watermark FROM retailer_import_config;

  -- Source is products_active, so the image filter and the active-retailer
  -- predicate are inherited rather than restated and left to drift.
  WITH fresh AS (
    SELECT
      p.brand,
      translate(
        lower(replace(p.brand, '''', '')),
        'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūçñýÿšž',
        'aaaaaaaeeeeeiiiiiooooooouuuuucnyysz'
      ) AS brand_folded,
      min(p.normalised_brand) AS normalised_brand,
      count(*)::int AS product_count
    FROM products_active p
    WHERE p.brand IS NOT NULL AND p.brand <> ''
    GROUP BY p.brand
  ),
  upserted AS (
    INSERT INTO brand_search_index
      (brand, brand_folded, normalised_brand, product_count, refreshed_at, source_watermark)
    SELECT brand, brand_folded, normalised_brand, product_count, now(), v_watermark
    FROM fresh
    ON CONFLICT (brand) DO UPDATE SET
      brand_folded     = excluded.brand_folded,
      normalised_brand = excluded.normalised_brand,
      product_count    = excluded.product_count,
      refreshed_at     = excluded.refreshed_at,
      source_watermark = excluded.source_watermark
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM upserted;

  -- Brands that have left the catalogue must go, or the strip keeps offering a
  -- chip that leads to an empty page.
  DELETE FROM brand_search_index bsi
  WHERE NOT EXISTS (
    SELECT 1 FROM products_active p
    WHERE p.brand = bsi.brand AND p.brand IS NOT NULL AND p.brand <> ''
  );

  RETURN v_rows;
END;
$function$;


-- Poll guard. The CRON only polls; this function decides. Rebuild happens if and
-- only if the catalogue watermark has moved past what the index was built from,
-- so the refresh cannot drift out of step with the catalogue however the import
-- cadence changes. A poll that finds nothing costs one indexed comparison.
CREATE OR REPLACE FUNCTION public.fmb_refresh_brand_index_if_stale()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_catalogue timestamptz;
  v_index     timestamptz;
BEGIN
  SELECT max(last_imported_at) INTO v_catalogue FROM retailer_import_config;
  SELECT max(source_watermark) INTO v_index     FROM brand_search_index;

  -- Empty index, or catalogue has moved: rebuild. A failed prior rebuild leaves
  -- the watermark behind, so the next poll simply retries. Self-healing.
  IF v_index IS NULL OR v_catalogue IS NULL OR v_catalogue > v_index THEN
    RETURN fmb_refresh_brand_index();
  END IF;

  RETURN 0;
END;
$function$;


-- Staleness signal, queryable now.
--
-- TWO INDEPENDENT CHECKS, deliberately. watermark_behind is derived from the
-- refresh mechanism itself, so it goes blind in exactly the case where the
-- mechanism is the thing that is broken. brand_count_gap compares the catalogue
-- to the index directly and shares no logic with the watermark, so it still
-- fires when the watermark is wrong, frozen, or never written.
--
-- This project has lost eight days to a single signal failing closed: dead r12
-- rows sat in stock because the only check ran inside the importer, and feed
-- monitoring dropped the retailer the moment it was deactivated. Two signals
-- that fail independently is the response to that.
CREATE OR REPLACE VIEW public.brand_index_health AS
SELECT
  (SELECT count(DISTINCT brand) FROM products_active
    WHERE brand IS NOT NULL AND brand <> '')            AS catalogue_brands,
  (SELECT count(*) FROM brand_search_index)             AS index_rows,
  (SELECT count(DISTINCT brand) FROM products_active
    WHERE brand IS NOT NULL AND brand <> '')
    - (SELECT count(*) FROM brand_search_index)         AS brand_count_gap,
  (SELECT max(refreshed_at) FROM brand_search_index)    AS last_refreshed_at,
  (SELECT max(source_watermark) FROM brand_search_index) AS index_watermark,
  (SELECT max(last_imported_at) FROM retailer_import_config) AS catalogue_watermark,
  ((SELECT max(last_imported_at) FROM retailer_import_config)
    > COALESCE((SELECT max(source_watermark) FROM brand_search_index), '-infinity'::timestamptz))
                                                        AS watermark_behind,
  EXTRACT(epoch FROM now() - COALESCE((SELECT max(refreshed_at) FROM brand_search_index), now()))/60
                                                        AS minutes_since_refresh;

COMMENT ON VIEW public.brand_index_health IS
  'Staleness signal for brand_search_index. brand_count_gap is an INDEPENDENT check: it compares catalogue to index directly and shares no logic with watermark_behind, so it still fires if the watermark mechanism itself is broken. Non-zero gap or watermark_behind = true means the index needs a rebuild.';

-- PRIVILEGES. This project's default privileges grant ALL on new public tables
-- to anon and authenticated, so a bare `GRANT SELECT` restricts NOTHING: the
-- table ships writable by anyone holding the anon key. Revoke first, then grant
-- only SELECT. Verify with has_table_privilege after applying; do not assume the
-- grant did what it looks like it does.
REVOKE ALL ON public.brand_search_index FROM anon, authenticated;
REVOKE ALL ON public.brand_index_health  FROM anon, authenticated;
GRANT SELECT ON public.brand_search_index TO anon, authenticated, service_role;
GRANT SELECT ON public.brand_index_health TO anon, authenticated, service_role;

-- Belt and braces: RLS with a read-only policy, so a future default-privilege
-- change cannot quietly reopen writes. The refresh functions are SECURITY
-- DEFINER and owned by the table owner, so they still write.
ALTER TABLE public.brand_search_index ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brand_search_index_read ON public.brand_search_index;
CREATE POLICY brand_search_index_read ON public.brand_search_index FOR SELECT USING (true);

-- REFRESH POLL, not enabled by this migration. Enable after the 06:00 read on
-- 2026-07-28:
--
--   SELECT cron.schedule('brand-index-refresh', '*/11 * * * *',
--                        $$SELECT public.fmb_refresh_brand_index_if_stale()$$);
--
-- Deliberately NOT windowed to import hours. A hardcoded window is one more
-- dormant rule that breaks silently the day a retailer is added or its cron is
-- moved, which is the failure class this index exists to avoid. A poll that
-- finds nothing is a single indexed comparison, so running it around the clock
-- costs nothing worth optimising: 131 no-op polls a day against the ~14 real
-- rebuilds that the watermark actually triggers.
--
-- 11 minutes: comfortably under the 30-minute minimum gap between consecutive
-- import kickoffs, so an import's brands are indexed well before the next run
-- completes, and coprime with 60 so it does not lock onto the :00 and :30
-- kickoff minutes.
