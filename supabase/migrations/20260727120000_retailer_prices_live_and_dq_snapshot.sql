-- Superdrug r12 retirement, 27 July 2026.
-- Applied to prod via the management API on the date above; this file is the record.
--
-- Context: r12's Rakuten feed stopped on 19 July 2026 and the retailer was set
-- inactive, but its 29,525 price rows stayed in_stock = true. Any metric counting
-- from retailer_prices on in_stock alone therefore kept treating a departed
-- retailer as live, overstating comparison depth by 35.7% and the savings pool by
-- roughly 2.6x. The rows were marked out of stock (data change, not in this file)
-- and the two objects below close the hole structurally.
--
-- security_invoker is NOT optional: retailer_prices is reachable through PostgREST,
-- and without it the view would run with owner rights and bypass RLS.

CREATE VIEW public.retailer_prices_live WITH (security_invoker = true) AS
SELECT rp.* FROM retailer_prices rp
JOIN retailers r ON r.id = rp.retailer_id AND r.active;

-- dq_snapshot: only the four comparison/savings metrics are repointed at the view.
-- Everything else is verbatim from prod. Front-end call sites stay on
-- getActiveRetailerIds() (already correct); the per-retailer diagnostic rollups,
-- capture_catalog_health, and every full-table consumer (import/write path, merge
-- and reconciliation, matching indexes, absence handling, operational monitoring,
-- curated-edit selection) are deliberately untouched.

