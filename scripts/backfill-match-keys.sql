-- Stage D: regenerate products.match_key for ALL rows using fmb_build_match_key
-- (see migration 20260628120000_match_key_tokenisation_fns.sql).
--
-- Why all rows, not just NULLs: the 16,268 legacy non-NULL keys are in an
-- incompatible format (pipe-delimited, alphabetically sorted bag-of-words, no
-- size, no brand) written by the old 2 May backfill-match-keys function. A
-- half-old/half-new keyspace would miss the very duplicates the Stage E sweep
-- exists to catch, so every row is rewritten to the buildMatchKey format.
--
-- Safety: match_key has no index, and the sole products trigger
-- (sync_product_type_from_category) is a no-op when category is unchanged, so a
-- match_key-only UPDATE is cheap. Nothing in the live read path reads match_key.
--
-- Batched via keyset pagination on id. Run ONE batch per call, each its own
-- short transaction (IO-friendly). Substitute :cursor and :batch with literals;
-- start :cursor = 0, then feed the previous call's next_cursor back in. Stop
-- when scanned < :batch (window exhausted).

WITH batch AS (
  SELECT id, fmb_build_match_key(brand, name) AS nk
  FROM products
  WHERE id > :cursor
  ORDER BY id
  LIMIT :batch
),
upd AS (
  UPDATE products p
  SET match_key = b.nk
  FROM batch b
  WHERE p.id = b.id
    AND p.match_key IS DISTINCT FROM b.nk   -- idempotent: skip already-correct rows on re-run
  RETURNING p.id
)
SELECT
  coalesce((SELECT max(id) FROM batch), :cursor) AS next_cursor,
  (SELECT count(*) FROM batch)                   AS scanned,
  (SELECT count(*) FROM upd)                     AS updated;

-- Post-run verification (run once at the end):
--   SELECT count(*) AS total,
--          count(*) FILTER (WHERE match_key IS NULL) AS still_null,
--          count(*) FILTER (WHERE coalesce(match_key,'') = '') AS unkeyable_empty,
--          count(DISTINCT match_key) AS distinct_keys
--   FROM products;
--   -- list any un-keyable rows (empty brand AND empty name):
--   SELECT id, brand, name FROM products WHERE coalesce(match_key,'') = '' LIMIT 50;
