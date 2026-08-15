-- APPLIED to production 2026-08-15; committed as the record. THE FULL PATCHED FUNCTION.
--
-- Adds stale_in_stock_den and cross_product_candidate_den, so no metric renders as a bare
-- number. Re-run the same day produced: stale 15,433 of 110,504; cross-product 321 outliers
-- and 128 identical-name pairs over 84,213 candidate products.
--
-- HOW THIS WAS PRODUCED, AND IT SHOULD BE THE DEFAULT. The live definition was fetched with
-- pg_get_functiondef, patched programmatically, and re-applied. IT WAS NEVER RETYPED.
-- Retyping a 200-line function to change four lines invites transcription drift in the 196
-- that were not meant to change, and nothing would report it. Same property the
-- products_active capture relied on (20260813200000): an identical rendering is PROOF of
-- fidelity rather than a promise of it.
--
-- THE NINE DEFINITIONS STILL LIVE ONLY HERE. That is why the denominators were added to
-- this function rather than to a companion that fills two columns -- a second writer would
-- put two of the eleven numbers somewhere else.

CREATE OR REPLACE FUNCTION public.fmb_quality_snapshot_write(p_week_start date DEFAULT (date_trunc('week'::text, now()))::date, p_threshold numeric DEFAULT 0.50)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_depth_num int; v_depth_den int;
  v_susp int; v_susp_den int;
  v_ean_num int; v_ean_den int;
  v_amb int; v_amb_den int;
  v_sole int; v_sole_den int;
  v_nooffer int; v_nooffer_den int;
  v_stale int; v_stale_den int;
  v_cross_den int;
  v_pack int; v_pack_testable int; v_pack_den int;
  v_cross int; v_ident int;