CREATE OR REPLACE FUNCTION public.dq_snapshot()
 RETURNS TABLE(metric_category text, metric_name text, metric_value jsonb)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY

  SELECT 'catalogue'::TEXT, 'total_products'::TEXT, to_jsonb(COUNT(*)) FROM products
  UNION ALL SELECT 'catalogue', 'total_brands', to_jsonb(COUNT(DISTINCT brand)) FROM products WHERE brand IS NOT NULL AND brand != ''
  UNION ALL SELECT 'catalogue', 'in_stock_rows', to_jsonb(COUNT(*)) FROM retailer_prices WHERE in_stock = true AND product_id IS NOT NULL
  UNION ALL SELECT 'catalogue', 'detached_rows', to_jsonb(COUNT(*)) FROM retailer_prices WHERE product_id IS NULL
  -- MIGRATED 2026-07-27 (Superdrug r12 retirement): the four comparison/savings
  -- metrics below read retailer_prices_live, so an inactive retailer's offers can
  -- never inflate comparison depth or savings again. The diagnostic rollups further
  -- down deliberately stay on retailer_prices: seeing a departed retailer's rows in
  -- identifier coverage, URL health, freshness and canonical-size is correct for a
  -- diagnostic. in_stock_rows and detached_rows above are catalogue-integrity
  -- counts, also deliberately left on the base table.
  UNION ALL SELECT 'catalogue', 'multi_retailer_products', to_jsonb(COUNT(*)) FROM (SELECT product_id FROM retailer_prices_live WHERE in_stock = true AND product_id IS NOT NULL GROUP BY product_id HAVING COUNT(DISTINCT retailer_id) >= 2) m
  UNION ALL SELECT 'catalogue', 'avg_saving_pct', to_jsonb(ROUND(AVG((max_p - min_p) / NULLIF(max_p, 0) * 100)::numeric, 2)) FROM (SELECT MAX(price) AS max_p, MIN(price) AS min_p FROM retailer_prices_live WHERE in_stock = true AND product_id IS NOT NULL GROUP BY product_id HAVING COUNT(DISTINCT retailer_id) >= 2) s
  UNION ALL SELECT 'catalogue', 'total_savings_pool', to_jsonb(ROUND(SUM(max_p - min_p)::numeric, 2)) FROM (SELECT MAX(price) AS max_p, MIN(price) AS min_p FROM retailer_prices_live WHERE in_stock = true AND product_id IS NOT NULL GROUP BY product_id HAVING COUNT(DISTINCT retailer_id) >= 2) s
  UNION ALL SELECT 'catalogue', 'biggest_saving', to_jsonb(MAX(max_p - min_p)) FROM (SELECT MAX(price) AS max_p, MIN(price) AS min_p FROM retailer_prices_live WHERE in_stock = true AND product_id IS NOT NULL GROUP BY product_id HAVING COUNT(DISTINCT retailer_id) >= 2) s

  UNION ALL SELECT 'identifier_coverage', 'per_retailer', jsonb_object_agg(retailer, jsonb_build_object('in_stock', total, 'with_ean', with_ean, 'ean_pct', ean_pct, 'with_mpn', with_mpn, 'mpn_pct', mpn_pct))
  FROM (SELECT r.name AS retailer, COUNT(*) AS total, COUNT(*) FILTER (WHERE rp.ean_normalised IS NOT NULL AND rp.ean_normalised != '') AS with_ean, ROUND(100.0 * COUNT(*) FILTER (WHERE rp.ean_normalised IS NOT NULL AND rp.ean_normalised != '') / NULLIF(COUNT(*), 0), 1) AS ean_pct, COUNT(*) FILTER (WHERE rp.mpn_normalised IS NOT NULL AND rp.mpn_normalised != '') AS with_mpn, ROUND(100.0 * COUNT(*) FILTER (WHERE rp.mpn_normalised IS NOT NULL AND rp.mpn_normalised != '') / NULLIF(COUNT(*), 0), 1) AS mpn_pct FROM retailer_prices rp JOIN retailers r ON r.id = rp.retailer_id WHERE rp.in_stock = true AND rp.product_id IS NOT NULL GROUP BY r.name) per_retailer

  UNION ALL SELECT 'duplicates', 'layer1_within_retailer_identifier_dupes', COALESCE(jsonb_object_agg(retailer, jsonb_build_object('duplicate_groups', dup_groups, 'extra_rows_to_merge', extras)), '{}'::jsonb)
  FROM (SELECT r.name AS retailer, COUNT(*) AS dup_groups, SUM(group_size - 1) AS extras FROM (SELECT rp.retailer_id, rp.ean_normalised AS ident, COUNT(*) AS group_size FROM retailer_prices rp WHERE rp.in_stock = true AND rp.product_id IS NOT NULL AND rp.ean_normalised IS NOT NULL AND rp.ean_normalised != '' GROUP BY rp.retailer_id, rp.ean_normalised HAVING COUNT(*) > 1 UNION ALL SELECT rp.retailer_id, rp.mpn_normalised AS ident, COUNT(*) AS group_size FROM retailer_prices rp WHERE rp.in_stock = true AND rp.product_id IS NOT NULL AND rp.mpn_normalised IS NOT NULL AND rp.mpn_normalised != '' GROUP BY rp.retailer_id, rp.mpn_normalised HAVING COUNT(*) > 1) dup_pairs JOIN retailers r ON r.id = dup_pairs.retailer_id GROUP BY r.name) ident_dupes

  UNION ALL SELECT 'duplicates', 'layer2_text_match', jsonb_object_agg(confidence_tier, jsonb_build_object('duplicate_groups', dup_groups, 'extra_products', extras))
  FROM (WITH dg AS (SELECT LOWER(TRIM(p.brand)) AS brand_norm, LOWER(TRIM(p.canonical_size)) AS size_norm, REGEXP_REPLACE(LOWER(p.name), '[^a-z0-9]+', '', 'g') AS name_full_norm, p.id, (p.name LIKE '%...' OR p.name LIKE '%…') AS is_truncated FROM products p WHERE p.brand IS NOT NULL AND p.brand != '' AND p.canonical_size IS NOT NULL AND p.canonical_size != '' AND EXISTS (SELECT 1 FROM retailer_prices rp WHERE rp.product_id = p.id AND rp.in_stock = true)), grps AS (SELECT brand_norm, size_norm, name_full_norm, COUNT(*) AS group_size, BOOL_OR(is_truncated) AS has_truncated FROM dg GROUP BY brand_norm, size_norm, name_full_norm HAVING COUNT(*) > 1) SELECT CASE WHEN has_truncated THEN 'review_queue_truncated' ELSE 'auto_merge_safe' END AS confidence_tier, COUNT(*) AS dup_groups, SUM(group_size - 1) AS extras FROM grps GROUP BY confidence_tier) layer2

  UNION ALL SELECT 'url_health_sql_signals', 'per_retailer', jsonb_object_agg(retailer, jsonb_build_object('in_stock', total, 'no_url', no_url, 'garbage_chars', garbage_chars, 'stylevana_no_id_suffix', stylevana_no_id_suffix, 'stylevana_no_id_pct', stylevana_no_id_pct))
  FROM (SELECT r.name AS retailer, COUNT(*) AS total, COUNT(*) FILTER (WHERE rp.url IS NULL OR rp.url = '') AS no_url, COUNT(*) FILTER (WHERE rp.url ~ '%09|%00|%0A') AS garbage_chars, COUNT(*) FILTER (WHERE rp.retailer_id = 11 AND rp.url !~ '\d{5,}\.html') AS stylevana_no_id_suffix, ROUND(100.0 * COUNT(*) FILTER (WHERE rp.retailer_id = 11 AND rp.url !~ '\d{5,}\.html') / NULLIF(COUNT(*) FILTER (WHERE rp.retailer_id = 11), 0), 1) AS stylevana_no_id_pct FROM retailer_prices rp JOIN retailers r ON r.id = rp.retailer_id WHERE rp.in_stock = true AND rp.product_id IS NOT NULL GROUP BY r.id, r.name) per_retailer

  UNION ALL SELECT 'canonical_size_health', 'totals', jsonb_object_agg(health_status, product_count)
  FROM (SELECT CASE WHEN p.canonical_size IS NULL OR p.canonical_size = '' THEN 'no_canonical_size' WHEN p.name IS NULL OR p.name = '' THEN 'no_name' WHEN (REGEXP_MATCH(LOWER(p.name), '(\d+\.?\d*)\s*(ml|g|kg|l|oz)'))[1] IS NULL THEN 'name_has_no_size' WHEN LOWER(REPLACE(p.canonical_size, ' ', '')) = (REGEXP_MATCH(LOWER(p.name), '(\d+\.?\d*)\s*(ml|g|kg|l|oz)'))[1] || (REGEXP_MATCH(LOWER(p.name), '(\d+\.?\d*)\s*(ml|g|kg|l|oz)'))[2] THEN 'agrees' WHEN p.canonical_size ~ '^(15|20|30|50)\d{3,}(ml|g)$' THEN 'spf_concat_bug' WHEN p.name ~ '\d+\s*(ml|g)\s*,\s*\d+\s*(ml|g)' THEN 'multipack_format' WHEN p.name ~ '\d+\.\d+\s*(ml|g)' THEN 'decimal_in_name' ELSE 'other_mismatch' END AS health_status, COUNT(*) AS product_count FROM products p WHERE EXISTS (SELECT 1 FROM retailer_prices rp WHERE rp.product_id = p.id AND rp.in_stock = true) GROUP BY health_status) cs_health

  UNION ALL SELECT 'canonical_size_health', 'missing_per_retailer', jsonb_object_agg(retailer, missing)
  FROM (SELECT r.name AS retailer, COUNT(*) AS missing FROM retailer_prices rp JOIN retailers r ON r.id = rp.retailer_id JOIN products p ON p.id = rp.product_id WHERE rp.in_stock = true AND (p.canonical_size IS NULL OR p.canonical_size = '') GROUP BY r.id, r.name) per_r

  UNION ALL SELECT 'price_freshness', 'per_retailer', jsonb_object_agg(retailer, jsonb_build_object('total', total, 'oldest_update', oldest_update, 'newest_update', newest_update, 'stale_over_7d', stale_over_7d, 'stale_over_14d', stale_over_14d, 'stale_over_30d', stale_over_30d))
  FROM (SELECT r.name AS retailer, COUNT(*) AS total, MIN(rp.last_updated) AS oldest_update, MAX(rp.last_updated) AS newest_update, COUNT(*) FILTER (WHERE rp.last_updated < NOW() - INTERVAL '7 days') AS stale_over_7d, COUNT(*) FILTER (WHERE rp.last_updated < NOW() - INTERVAL '14 days') AS stale_over_14d, COUNT(*) FILTER (WHERE rp.last_updated < NOW() - INTERVAL '30 days') AS stale_over_30d FROM retailer_prices rp JOIN retailers r ON r.id = rp.retailer_id WHERE rp.in_stock = true AND rp.product_id IS NOT NULL GROUP BY r.id, r.name) freshness;

END;
$function$
;
