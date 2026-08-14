-- APPLIED to production 2026-08-14 via MCP apply_migration. Committed as the record.
-- Verified after apply: 4 in-stock rows, best £10.52 (Stylevana), 3 distinct sellers,
-- 126 merged_into 81755 and out of products_active, 91868 repointed to 81755, zero
-- chain children, zero orphan prices, queue row repointed, merge logged, snapshot 4 rows.
--
-- Merge product 126 into 81755 (COSRX Full Fit Propolis Light
-- Ampoule 30ml), and repoint 91868 in the same transaction.
--
-- WHY THE MERGE IS SAFE, established externally because our data could not settle it:
-- "NEW" is REPACKAGING, NOT REFORMULATION — a retailer describes it as the "new look of
-- the best selling ampoule", an "upgraded version… which increased the quantity with
-- minimal design but kept the price same", and the ingredient list is identical across
-- every listing found. 8809598450820 is independently corroborated as the manufacturer
-- code on a third-party listing.
--
-- WHY 81755 IS THE KEEPER, NOT 126 (the lower id):
--   * it carries the MANUFACTURER barcode 8809598450820 — Korean GS1 prefix 880 — and
--     three independent retailers agree on it;
--   * 126's 648722973372 is a 12-digit reseller code supplied by one retailer. Stylevana
--     carries 967 such codes against YesStyle's 5 and Atelier de Glow's 0;
--   * amazon_asin_map already resolves ASIN B07ZGJQZ8G to 81755 via 8809598450820 —
--     an independent barcode-led agreement that 81755 is the canonical row.
--
-- THE CHAIN IS THE TRAP. Product 91868 is ALREADY merged into 126. fmb_soft_merge_group
-- does not repoint children, so merging 126 into 81755 alone leaves 91868 -> 126 -> 81755,
-- a two-hop chain, and item 52 records that the merge functions mishandle exactly this.
-- 91868 is repointed FIRST, in the same transaction.

BEGIN;

-- 1. SNAPSHOT (rollback), covering every row this touches.
CREATE TABLE IF NOT EXISTS fmb_merge_126_snapshot_20260814 AS
SELECT 'product'::text AS kind, id::text AS ref,
       jsonb_build_object('merged_into', merged_into, 'merged_at', merged_at) AS before
  FROM products WHERE id IN (126, 91868)
UNION ALL
SELECT 'retailer_price', id::text,
       jsonb_build_object('product_id', product_id) FROM retailer_prices WHERE product_id = 126
UNION ALL
SELECT 'url_health_queue', product_id::text,
       jsonb_build_object('product_id', product_id) FROM stylevana_url_health_queue WHERE product_id = 126;

-- 2. REPOINT THE CHILD FIRST. Guarded on its current parent so it cannot repoint
--    something that has moved since this was written.
UPDATE products SET merged_into = 81755
 WHERE id = 91868 AND merged_into = 126;

-- 3. THE MERGE. Uses the shipped function so behaviour matches every previous merge:
--    it dedupes per retailer, moves surviving prices, moves price_history, writes
--    product_merge_log, sets merged_into + merged_at, and asserts no orphans.
--    NOTHING IS DEDUPED HERE: 126 has only a Stylevana row and 81755 has none, so no
--    retailer appears twice and no price row is deleted.
SELECT public.fmb_soft_merge_group(
  81755,
  ARRAY[126],
  'NEW is repackaging not reformulation (external check: identical INCI, "new look", price unchanged). Keeper carries manufacturer EAN 8809598450820; 126 carried reseller code 648722973372. Work-list item 104.'
);

-- 4. REPOINT THE QUEUE ROW. fmb_soft_merge_group handles retailer_prices and
--    price_history only; stylevana_url_health_queue is not in its scope and would be
--    left pointing at a merged product.
UPDATE stylevana_url_health_queue SET product_id = 81755 WHERE product_id = 126;

-- 5. VERIFY.
DO $$
DECLARE n_rp int; best numeric; n_child int; n_orphan int; n_queue int;
BEGIN
  SELECT count(*), min(rp.price) INTO n_rp, best
    FROM retailer_prices rp JOIN retailers r ON r.id = rp.retailer_id
   WHERE rp.product_id = 81755 AND r.active AND rp.in_stock;
  IF n_rp <> 4    THEN RAISE EXCEPTION '81755 has % in-stock rows, expected 4', n_rp; END IF;
  IF best <> 10.52 THEN RAISE EXCEPTION '81755 best price is %, expected 10.52', best; END IF;

  IF (SELECT merged_into FROM products WHERE id = 126) <> 81755 THEN
    RAISE EXCEPTION '126 is not merged into 81755'; END IF;

  -- NO CHAIN: every descendant must point at the keeper directly.
  SELECT count(*) INTO n_child FROM products WHERE merged_into = 126;
  IF n_child <> 0 THEN RAISE EXCEPTION '% products still point at 126 - chain not resolved', n_child; END IF;
  IF (SELECT merged_into FROM products WHERE id = 91868) <> 81755 THEN
    RAISE EXCEPTION '91868 was not repointed to 81755'; END IF;

  SELECT count(*) INTO n_orphan FROM retailer_prices WHERE product_id = 126;
  IF n_orphan <> 0 THEN RAISE EXCEPTION '% price rows still on 126', n_orphan; END IF;

  SELECT count(*) INTO n_queue FROM stylevana_url_health_queue WHERE product_id = 126;
  IF n_queue <> 0 THEN RAISE EXCEPTION '% queue rows still on 126', n_queue; END IF;

  -- amazon_asin_map already pointed at the keeper; assert it was not disturbed.
  IF (SELECT count(*) FROM amazon_asin_map WHERE product_id = 81755) <> 1 THEN
    RAISE EXCEPTION 'amazon_asin_map no longer resolves to 81755'; END IF;

  RAISE NOTICE 'merged: 81755 now has % in-stock rows, best %, no chain, no orphans', n_rp, best;
END $$;

COMMIT;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────────
-- BEGIN;
--   UPDATE retailer_prices SET product_id = 126
--    WHERE id IN (SELECT ref::int FROM fmb_merge_126_snapshot_20260814 WHERE kind='retailer_price');
--   UPDATE stylevana_url_health_queue SET product_id = 126 WHERE product_id = 81755
--     AND EXISTS (SELECT 1 FROM fmb_merge_126_snapshot_20260814 WHERE kind='url_health_queue');
--   UPDATE products SET merged_into = NULL, merged_at = NULL WHERE id = 126;
--   UPDATE products SET merged_into = 126 WHERE id = 91868;
--   DELETE FROM product_merge_log WHERE keeper_product_id = 81755 AND removed_product_id = 126;
-- COMMIT;
-- DROP TABLE fmb_merge_126_snapshot_20260814;

-- ── WHAT THE PAGE SHOWS AFTER ───────────────────────────────────────────────────
--   4 retailer rows: Stylevana £10.52, YesStyle £10.72, Gorgeous Shop £26.40,
--                    Beauty Flash £33.00
--   BEST PRICE £10.52, down from £10.72
--   3 DISTINCT SELLERS, not 4 — Gorgeous Shop and Beauty Flash share an
--   external_product_id on 88.1% of the 7,243 products they both carry (item 103).
--   126's page stops being served: it leaves products_active on merged_into.
--
-- A SIDE EFFECT WORTH HAVING. The merged product ends up carrying BOTH codes across its
-- rows — 8809598450820 on three retailers and 648722973372 on Stylevana — so
-- ean_product_index will resolve EITHER to this product. The reseller code is not
-- deleted; it simply stops defining a product of its own.