BEGIN
  -- 1. COMPARISON DEPTH. Canonical query, docs/canonical-comparison-depth.md.
  --    Retailers counted over retailer_prices_live, NEVER over retailer_prices:
  --    the active filter lives inside the view, and counting over the bare table
  --    lets a departed retailer's row satisfy the >= 2 threshold.
  SELECT count(*) INTO v_depth_num FROM (
    SELECT p.id FROM products p JOIN retailer_prices_live rl ON rl.product_id = p.id
     WHERE p.merged_into IS NULL AND p.parent_product_id IS NULL AND rl.in_stock
     GROUP BY p.id HAVING count(DISTINCT rl.retailer_id) >= 2) x;
  SELECT count(*) INTO v_depth_den FROM (
    SELECT p.id FROM products p JOIN retailer_prices_live rl ON rl.product_id = p.id
     WHERE p.merged_into IS NULL AND p.parent_product_id IS NULL AND rl.in_stock
     GROUP BY p.id) y;

  -- 2. SUSPECT PRICE. A row priced under p_threshold of the MEDIAN OF ITS PEERS on the
  --    same product. Denominator is rows that HAVE a peer -- a single-retailer row can
  --    never be suspect and must not sit in the denominator.
  WITH peer AS (
    SELECT rl.id, rl.price,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY rl2.price) AS peer_median
      FROM retailer_prices_live rl
      JOIN retailer_prices_live rl2
        ON rl2.product_id = rl.product_id AND rl2.id <> rl.id AND rl2.in_stock
     WHERE rl.in_stock GROUP BY rl.id, rl.price)
  SELECT count(*) FILTER (WHERE price < p_threshold * peer_median), count(*)
    INTO v_susp, v_susp_den FROM peer;

  -- 3. EAN COVERAGE over live in-stock rows.
  SELECT count(*) FILTER (WHERE ean_normalised IS NOT NULL), count(*)
    INTO v_ean_num, v_ean_den FROM retailer_prices_live WHERE in_stock;

  -- 4. AMBIGUOUS BARCODES: one code, more than one unmerged product. This is the
  --    population tier 1 refuses to link, every night. Item 96.
  WITH amb AS (
    SELECT rp.ean_normalised AS code, count(DISTINCT rp.product_id) AS n_prod
      FROM retailer_prices_live rp
      JOIN products p ON p.id = rp.product_id AND p.merged_into IS NULL
     WHERE rp.ean_normalised IS NOT NULL GROUP BY rp.ean_normalised)
  SELECT count(*) FILTER (WHERE n_prod > 1), count(*) INTO v_amb, v_amb_den FROM amb;

  -- 5. SOLE-SUPPLIER SHARE over ean_product_index, which already encodes active+enabled.
  --    NOTE the deliberate predicate difference from metric 4: that one is active-only
  --    via the view, this one is active AND enabled via the index. Same-sounding numbers
  --    with different retailer predicates is precisely what this table exists to stop.
  WITH sole AS (
    SELECT e.ean AS code, count(DISTINCT rp.retailer_id) AS n_ret
      FROM ean_product_index e
      JOIN retailer_prices rp ON rp.ean_normalised = e.ean
      JOIN retailers r ON r.id = rp.retailer_id AND r.active
      LEFT JOIN retailer_import_config c ON c.retailer_id = rp.retailer_id
     WHERE coalesce(c.enabled, false) GROUP BY e.ean)
  SELECT count(*) FILTER (WHERE n_ret = 1), count(*) INTO v_sole, v_sole_den FROM sole;

  -- 6. PRODUCTS WITH NO IN-STOCK OFFER. products_active does NOT filter on in_stock, so
  --    a product can hold a page with nothing buyable on it. Item 76.
  SELECT count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM retailer_prices_live rl WHERE rl.product_id = pa.id AND rl.in_stock)),
         count(*)
    INTO v_nooffer, v_nooffer_den FROM products_active pa;

  -- 7. STALE IN-STOCK ROWS. BARE TABLE BY DESIGN, and measured against each retailer's
  --    OWN last import rather than a fixed day bucket -- YesStyle's absence threshold is
  --    9999, so fixed buckets are meaningless for it. Item 53.
  SELECT count(*) FILTER (WHERE rp.last_updated < c.last_imported_at - interval '3 hours'),
         count(*)
    INTO v_stale, v_stale_den
    FROM retailer_prices rp
    JOIN retailers r ON r.id = rp.retailer_id AND r.active
    JOIN retailer_import_config c ON c.retailer_id = rp.retailer_id AND c.enabled
   WHERE rp.in_stock;

  -- 8. PACK MISMATCH. Testable only where BOTH the product name and the row's URL state a
  --    count -- about 2.5% of rows. v_pack_testable is stored so an empty result reads as
  --    "nothing found in the tested slice", never as "nothing wrong".
  WITH base AS (
    SELECT rl.id, rl.product_id, rl.price,
           regexp_replace(lower(p.name), '[-_+]', ' ', 'g') AS pn,
           regexp_replace(lower(replace(replace(coalesce(substring(rl.url FROM 'ued=(.*)$'), rl.url),'%2F','/'),'%20',' ')), '[-_+]', ' ', 'g') AS un
      FROM retailer_prices_live rl
      JOIN products p ON p.id = rl.product_id AND p.merged_into IS NULL
     WHERE rl.in_stock AND rl.url IS NOT NULL),
  pk AS (
    SELECT b.*,
      coalesce((regexp_match(pn,'(\d+)\s*[x*]\s*\d+\s*(?:g|ml|mg)\y'))[1],
               (regexp_match(pn,'\y(\d+)\s*(?:pk|pack|packs|pcs|pc|ea|sheets|sheet|pads|pad|patches|patch|masks|mask|count|ct)\y'))[1],
               (regexp_match(pn,'\y(\d+)s\y'))[1])::int AS p_pack,
      coalesce((regexp_match(un,'(\d+)\s*[x*]\s*\d+\s*(?:g|ml|mg)\y'))[1],
               (regexp_match(un,'\y(\d+)\s*(?:pk|pack|packs|pcs|pc|ea|sheets|sheet|pads|pad|patches|patch|masks|mask|count|ct)\y'))[1],
               (regexp_match(un,'\y(\d+)s\y'))[1])::int AS u_pack
      FROM base b),
  mins AS (SELECT product_id, min(price) mp FROM retailer_prices_live WHERE in_stock GROUP BY 1)
  SELECT count(*) FILTER (WHERE p_pack IS NOT NULL AND u_pack IS NOT NULL AND u_pack < p_pack AND pk.price <= mins.mp),
         count(*) FILTER (WHERE p_pack IS NOT NULL AND u_pack IS NOT NULL),
         count(*)
    INTO v_pack, v_pack_testable, v_pack_den
    FROM pk JOIN mins ON mins.product_id = pk.product_id;

  -- 9. CROSS-PRODUCT PRICE OUTLIERS. Same brand, names one NUMERIC or PACK token apart,
  --    cheaper best under half the dearer. The token restriction is load-bearing: item 102
  --    measured one-token differences as dominated by shade names, and restricting to
  --    numeric/pack cut 902 pairs to 319 while keeping the founding case.
  --    length(t) > 1, NOT > 2 -- at > 2 the token "24" is dropped and the founding pair
  --    becomes token-identical and invisible to this join.
  WITH prod AS (
    SELECT p.id, regexp_replace(lower(coalesce(p.brand,'')),'[^a-z0-9]+','','g') AS bk,
      (SELECT min(rl.price) FROM retailer_prices_live rl WHERE rl.product_id = p.id AND rl.in_stock) AS best,
      (SELECT array_agg(DISTINCT t ORDER BY t) FROM unnest(regexp_split_to_array(
         regexp_replace(lower(p.name),'[^a-z0-9]+',' ','g'),'\s+')) t WHERE length(t) > 1) AS toks
      FROM products p
     WHERE p.merged_into IS NULL AND p.parent_product_id IS NULL
       AND EXISTS (SELECT 1 FROM retailer_prices_live rl WHERE rl.product_id = p.id AND rl.in_stock)),
  t AS (SELECT * FROM prod WHERE toks IS NOT NULL AND cardinality(toks) BETWEEN 3 AND 14 AND best IS NOT NULL AND bk <> ''),
  dropone AS (
    SELECT t.id, t.bk, t.best, x.tok AS dropped,
           (SELECT array_agg(y ORDER BY y) FROM unnest(t.toks) y WHERE y <> x.tok) AS reduced
      FROM t, unnest(t.toks) x(tok))
  SELECT count(*) FILTER (WHERE d.dropped ~ '^\d' OR d.dropped ~ '(pk|pack|pcs|pc|ea|sheets|pads|patches|count|ct)$')
    INTO v_cross
    FROM dropone d JOIN t t2 ON t2.bk = d.bk AND t2.toks = d.reduced AND t2.id <> d.id
   WHERE least(d.best, t2.best) < 0.5 * greatest(d.best, t2.best);

  -- 9b. Identical-name pairs: same brand, same token set, >2x price gap. Higher signal
  --     than the one-token bucket and a DIFFERENT population -- it does not contain the
  --     founding case. Stored separately rather than summed.
  WITH prod AS (
    SELECT p.id, regexp_replace(lower(coalesce(p.brand,'')),'[^a-z0-9]+','','g') AS bk,
      (SELECT min(rl.price) FROM retailer_prices_live rl WHERE rl.product_id = p.id AND rl.in_stock) AS best,
      (SELECT array_agg(DISTINCT t ORDER BY t) FROM unnest(regexp_split_to_array(
         regexp_replace(lower(p.name),'[^a-z0-9]+',' ','g'),'\s+')) t WHERE length(t) > 1) AS toks
      FROM products p
     WHERE p.merged_into IS NULL AND p.parent_product_id IS NULL
       AND EXISTS (SELECT 1 FROM retailer_prices_live rl WHERE rl.product_id = p.id AND rl.in_stock)),
  t AS (SELECT * FROM prod WHERE toks IS NOT NULL AND cardinality(toks) BETWEEN 3 AND 14 AND best IS NOT NULL AND bk <> '')
  SELECT count(*), (SELECT count(*) FROM t) INTO v_ident, v_cross_den
    FROM t a JOIN t b ON b.bk = a.bk AND b.toks = a.toks AND b.id > a.id
   WHERE least(a.best, b.best) < 0.5 * greatest(a.best, b.best);

  INSERT INTO public.metrics_quality_weekly AS m (
    week_start, comparison_depth_pct, comparison_depth_num, comparison_depth_den,
    suspect_price_count, suspect_price_den, suspect_price_threshold,
    ean_coverage_pct, ean_coverage_num, ean_coverage_den,
    ambiguous_ean_groups, ambiguous_ean_den,
    sole_supplier_share_pct, sole_supplier_num, sole_supplier_den,
    no_in_stock_offer_count, no_in_stock_offer_den,
    stale_in_stock_rows,
    pack_mismatch_suspects, pack_mismatch_testable, pack_mismatch_den,
    cross_product_price_outliers, cross_product_identical_pairs,
    stale_in_stock_den, cross_product_candidate_den, updated_at)
  VALUES (
    p_week_start, round(100.0*v_depth_num/nullif(v_depth_den,0),2), v_depth_num, v_depth_den,
    v_susp, v_susp_den, p_threshold,
    round(100.0*v_ean_num/nullif(v_ean_den,0),2), v_ean_num, v_ean_den,
    v_amb, v_amb_den,
    round(100.0*v_sole/nullif(v_sole_den,0),2), v_sole, v_sole_den,
    v_nooffer, v_nooffer_den,
    v_stale,
    v_pack, v_pack_testable, v_pack_den,
    v_cross, v_ident, v_stale_den, v_cross_den, now())
  ON CONFLICT (week_start) DO UPDATE SET
    comparison_depth_pct = EXCLUDED.comparison_depth_pct,
    comparison_depth_num = EXCLUDED.comparison_depth_num,
    comparison_depth_den = EXCLUDED.comparison_depth_den,
    suspect_price_count = EXCLUDED.suspect_price_count,
    suspect_price_den = EXCLUDED.suspect_price_den,
    suspect_price_threshold = EXCLUDED.suspect_price_threshold,
    ean_coverage_pct = EXCLUDED.ean_coverage_pct,
    ean_coverage_num = EXCLUDED.ean_coverage_num,
    ean_coverage_den = EXCLUDED.ean_coverage_den,
    ambiguous_ean_groups = EXCLUDED.ambiguous_ean_groups,
    ambiguous_ean_den = EXCLUDED.ambiguous_ean_den,
    sole_supplier_share_pct = EXCLUDED.sole_supplier_share_pct,
    sole_supplier_num = EXCLUDED.sole_supplier_num,
    sole_supplier_den = EXCLUDED.sole_supplier_den,
    no_in_stock_offer_count = EXCLUDED.no_in_stock_offer_count,
    no_in_stock_offer_den = EXCLUDED.no_in_stock_offer_den,
    stale_in_stock_rows = EXCLUDED.stale_in_stock_rows,
    pack_mismatch_suspects = EXCLUDED.pack_mismatch_suspects,
    pack_mismatch_testable = EXCLUDED.pack_mismatch_testable,
    pack_mismatch_den = EXCLUDED.pack_mismatch_den,
    cross_product_price_outliers = EXCLUDED.cross_product_price_outliers,
    cross_product_identical_pairs = EXCLUDED.cross_product_identical_pairs,
    stale_in_stock_den = EXCLUDED.stale_in_stock_den,
    cross_product_candidate_den = EXCLUDED.cross_product_candidate_den,
    updated_at = now();

  RETURN jsonb_build_object(
    'week_start', p_week_start, 'threshold', p_threshold,
    'comparison_depth_pct', round(100.0*v_depth_num/nullif(v_depth_den,0),2),
    'suspect_price_count', v_susp, 'ean_coverage_pct', round(100.0*v_ean_num/nullif(v_ean_den,0),2),
    'ambiguous_ean_groups', v_amb, 'sole_supplier_share_pct', round(100.0*v_sole/nullif(v_sole_den,0),2),
    'no_in_stock_offer_count', v_nooffer, 'stale_in_stock_rows', v_stale,
    'pack_mismatch_suspects', v_pack, 'pack_mismatch_testable', v_pack_testable,
    'cross_product_price_outliers', v_cross, 'cross_product_identical_pairs', v_ident,
    'stale_in_stock_den', v_stale_den, 'cross_product_candidate_den', v_cross_den);
END $function$

