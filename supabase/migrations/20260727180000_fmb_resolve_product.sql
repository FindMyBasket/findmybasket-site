-- Text-first basket entry resolver, tier 1.
-- Brief v2 of 27 July 2026, as amended by the decision record of the same date.
--
-- Union of two retrievers, NOT a fallback chain. The apostrophe-brand cases
-- ("loreal revitalift") return a small number of poor full-text rows rather than
-- zero, so a "fall back when full text finds nothing" rule would never fire on
-- exactly the queries that need it. Each retriever covers the other's failure:
-- full text handles "loreal paris serum", which trigram ranks poorly; trigram
-- handles typos and "loreal revitalift", which full text misses almost entirely
-- (1 result live, against 95 in the catalogue).
--
-- RANKING (decision record section 3, amending brief v2 section 4.1a). v2
-- mandated ranking by similarity() and forbade word_similarity(). That was drawn
-- from a single hand-picked query and is withdrawn. Measured on the 300-query
-- harness, neither signal is adequate alone, for opposite reasons:
--   * similarity() is fine-grained but penalises long product names, because a
--     short query shares few trigrams with a 10-token name. Typo class: 72.0%
--     top 3.
--   * word_similarity() finds the best matching window, so it spots the right
--     product, but it ties an average of 8.9 candidates and up to 87. Inside a
--     tie group its ordering is close to arbitrary. Typo class: 74.7% top 3.
-- Adopted: word_similarity as the coarse signal, similarity to discriminate
-- within its tie groups, id last for determinism. 91.0% combined top 8.
--
-- RETRIEVAL stays on %>, which is both more selective and faster than % on this
-- data (18.6 ms against 47.9 ms measured), and is indexable by the existing
-- idx_products_name_trgm.
--
-- FUSION is reciprocal rank fusion, not a raw score blend. ts_rank and
-- similarity live on different scales, so summing them would let trigram swamp
-- full text and regress queries that work today. RRF is scale-free. Full text is
-- weighted above trigram for the same reason.
--
-- This function does NOT replace fmb_search_products. In particular
-- getFinderCount (lib/finder/taxonomy.ts) uses that RPC as a COUNTER and must
-- stay on it permanently: a union resolver returns far larger totals and would
-- silently inflate every finder chip.

CREATE OR REPLACE FUNCTION public.fmb_resolve_product(
  input_text      text,
  category_filter text DEFAULT NULL,
  limit_count     int  DEFAULT 8
)
RETURNS TABLE(
  id            bigint,
  name          text,
  brand         text,
  product_type  text,
  top_category  text,
  subcategory   text,
  image_url     text,
  score         real,
  trgm_sim      real,
  via_fts       boolean,
  via_trgm      boolean
)
LANGUAGE plpgsql
STABLE
AS $function$
#variable_conflict use_column
DECLARE
  norm         text;
  prefix_query text;
  tsq          tsquery;
  k_rrf  constant real := 60.0;   -- RRF damping; standard value
  w_fts  constant real := 1.0;    -- full text leads
  w_trgm constant real := 0.6;    -- trigram supports, never overrides
  cand_cap constant int := 200;   -- per-retriever candidate cap
