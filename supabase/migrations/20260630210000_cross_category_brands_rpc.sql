-- Cross-category brand surfacing (Change 1).
-- For a given top_category, returns brands that have meaningful inventory in
-- BOTH that category and at least one other, ranked by their presence in this
-- category. One row per normalised_brand (representative display via mode()).
-- Aggregation lives in SQL (single round-trip, hits idx_products_brand_*);
-- the app applies a small own-brand/noise denylist and the final LIMIT, so the
-- function over-returns (p_limit default 40) to leave room for that filtering.
CREATE OR REPLACE FUNCTION fmb_cross_category_brands(
  p_category   text,
  p_min_this   int DEFAULT 5,
  p_min_other  int DEFAULT 5,
  p_limit      int DEFAULT 40
)
RETURNS TABLE (
  normalised_brand  text,
  brand             text,
  in_this           bigint,
  in_other          bigint,
  other_categories  text[]
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.normalised_brand,
    mode() WITHIN GROUP (ORDER BY p.brand) AS brand,
    COUNT(*) FILTER (WHERE p.top_category = p_category)  AS in_this,
    COUNT(*) FILTER (WHERE p.top_category <> p_category) AS in_other,
    array_agg(DISTINCT p.top_category)
      FILTER (WHERE p.top_category <> p_category)        AS other_categories
  FROM products_active p
  WHERE p.normalised_brand IS NOT NULL
    AND p.top_category IS NOT NULL
    AND NOT (p.tags @> ARRAY['cleanup_remove'])
  GROUP BY p.normalised_brand
  HAVING COUNT(*) FILTER (WHERE p.top_category = p_category)  >= p_min_this
     AND COUNT(*) FILTER (WHERE p.top_category <> p_category) >= p_min_other
  ORDER BY in_this DESC
  LIMIT p_limit;
$$;
