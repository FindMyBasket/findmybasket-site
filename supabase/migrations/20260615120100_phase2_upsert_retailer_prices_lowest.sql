-- Phase 2 (chunked apply) — option B1 from PHASE_2_CHUNKED_APPLY.md §4B.
--
-- WHY: today the importer collects ALL link actions for a run, dedupes them in JS
-- to the lowest price per product_id, then does ONE upsert. Phase 2 flushes links
-- per chunk and CLEARS them, so the JS global dedup is gone. A plain
-- `upsert onConflict (product_id, retailer_id)` is last-write-wins, not
-- lowest-wins: if chunk 1 writes product X @ £10 and chunk 5 writes X @ £12, the
-- per-chunk flush would leave £12. This RPC moves the "lowest price wins" rule
-- into the database so links can flush-and-clear with bounded memory.
--
-- ── The cross-run trap (why this is NOT a bare `WHERE EXCLUDED.price < price`) ──
-- The spec sketch was `... DO UPDATE SET price=EXCLUDED.price WHERE EXCLUDED.price
-- < retailer_prices.price`. That is correct WITHIN one run, but the stored row
-- also holds YESTERDAY's price. A bare `<` guard would only ever ratchet a
-- product's price DOWN and never back up: a product that legitimately went
-- £10 → £12 between runs would keep £10 forever, and its stock/url would go
-- stale. The current single-shot upsert does NOT have this bug — each run fully
-- replaces the row with THIS run's lowest-price link.
--
-- To replicate that exactly, the RPC is RUN-SCOPED via p_run_started_at (one
-- timestamp captured once at the top of the import, passed on every flush):
--   * FIRST touch of a row this run (stored.last_updated < p_run_started_at, or
--     a brand-new row): take EXCLUDED wholesale — full refresh, price can move
--     either direction. This mirrors the old "replace the row each run".
--   * LATER touch of a row already written THIS run: lowest price wins, and the
--     winning link's columns (url/in_stock/ids) come with it. This mirrors the
--     old global JS dedup across chunks.
-- last_updated always advances to EXCLUDED.last_updated so the next chunk in the
-- same run sees the row as "touched this run".
--
-- Column types match retailer_prices exactly: product_id/retailer_id integer,
-- price numeric, in_stock boolean, last_updated `timestamp without time zone`
-- (importer passes new Date().toISOString(); both timestamps originate from UTC
-- ISO strings so the naked-timestamp comparison is apples-to-apples).

CREATE OR REPLACE FUNCTION upsert_retailer_prices_lowest(
  p_rows jsonb,
  p_run_started_at timestamp without time zone
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO retailer_prices AS rp (
    product_id, retailer_id, price, url, in_stock,
    external_product_id, ean, mpn, last_updated
  )
  SELECT
    r.product_id, r.retailer_id, r.price, r.url, r.in_stock,
    r.external_product_id, r.ean, r.mpn, r.last_updated
  FROM jsonb_to_recordset(p_rows) AS r(
    product_id          integer,
    retailer_id         integer,
    price               numeric,
    url                 text,
    in_stock            boolean,
    external_product_id text,
    ean                 text,
    mpn                 text,
    last_updated        timestamp without time zone
  )
  ON CONFLICT (product_id, retailer_id) DO UPDATE SET
    -- "Take EXCLUDED" when this is the first touch this run OR a strictly lower
    -- price within the run. Reused for every non-price column below.
    price = CASE
              WHEN rp.last_updated IS NULL OR rp.last_updated < p_run_started_at
                THEN EXCLUDED.price                              -- first touch: full refresh
              ELSE LEAST(rp.price, EXCLUDED.price)               -- same run: lowest wins
            END,
    url = CASE
            WHEN rp.last_updated IS NULL OR rp.last_updated < p_run_started_at
                 OR EXCLUDED.price < rp.price
              THEN EXCLUDED.url ELSE rp.url END,
    in_stock = CASE
            WHEN rp.last_updated IS NULL OR rp.last_updated < p_run_started_at
                 OR EXCLUDED.price < rp.price
              THEN EXCLUDED.in_stock ELSE rp.in_stock END,
    external_product_id = CASE
            WHEN rp.last_updated IS NULL OR rp.last_updated < p_run_started_at
                 OR EXCLUDED.price < rp.price
              THEN EXCLUDED.external_product_id ELSE rp.external_product_id END,
    ean = CASE
            WHEN rp.last_updated IS NULL OR rp.last_updated < p_run_started_at
                 OR EXCLUDED.price < rp.price
              THEN EXCLUDED.ean ELSE rp.ean END,
    mpn = CASE
            WHEN rp.last_updated IS NULL OR rp.last_updated < p_run_started_at
                 OR EXCLUDED.price < rp.price
              THEN EXCLUDED.mpn ELSE rp.mpn END,
    -- Always advance freshness so later chunks in the same run see "touched".
    last_updated = EXCLUDED.last_updated;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
