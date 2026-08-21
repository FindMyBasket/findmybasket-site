-- Add a per-brand cap of 3 to the featured block. Work-list item 238.
--
-- WHY. Measured 21 August 2026, over the corrected (whole-category) candidate
-- sets, top 24 per category:
--
--   category      distinct brands   largest single brand
--   makeup                      5   bareMinerals 17 of 24
--   skincare                    5   Beauty of Joseon 12 + COSRX 5 + medicube 5 = 22 of 24
--   supplements                10   Vida Glow 12 of 24
--   fragrance                  16   4
--   hair                       15   3
--   bath_body                  13   3
--
-- MAKEUP WAS WORSE THAN SUPPLEMENTS. Vida Glow at 12 of 24 is the variant
-- flooding predicted in the collagen analysis, but bareMinerals at 17 of 24 was
-- already worse and nobody had looked. Supplements made the pattern visible; it
-- did not invent it.
--
-- THE TRADE, STATED HONESTLY BECAUSE IT IS NOT FREE AND IT IS NOT EVEN:
--
--   category      uncapped   cap 3   distinct brands after
--   skincare            24      24   5 -> 18
--   makeup              24      24   5 -> 18
--   hair                24      24   15 -> 17
--   fragrance           24      24   16 -> 17
--   bath_body           24      24   13 -> 17
--   SUPPLEMENTS         24      20   10 -> ~10
--
-- ONLY SUPPLEMENTS PAYS, AND IT PAYS FOUR PRODUCTS so the other five categories
-- go from 5 distinct brands to 18. Twenty is not two: this does not thin
-- supplements back toward the defect just fixed, where the page showed two.
-- The cost is real, it falls entirely on the thinnest category, and it was
-- measured rather than assumed before being accepted.
--
-- THE CAP IS ON normalised_brand, not brand: the display string varies
-- ("Ancient & Brave" / "Ancient + Brave"), and capping on it would let a brand
-- exceed the cap through its own spelling variants.
--
-- ORDERING IS UNCHANGED: retailer_count DESC, then saving DESC. See the item for
-- why saving-primary was measured and rejected -- it collapses to two-retailer
-- rows and surfaces the suspect-price population.

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
      COUNT(DISTINCT rp.retailer_id)             AS retailer_count,
      (ARRAY_AGG(rp.price ORDER BY rp.price))[1] AS p1,
      (ARRAY_AGG(rp.price ORDER BY rp.price))[2] AS p2
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
  ),
  scored AS (
    SELECT l.*,
           CASE WHEN l.p2 > l.p1
                THEN ROUND(((l.p2 - l.p1) / l.p2) * 100)
                ELSE 0 END AS saving_sort
    FROM live l
  ),
  ranked AS (
    SELECT s.*,
           ROW_NUMBER() OVER (
             PARTITION BY s.normalised_brand
             ORDER BY s.retailer_count DESC, s.saving_sort DESC, s.id
           ) AS rn_brand
    FROM scored s
  )
  SELECT
    r.id, r.name, r.brand, r.normalised_brand, r.product_type, r.subcategory,
    r.image_url,
    r.retailer_count,
    r.p1 AS min_price,
    r.p2 AS next_best_price,
    -- Saving anchored to the NEXT-BEST price, never the most expensive. NULL when
    -- the two best prices are equal: "no genuine saving to show", which is not the
    -- same as a saving of zero. The sort uses 0 for that case; the OUTPUT uses NULL.
    CASE WHEN r.p2 > r.p1
         THEN ROUND(((r.p2 - r.p1) / r.p2) * 100)::integer
         ELSE NULL END AS saving_pct
  FROM ranked r
  WHERE r.rn_brand <= 3          -- PER-BRAND CAP
  ORDER BY r.retailer_count DESC, r.saving_sort DESC, r.id
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.fmb_featured_products(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fmb_featured_products(text, integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.fmb_featured_products(text, integer) IS
  'Featured products for a category page. The >= 2 distinct active retailers test runs over the WHOLE category, not a fetched sample. Capped at 3 per normalised_brand: uncapped, makeup was 17 of 24 from bareMinerals and skincare 22 of 24 from three brands. The cap costs only supplements (24 -> 20) and takes the other five from 5 distinct brands to 18. Ranked retailer_count DESC then saving DESC -- saving-primary was measured and rejected because it collapses to two-retailer rows and surfaces the suspect-price population. Work-list item 238.';