BEGIN
  -- 1. Normalise: lowercase, fold accents, strip punctuation, collapse whitespace.
  -- translate() rather than unaccent(), which is not installed and is not
  -- IMMUTABLE. from/to are the same length, 35 characters.
  norm := lower(coalesce(input_text, ''));
  norm := translate(
    norm,
    'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūçñýÿšž',
    'aaaaaaaeeeeeiiiiiooooooouuuuucnyysz'
  );
  norm := regexp_replace(norm, '[^a-z0-9]+', ' ', 'g');
  norm := trim(regexp_replace(norm, '\s+', ' ', 'g'));
  IF norm = '' THEN RETURN; END IF;

  -- 2. Full-text prefix AND tsquery, same shape as fmb_search_products so the
  -- two are comparable side by side.
  SELECT string_agg(CASE WHEN length(t) >= 2 THEN t || ':*' ELSE t END, ' & ')
    INTO prefix_query
    FROM unnest(string_to_array(norm, ' ')) AS t;

  BEGIN
    tsq := to_tsquery('english', prefix_query);
  EXCEPTION WHEN OTHERS THEN
    tsq := NULL;
  END;

  RETURN QUERY
  WITH fts_raw AS (
    SELECT p.id AS pid, ts_rank(p.search_vector, tsq) AS r
    FROM products p
    WHERE tsq IS NOT NULL
      AND p.search_vector @@ tsq
      AND p.merged_into IS NULL
      AND p.parent_product_id IS NULL
      AND (category_filter IS NULL OR p.top_category = category_filter)
      -- products_active does NOT filter on in_stock, so the resolver applies its
      -- own predicate. A basket tool must not offer an unbuyable row.
      AND EXISTS (
        SELECT 1 FROM retailer_prices rp
        JOIN retailers r ON r.id = rp.retailer_id
        WHERE rp.product_id = p.id AND r.active AND rp.in_stock
      )
    ORDER BY ts_rank(p.search_vector, tsq) DESC, p.id
    LIMIT cand_cap
  ),
  fts AS (
    SELECT pid, row_number() OVER (ORDER BY r DESC, pid) AS rk FROM fts_raw
  ),
  trg_raw AS (
    SELECT p.id AS pid,
           word_similarity(norm, lower(p.name)) AS ws,
           similarity(lower(p.name), norm)      AS s
    FROM products p
    WHERE lower(p.name) %> norm          -- indexable by idx_products_name_trgm
      AND p.merged_into IS NULL
      AND p.parent_product_id IS NULL
      AND (category_filter IS NULL OR p.top_category = category_filter)
      AND EXISTS (
        SELECT 1 FROM retailer_prices rp
        JOIN retailers r ON r.id = rp.retailer_id
        WHERE rp.product_id = p.id AND r.active AND rp.in_stock
      )
    ORDER BY word_similarity(norm, lower(p.name)) DESC,
             similarity(lower(p.name), norm) DESC, p.id
    LIMIT cand_cap
  ),
  trg AS (
    -- word_similarity is the coarse signal: it correctly spots that the query
    -- matches a window inside a longer name, which whole-string similarity
    -- misses. But it ties heavily (measured: 8.9 candidates per query on
    -- average, worst case 87), so on its own the effective ordering is close to
    -- arbitrary. similarity() discriminates inside those tie groups. Coarse
    -- first, fine second, id last for determinism.
    SELECT pid, s, row_number() OVER (ORDER BY ws DESC, s DESC, pid) AS rk
    FROM trg_raw
  ),
  fused AS (
    SELECT
      COALESCE(f.pid, t.pid) AS pid,
      (COALESCE(w_fts  / (k_rrf + f.rk), 0)
     + COALESCE(w_trgm / (k_rrf + t.rk), 0))::real AS score,
      COALESCE(t.s, 0)::real AS trgm_sim,
      (f.pid IS NOT NULL)    AS via_fts,
      (t.pid IS NOT NULL)    AS via_trgm
    FROM fts f
    FULL OUTER JOIN trg t ON t.pid = f.pid
  )
  SELECT
    p.id::bigint, p.name, p.brand, p.product_type,
    p.top_category, p.subcategory, p.image_url,
    fu.score, fu.trgm_sim, fu.via_fts, fu.via_trgm
  FROM fused fu
  JOIN products p ON p.id = fu.pid
  -- product id as final tie-break: without it the disambiguation list reorders
  -- between renders on equal scores.
  ORDER BY fu.score DESC, p.id
  LIMIT limit_count;
END;
$function$;

COMMENT ON FUNCTION public.fmb_resolve_product IS
  'Text-first basket entry resolver. Unions a full-text prefix tsquery with a %> trigram retrieve ranked by whole-string similarity, fused by reciprocal rank fusion (full text weighted above trigram). Restricted to in-stock offers from active retailers, root products only. Deterministic: ties break on product id. Does NOT replace fmb_search_products.';
