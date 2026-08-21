-- Featured-products selection, with the multi-retailer test INSIDE the query.
-- Work-list item 238.
--
-- WHAT WAS WRONG. getFeaturedProducts fetched `products_active` with `.limit(500)`
-- and NO `.order()`, then applied `retailerCount >= 2` to whatever those 500
-- happened to be. Measured 21 August 2026:
--
--   category     qualifying   reachable within the 500
--   skincare          6,270                        90
--   makeup            2,353                        42
--   hair              2,341                        71
--   fragrance         1,132                       176
--   bath_body           915                        58
--   supplements          35                         2
--
-- Every category lost 85-99% of its qualifying set. The big five still had more
-- than 24 survivors so the block filled and nothing looked wrong; supplements was
-- the first pool thin enough for the defect to reach the page, as two products.
--
-- THE BLOCK WAS PRESENTING THE BEST OF AN ARBITRARY SAMPLE AS THE BEST OF THE
-- CATEGORY, on every page, for as long as the cap has existed.
--
-- ORDERING THE CAP WOULD NOT HAVE FIXED IT. A larger or deterministic sample is
-- still a sample: the test that decides eligibility has to run over the whole
-- category, which is why it moved in here rather than the limit moving up.
--
-- THE ELIGIBILITY RULE IS UNCHANGED AND DELIBERATE: at least two DISTINCT ACTIVE
-- retailers with an in-stock price. A featured product claims a comparison, so a
-- single-retailer row must never appear here however thin the category is. The
-- honest count for supplements under that rule is 35, not 2.
--
-- Ranking is retailer_count DESC then saving DESC, matching what the TypeScript
-- did, so this migration changes WHICH ROWS ARE REACHABLE and nothing else about
-- the ordering.

CREATE OR REPLACE FUNCTION public.fmb_featured_products(
  p_category text,
  p_limit    integer DEFAULT 24
)
RETURNS TABLE (
  id               integer,
  name             text,
  brand            text,
  normalised_brand text,
  product_type     text,
  subcategory      text,
  image_url        text,
  retailer_count   bigint,
  min_price        numeric,
  next_best_price  numeric,
  saving_pct       integer
)
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  WITH live AS (
    SELECT
      pa.id, pa.name, pa.brand, pa.normalised_brand, pa.product_type,
      pa.subcategory, pa.image_url,
      COUNT(DISTINCT rp.retailer_id)                        AS retailer_count,
      (ARRAY_AGG(rp.price ORDER BY rp.price))[1]            AS p1,
      (ARRAY_AGG(rp.price ORDER BY rp.price))[2]            AS p2
    FROM products_active pa
    JOIN retailer_prices rp ON rp.product_id = pa.id AND rp.in_stock = true
    JOIN retailers r        ON r.id = rp.retailer_id AND r.active = true
    WHERE pa.top_category = p_category
      AND pa.image_url IS NOT NULL AND pa.image_url <> ''
      AND NOT (pa.tags @> '{cleanup_remove}')
      AND rp.price > 0
    GROUP BY pa.id, pa.name, pa.brand, pa.normalised_brand, pa.product_type,
             pa.subcategory, pa.image_url
    -- THE ELIGIBILITY TEST, over the whole category rather than over a sample.
    HAVING COUNT(DISTINCT rp.retailer_id) >= 2
  )
  SELECT
    l.id, l.name, l.brand, l.normalised_brand, l.product_type, l.subcategory,
    l.image_url,
    l.retailer_count,
    l.p1 AS min_price,
    l.p2 AS next_best_price,
    -- Saving anchored to the NEXT-BEST price, never the most expensive, so one
    -- outlier high price cannot set the percentage. Mirrors nextBestSavingPct()
    -- in lib/queries.ts. NULL when the two best prices are equal: that is "no
    -- genuine saving to show", which is not the same as a saving of zero.
    CASE WHEN l.p2 > l.p1
         THEN ROUND(((l.p2 - l.p1) / l.p2) * 100)::integer
         ELSE NULL END AS saving_pct
  FROM live l
  ORDER BY l.retailer_count DESC,
           (CASE WHEN l.p2 > l.p1 THEN ROUND(((l.p2 - l.p1) / l.p2) * 100) ELSE 0 END) DESC,
           l.id
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.fmb_featured_products(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fmb_featured_products(text, integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.fmb_featured_products(text, integer) IS
  'Featured products for a category page. The >= 2 distinct active retailers test runs over the WHOLE category, not over a fetched sample -- the defect this replaced applied it to an unordered .limit(500), which reached 2 of 35 qualifying supplements rows and 90 of 6,270 skincare ones. A featured product claims a comparison; single-retailer rows must never appear here. Work-list item 238.';
