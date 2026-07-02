-- One-shot repair: fold prices that re-accreted onto soft-merged (dead) rows back
-- onto their keepers. Companion to 20260702120000 (which stops NEW stranding).
--
-- Needed because the redirect fix only touches the NAME candidate maps. A price
-- that already sits on a dead row carries an external_product_id there, so the
-- importer's ext-id/update tier (existingByExtId -> that rp -> product_id = dead)
-- keeps updating it IN PLACE on the dead row every run — it is self-perpetuating
-- and the redirect cannot move it. This migration moves each stranded price onto
-- the keeper using the SAME survivor rule as fmb_soft_merge_group, restoring the
-- post-merge invariant that dead rows hold zero prices.
--
-- SNAPSHOT-FIRST: this is a live-price move, so every affected retailer_prices row
-- (both the ones moved and the ones dedup-deleted) is copied verbatim into
-- stranded_price_reclaim_backup (full row as jsonb) BEFORE any UPDATE/DELETE, so
-- the move is fully reversible from the backup alone.
--
-- IDEMPOTENT: safe to re-run. After a successful run no merged row holds any
-- retailer_price, so the snapshot INSERT and the move cursor both select nothing,
-- and the backup is append-only guarded by rp_id (a re-run never re-snapshots or
-- double-moves). The final invariant check makes a partial/failed state impossible
-- to commit.
--
-- CHAINS: 9 rows were merged into a keeper that is itself merged (A -> B -> C).
-- Migration 20260702120000 already flattens merged_into to the ultimate survivor,
-- but this step re-asserts it (idempotent) so the reclaim is self-contained and its
-- price-fold below always targets the ultimate survivor, never an intermediate
-- dead row. After flattening, merged_into is single-hop for every row.

-- 0. Defensive re-flatten of any merge chains to the ultimate (non-merged) survivor.
WITH RECURSIVE chain AS (
  SELECT id AS start_id, merged_into AS cur, ARRAY[id] AS path
  FROM products WHERE merged_into IS NOT NULL
  UNION ALL
  SELECT c.start_id, p.merged_into, c.path || p.id
  FROM chain c
  JOIN products p ON p.id = c.cur
  WHERE p.merged_into IS NOT NULL
    AND NOT p.id = ANY(c.path)
),
ultimate AS (
  SELECT start_id, (array_agg(cur ORDER BY array_length(path, 1) DESC))[1] AS survivor
  FROM chain GROUP BY start_id
)
UPDATE products p
SET merged_into = u.survivor
FROM ultimate u
WHERE p.id = u.start_id
  AND p.merged_into IS DISTINCT FROM u.survivor;

-- 1. Snapshot table (persists as the audit / rollback artifact).
CREATE TABLE IF NOT EXISTS stranded_price_reclaim_backup (
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  dead_id     int,
  keeper_id   int,
  rp_id       bigint,
  rp_row      jsonb
);

-- 2. Snapshot BOTH SIDES of every affected pair (dead row AND its keeper), BEFORE
--    any move/delete — the per-retailer dedup in 3a can delete a keeper-side row
--    when a dead-side row wins, so a dead-only snapshot would not be reversible.
--    One row per retailer_price (DISTINCT ON rp.id); guarded by rp_id so a re-run
--    adds nothing. Restricted to pairs whose dead row actually holds prices.
INSERT INTO stranded_price_reclaim_backup (dead_id, keeper_id, rp_id, rp_row)
SELECT DISTINCT ON (rp.id) d.id, d.merged_into, rp.id, to_jsonb(rp)
FROM products d
JOIN retailer_prices rp ON rp.product_id = d.id OR rp.product_id = d.merged_into
WHERE d.merged_into IS NOT NULL
  AND EXISTS (SELECT 1 FROM retailer_prices s WHERE s.product_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM stranded_price_reclaim_backup b WHERE b.rp_id = rp.id)
ORDER BY rp.id, d.id;

-- 3. Fold prices dead -> keeper.
DO $$
DECLARE
  r record;
  v_moved int := 0;
  v_deduped int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT d.id AS dead_id, d.merged_into AS keeper_id
    FROM products d
    JOIN retailer_prices rp ON rp.product_id = d.id
    WHERE d.merged_into IS NOT NULL
  LOOP
    -- 3a. Per retailer across keeper+dead, keep the live/lower survivor, delete rest.
    WITH allrp AS (
      SELECT id, row_number() OVER (PARTITION BY retailer_id
        ORDER BY last_updated DESC NULLS LAST, in_stock DESC, price ASC, id ASC) rn
      FROM retailer_prices WHERE product_id IN (r.dead_id, r.keeper_id)
    ), del AS (
      DELETE FROM retailer_prices WHERE id IN (SELECT id FROM allrp WHERE rn > 1) RETURNING 1
    )
    SELECT v_deduped + count(*) INTO v_deduped FROM del;

    -- 3b. Move surviving prices dead -> keeper.
    WITH mv AS (
      UPDATE retailer_prices SET product_id = r.keeper_id WHERE product_id = r.dead_id RETURNING 1
    )
    SELECT v_moved + count(*) INTO v_moved FROM mv;

    -- 3c. Move price_history.
    UPDATE price_history SET product_id = r.keeper_id WHERE product_id = r.dead_id;

    -- 3d. Audit trail (reuse the merge log).
    INSERT INTO product_merge_log (keeper_product_id, removed_product_id, removed_brand, removed_name,
      retailer_prices_moved, saved_routines_updated, match_key_used, notes)
    SELECT r.keeper_id, pr.id, pr.brand, pr.name, 0, 0, 'reclaim_stranded',
           'Reclaim stranded prices post redirect fix (20260702120100)'
    FROM products pr WHERE pr.id = r.dead_id;
  END LOOP;

  -- 4. Invariant check: no merged row may hold prices after reclaim.
  IF EXISTS (
    SELECT 1 FROM products d JOIN retailer_prices rp ON rp.product_id = d.id
    WHERE d.merged_into IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'reclaim failed: prices still on merged rows';
  END IF;

  RAISE NOTICE 'reclaim done: % prices moved, % deduped', v_moved, v_deduped;
END $$;
