-- Product Finder: interleave name and description matches in the result order.
-- The previous version ordered by an absolute-priority CASE (name-substring, then
-- brand-substring, then ts_rank), which buried every description-only match behind
-- the full run of name matches - so a product mentioning "niacinamide" only in its
-- description landed on page 16+ and was effectively invisible.
--
-- This version buckets each match as brand / name / description, ranks within each
-- bucket by ts_rank, then assigns an interleave position so that:
--   * brand-substring matches always come first (positions 1..n), preserving
--     "typed a brand name" intent,
--   * name and description matches alternate 2:1 (two name, then one description)
--     in the 1000+ band, so description-only results surface at positions 3, 6, 9,
--     12 ... of the name/description run instead of after all of it.
--
-- Mirrors the definition live on production (captured via pg_get_functiondef).
-- Same OUT columns as before, so CREATE OR REPLACE needs no DROP and the frontend
-- is unchanged. The prefix-matching tsquery build is identical to the prior
-- migration (every >= 2 char token gets :*).
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
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  ts_query tsquery;
  query_lower text := lower(trim(search_query));
  cleaned_query text;
  prefix_query text;
BEGIN
  IF query_lower IS NULL OR query_lower = '' THEN RETURN; END IF;

  cleaned_query := regexp_replace(query_lower, '[^a-z0-9\s]', ' ', 'g');
  cleaned_query := trim(regexp_replace(cleaned_query, '\s+', ' ', 'g'));
  IF cleaned_query = '' THEN RETURN; END IF;

  SELECT string_agg(
    CASE WHEN length(t) >= 2 THEN t || ':*' ELSE t END,
    ' & '
  ) INTO prefix_query
  FROM unnest(string_to_array(cleaned_query, ' ')) AS t;

  BEGIN
    ts_query := to_tsquery('english', prefix_query);
  EXCEPTION WHEN OTHERS THEN RETURN; END;

  IF ts_query IS NULL OR ts_query = ''::tsquery THEN RETURN; END IF;

  RETURN QUERY
  WITH matches AS (
    SELECT
      p.id::bigint AS product_id, p.name AS product_name, p.brand AS product_brand,
      p.product_type AS product_ptype, p.top_category AS product_tcat,
      p.subcategory AS product_subcat, p.image_url AS product_image,
      ts_rank(p.search_vector, ts_query) AS r,
      CASE
        WHEN position(query_lower in lower(coalesce(p.brand, ''))) > 0 THEN 'brand'
        WHEN position(query_lower in lower(p.name)) > 0 THEN 'name'
        ELSE 'description'
      END AS bucket
    FROM products_active p
    WHERE p.search_vector @@ ts_query
      AND (category_filter IS NULL OR p.top_category = category_filter)
  ),
  ranked AS (
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY r DESC, product_id) AS rn
    FROM matches
  ),
  positioned AS (
    SELECT *,
      CASE bucket
        WHEN 'brand' THEN rn
        WHEN 'name' THEN 1000 + ((rn - 1) / 2) * 3 + ((rn - 1) % 2) + 1
        WHEN 'description' THEN 1000 + rn * 3
      END AS interleave_pos
    FROM ranked
  )
  SELECT
    product_id, product_name, product_brand, product_ptype,
    product_tcat, product_subcat, product_image, r,
    count(*) OVER()
  FROM positioned
  ORDER BY interleave_pos, r DESC, product_id
  LIMIT limit_count;
END;
$function$;
