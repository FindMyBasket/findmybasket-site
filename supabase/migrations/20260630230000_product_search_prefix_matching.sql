-- Product Finder: autocomplete-style prefix matching for fmb_search_products.
-- Replaces websearch_to_tsquery (whole-lexeme) so a user typing "moistur" matches
-- "moisturiser" mid-type. EVERY token (>= 2 chars) is prefix-matched with :*, not
-- just the last one: a preceding partial like "niacin" is not itself a stored
-- lexeme (the english stem is "niacinamid"), so last-token-only prefixing made
-- "niacin ord" return nothing. 1-char tokens stay literal so "vitamin c" does not
-- explode into "c:*" (every word starting with c). Non-word chars are stripped so
-- user punctuation can't break to_tsquery; the build is still wrapped in an
-- exception guard (to_tsquery can throw, and stopword-only input empties it).
--
-- Trade vs websearch_to_tsquery: we forgo quoted-phrase and -negation syntax,
-- which is the right default for a search-as-you-type bar. OUT columns are
-- unchanged from the prior version so CREATE OR REPLACE needs no DROP.
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
  cleaned_query text;
  prefix_query text;
BEGIN
  IF query_lower IS NULL OR query_lower = '' THEN
    RETURN;
  END IF;

  -- Keep only word chars + spaces, collapse whitespace.
  cleaned_query := regexp_replace(query_lower, '[^a-z0-9\s]', ' ', 'g');
  cleaned_query := trim(regexp_replace(cleaned_query, '\s+', ' ', 'g'));

  IF cleaned_query = '' THEN
    RETURN;
  END IF;

  -- Build "tok:* & tok:* & ..."; tokens shorter than 2 chars stay literal.
  SELECT string_agg(
           CASE WHEN length(t) >= 2 THEN t || ':*' ELSE t END,
           ' & '
         )
  INTO prefix_query
  FROM unnest(string_to_array(cleaned_query, ' ')) AS t;

  BEGIN
    ts_query := to_tsquery('english', prefix_query);
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;

  IF ts_query IS NULL OR ts_query = ''::tsquery THEN
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
    -- Then full-text rank.
    ts_rank(p.search_vector, ts_query) DESC,
    p.id
  LIMIT limit_count;
END;
$$;