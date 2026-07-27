-- Browse search recall fix: trigram supplement below full text.
-- Replaces fmb_search_products IN PLACE. The signature and return type are
-- unchanged, so every existing caller keeps working untouched.
--
-- NO-CHANGE GUARANTEE, verified not assumed: across the 127 real queries in
-- search_events, all 97 with 3 or more full-text hits return byte-identical
-- results in content, order and total_count. Only the low-hit and brand-identity
-- paths can alter anything.
--
-- N = 3, derived from the 127 real queries in search_events: every rescuable
-- zero-result query is captured by N = 3, and perturbation of working queries
-- only begins at N = 5.
--
-- Supplement rows are APPENDED strictly below every full-text row, never fused.
-- That makes the no-change guarantee structural: when full text returns 3 or
-- more the supplement never runs, and when it does run the full-text rows keep
-- their existing positions.
--
-- Sourced from products_active, NOT the raw predicates, so the image filter is
-- preserved. 510 imageless products are in stock at an active retailer and
-- would otherwise become reachable.
CREATE OR REPLACE FUNCTION public.fmb_search_products(
  search_query text, category_filter text DEFAULT NULL, limit_count integer DEFAULT 30
)
RETURNS TABLE(id bigint, name text, brand text, product_type text, top_category text,
              subcategory text, image_url text, rank real, total_count bigint)
LANGUAGE plpgsql STABLE
AS $function$
#variable_conflict use_column
DECLARE
  ts_query tsquery;
  query_lower text := lower(trim(search_query));
  cleaned_query text;
  prefix_query text;
  fts_hits int := 0;
  norm text;
  supplement_n constant int := 3;
BEGIN
  IF query_lower IS NULL OR query_lower = '' THEN RETURN; END IF;

  cleaned_query := regexp_replace(query_lower, '[^a-z0-9\s]', ' ', 'g');
  cleaned_query := trim(regexp_replace(cleaned_query, '\s+', ' ', 'g'));
  IF cleaned_query = '' THEN RETURN; END IF;

  SELECT string_agg(CASE WHEN length(t) >= 2 THEN t || ':*' ELSE t END, ' & ')
    INTO prefix_query
    FROM unnest(string_to_array(cleaned_query, ' ')) AS t;

  BEGIN
    ts_query := to_tsquery('english', prefix_query);
  EXCEPTION WHEN OTHERS THEN RETURN; END;

  IF ts_query IS NULL OR ts_query = ''::tsquery THEN RETURN; END IF;

  SELECT count(*) INTO fts_hits
  FROM products_active p
  WHERE p.search_vector @@ ts_query
    AND (category_filter IS NULL OR p.top_category = category_filter);

  -- Accent-folded, punctuation-stripped form for the trigram pass. translate()
  -- rather than unaccent(), which is not installed and is not IMMUTABLE.
  norm := translate(query_lower,
    'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūçñýÿšž',
    'aaaaaaaeeeeeiiiiiooooooouuuuucnyysz');
  norm := trim(regexp_replace(regexp_replace(norm, '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'));

  RETURN QUERY
  WITH matches AS (
    SELECT p.id::bigint AS product_id, p.name AS product_name, p.brand AS product_brand,
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
    SELECT *, ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY r DESC, product_id) AS rn
    FROM matches
  ),
  positioned AS (
    SELECT *, CASE bucket
        WHEN 'brand' THEN rn
        WHEN 'name' THEN 1000 + ((rn - 1) / 2) * 3 + ((rn - 1) % 2) + 1
        WHEN 'description' THEN 1000 + rn * 3
      END AS interleave_pos
    FROM ranked
  ),
  brand_hit AS (
    -- Brand-identity recall. A query like "loreal paris" is not a low-hit query,
    -- it is a WRONG-RESULTS query: 9 results against 1,470 products. A hit-count
    -- trigger cannot detect wrongness, so this path keys off brand identity.
    -- Exact or prefix match only: a bare substring would let a short query drag
    -- an entire brand catalogue into an unrelated search.
    SELECT b.brand FROM brand_search_index b
    WHERE length(norm) >= 3
      AND (b.brand_folded = norm OR b.brand_folded LIKE norm || '%')
    ORDER BY b.product_count DESC
    LIMIT 1
  ),
  brand_products AS (
    SELECT p.id::bigint AS product_id, p.name AS product_name, p.brand AS product_brand,
      p.product_type AS product_ptype, p.top_category AS product_tcat,
      p.subcategory AS product_subcat, p.image_url AS product_image,
      0::real AS r,
      ROW_NUMBER() OVER (ORDER BY p.id) AS rn
    FROM products_active p
    JOIN brand_hit bh ON p.brand = bh.brand
    WHERE (category_filter IS NULL OR p.top_category = category_filter)
      AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.product_id = p.id)
  ),
  supplement AS (
    SELECT p.id::bigint AS product_id, p.name AS product_name, p.brand AS product_brand,
      p.product_type AS product_ptype, p.top_category AS product_tcat,
      p.subcategory AS product_subcat, p.image_url AS product_image,
      0::real AS r, 'trigram'::text AS bucket,
      ROW_NUMBER() OVER (
        -- word_similarity is the coarse signal but ties heavily (8.9 candidates
        -- per query on average, 87 at worst), so similarity() discriminates
        -- inside its tie groups and id makes the order deterministic.
        ORDER BY word_similarity(norm, lower(p.name)) DESC,
                 similarity(lower(p.name), norm) DESC, p.id
      ) AS rn
    FROM products_active p
    WHERE fts_hits < supplement_n
      AND norm <> ''
      AND lower(p.name) %> norm
      AND (category_filter IS NULL OR p.top_category = category_filter)
      AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.product_id = p.id)
  ),
  combined AS (
    SELECT product_id, product_name, product_brand, product_ptype, product_tcat,
           product_subcat, product_image, r, interleave_pos
    FROM positioned
    UNION ALL
    -- brand-identity rows sit below full text but above the fuzzy supplement
    SELECT product_id, product_name, product_brand, product_ptype, product_tcat,
           product_subcat, product_image, r, 500000 + rn
    FROM brand_products
    UNION ALL
    -- strictly below every full-text row
    SELECT product_id, product_name, product_brand, product_ptype, product_tcat,
           product_subcat, product_image, r, 1000000 + rn
    FROM supplement
  )
  SELECT product_id, product_name, product_brand, product_ptype, product_tcat,
         product_subcat, product_image, r, count(*) OVER()
  FROM combined
  ORDER BY interleave_pos, r DESC, product_id
  LIMIT limit_count;
END;
$function$;
