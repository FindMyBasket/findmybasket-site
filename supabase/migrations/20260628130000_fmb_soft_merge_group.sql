-- Stage F soft-merge helper (the proven 28 June pattern, parameterised).
-- Folds duplicate product rows into a keeper WITHOUT deleting them:
--   1. per retailer across keeper+removed, keep the live/lower survivor
--      (most recent last_updated, then in-stock, then cheapest), delete the rest;
--   2. move surviving prices from removed -> keeper;
--   3. move price_history;
--   4. log each removed to product_merge_log;
--   5. set merged_into + merged_at on removed (row kept, hidden by products_active);
--   6. scoped orphan check: no prices may remain on the removed products (else raise).
-- Soft (not hard-delete) so merges stay auditable and reversible. Used by the
-- Stage F batched merge over confirmed duplicate groups (Tier A/B-sized/C-genuine).
CREATE OR REPLACE FUNCTION fmb_soft_merge_group(p_keeper int, p_removed int[], p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_deduped int; v_moved int; v_marked int; v_scoped_orphans int;
BEGIN
  IF p_keeper IS NULL OR p_removed IS NULL OR array_length(p_removed,1) IS NULL THEN
    RAISE EXCEPTION 'keeper and removed required';
  END IF;
  IF p_keeper = ANY(p_removed) THEN
    RAISE EXCEPTION 'keeper % is also in removed', p_keeper;
  END IF;
  IF EXISTS (SELECT 1 FROM products WHERE id = ANY(p_removed||p_keeper) AND merged_into IS NOT NULL) THEN
    RAISE EXCEPTION 'a member is already merged';
  END IF;

  WITH allrp AS (
    SELECT id, row_number() OVER (PARTITION BY retailer_id
      ORDER BY last_updated DESC NULLS LAST, in_stock DESC, price ASC, id ASC) rn
    FROM retailer_prices WHERE product_id = p_keeper OR product_id = ANY(p_removed)
  ), del AS (DELETE FROM retailer_prices WHERE id IN (SELECT id FROM allrp WHERE rn>1) RETURNING 1)
  SELECT count(*) INTO v_deduped FROM del;

  WITH mv AS (UPDATE retailer_prices SET product_id=p_keeper WHERE product_id = ANY(p_removed) RETURNING 1)
  SELECT count(*) INTO v_moved FROM mv;

  UPDATE price_history SET product_id=p_keeper WHERE product_id = ANY(p_removed);

  INSERT INTO product_merge_log (keeper_product_id, removed_product_id, removed_brand, removed_name,
    retailer_prices_moved, saved_routines_updated, match_key_used, notes)
  SELECT p_keeper, pr.id, pr.brand, pr.name, v_moved, 0, 'fmb_soft_merge', coalesce(p_note,'Stage F soft merge')
  FROM products pr WHERE pr.id = ANY(p_removed);

  WITH mk AS (UPDATE products SET merged_into=p_keeper, merged_at=now() WHERE id = ANY(p_removed) RETURNING 1)
  SELECT count(*) INTO v_marked FROM mk;

  SELECT count(*) INTO v_scoped_orphans FROM retailer_prices WHERE product_id = ANY(p_removed);
  IF v_scoped_orphans <> 0 THEN
    RAISE EXCEPTION 'orphan check failed: % prices still on removed', v_scoped_orphans;
  END IF;

  RETURN jsonb_build_object('keeper',p_keeper,'removed_count',array_length(p_removed,1),
    'prices_deduped',v_deduped,'prices_moved',v_moved,'marked_merged',v_marked,'scoped_orphans',v_scoped_orphans);
END;
$$;
