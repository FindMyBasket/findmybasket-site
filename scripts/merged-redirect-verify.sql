-- Verification harness for the soft-merge redirect fix
-- (migrations 20260702120000 + 20260702120100). Read-only. Run against the target
-- DB AFTER deploying both migrations. Every column below has an explicit expected
-- value; any deviation is a failure.
--
-- What it proves:
--   A. match_chunk_lookups NEVER returns a soft-merged (dead) product id as a
--      candidate  -> dead_ids_returned = 0.
--   B. Every dead row's (name, brand) resolves to its KEEPER id in the RPC output
--      -> dead_rows_redirected_to_keeper = total_merged_rows. This is the "a
--      re-imported feed row matching a merged row's name links to the keeper" case.
--   C. No soft-merged row holds any retailer_price after reclaim
--      -> prices_on_merged_rows = 0 (the dead row never receives a price).

-- ── A + B: RPC candidate redirect (awin path) ────────────────────────────────
WITH merged AS (
  SELECT id, match_brand, merged_into, name, brand
  FROM products WHERE merged_into IS NOT NULL
),
resp AS (
  SELECT (e->>'id')::int AS ret_id, e->>'name' AS ret_name, e->>'brand' AS ret_brand
  FROM jsonb_array_elements(
    (match_chunk_lookups(
        NULL::integer,
        (SELECT array_agg(DISTINCT match_brand) FROM merged WHERE match_brand IS NOT NULL),
        ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[]
     ) -> 'products')
  ) e
)
SELECT
  'RPC redirect' AS check,
  (SELECT count(*) FROM merged)                                              AS total_merged_rows,
  (SELECT count(*) FROM resp r JOIN merged m ON r.ret_id = m.id)             AS dead_ids_returned_expect_0,
  (SELECT count(*) FROM merged m
     WHERE EXISTS (SELECT 1 FROM resp r
                   WHERE r.ret_name = m.name AND r.ret_brand = m.brand
                     AND r.ret_id = m.merged_into))                          AS dead_rows_redirected_to_keeper_expect_total;

-- ── C: reclaim invariant (all importers) ─────────────────────────────────────
SELECT
  'reclaim invariant' AS check,
  count(*) FILTER (WHERE rp.id IS NOT NULL)                                  AS prices_on_merged_rows_expect_0,
  count(DISTINCT d.id) FILTER (WHERE rp.id IS NOT NULL)                      AS merged_rows_with_price_expect_0
FROM products d
LEFT JOIN retailer_prices rp ON rp.product_id = d.id
WHERE d.merged_into IS NOT NULL;

-- ── Ongoing monitor: stranded prices (re-run any time; expect all zeros) ──────
WITH merged AS (SELECT id, merged_into, merged_at FROM products WHERE merged_into IS NOT NULL)
SELECT
  'stranded monitor' AS check,
  count(*) FILTER (WHERE rp.id IS NOT NULL)                                  AS stranded_prices_expect_0,
  count(DISTINCT m.id) FILTER (WHERE rp.id IS NOT NULL)                      AS dead_rows_with_price_expect_0,
  count(DISTINCT m.merged_into) FILTER (WHERE rp.id IS NOT NULL)             AS keepers_affected_expect_0
FROM merged m
LEFT JOIN retailer_prices rp ON rp.product_id = m.id;
