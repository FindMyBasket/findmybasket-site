-- Expose search_vector through products_active (append-only; same column order
-- as the live view so CREATE OR REPLACE is accepted).
CREATE OR REPLACE VIEW public.products_active AS
SELECT id, name, brand, category, image_url, ean, created_at, ingredients,
       concerns, subcategory, normalised_brand, canonical_size, match_key,
       tags, shade, product_type, top_category, merged_into, merged_at,
       description, search_vector
FROM products p
WHERE merged_into IS NULL
  AND parent_product_id IS NULL
  AND image_url IS NOT NULL
  AND image_url != ''
  AND EXISTS (SELECT 1 FROM retailer_prices rp WHERE rp.product_id = p.id);

-- Stage 1 product search. Weighted FTS (name > brand/product_type > description)
-- with substring boosts so a typed product/brand name still ranks first.
-- product_type is kept in the result set for frontend parity; total_count is the
-- full match count (count(*) OVER()) so callers can show "top N of M".
-- NOTE products.id is integer, cast to bigint to match the declared OUT type.
CREATE OR REPLACE FUNCTION public.fmb_search_products(
  search_query text,
  category_filter text DEFAULT NULL,
  limit_count int DEFAULT 30
)
RETURNS TABLE (
  id bigint,
  name text,
  brand text,
  product_type text,
  top_category text,
  subcategory text,
  image_url text,
  rank real,
  total_count bigint
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  ts_query tsquery;
  query_lower text := lower(trim(search_query));
BEGIN
  IF query_lower = '' OR query_lower IS NULL THEN
    RETURN;
  END IF;

  -- websearch_to_tsquery handles multi-word queries, phrase matching, and
  -- naturally accepts user-typed input.
  ts_query := websearch_to_tsquery('english', query_lower);

  -- Empty tsquery means no meaningful tokens; bail out.
  IF ts_query = ''::tsquery THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id::bigint,
    p.name,
    p.brand,
    p.product_type,
    p.top_category,
    p.subcategory,
    p.image_url,
    ts_rank(p.search_vector, ts_query) AS rank,
    count(*) OVER() AS total_count
  FROM products_active p
  WHERE p.search_vector @@ ts_query
    AND (category_filter IS NULL OR p.top_category = category_filter)
  ORDER BY
    -- Exact substring match in name first (typed the product name).
    CASE WHEN position(query_lower in lower(p.name)) > 0 THEN 0 ELSE 1 END,
    -- Then brand substring match (typed a brand name).
    CASE WHEN position(query_lower in lower(coalesce(p.brand, ''))) > 0 THEN 0 ELSE 1 END,
    -- Then full-text rank (typed a concept like "niacinamide").
    ts_rank(p.search_vector, ts_query) DESC,
    p.id
  LIMIT limit_count;
END;
$$;

COMMENT ON FUNCTION public.fmb_search_products IS
'Full-text product search across names, brands, product types, and descriptions. Weighted (name > brand/product_type > description). Optional category filter. Stage 1 of Product Finder.';
