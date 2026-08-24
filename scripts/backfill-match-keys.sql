-- Stage D: regenerate products.match_key for ALL rows using fmb_build_match_key
-- (see migration 20260628120000_match_key_tokenisation_fns.sql).
--
-- Why all rows, not just NULLs: the 16,268 legacy non-NULL keys are in an
-- incompatible format (pipe-delimited, alphabetically sorted bag-of-words, no
-- size, no brand) written by the old 2 May backfill-match-keys function. A
-- half-old/half-new keyspace would miss the very duplicates the Stage E sweep
-- exists to catch, so every row is rewritten to the buildMatchKey format.
--
-- Safety: match_key has no index, and sync_product_type_from_category is a no-op when
-- category is unchanged, so a match_key-only UPDATE is cheap. Nothing in the live read
-- path reads match_key.
--
-- ── IF THIS SCRIPT ABORTS, THAT IS A GUARD AND NOT A BUG ──────────────────────────────
--
-- Since 24 Aug 2026 a second trigger, guard_held_product_writes, refuses a name or
-- match_key write to any product carrying an OPEN `held:` finding in
-- standing_check_findings. This script rewrites match_key for EVERY row, so it will hit
-- any such row and abort the whole batch. The error names the hold, quotes the reason it
-- was recorded, and gives two ways past it.
--
-- IT ABORTS RATHER THAN SKIPPING DELIBERATELY. A batch that silently excluded the held row
-- would report a clean run and leave you believing the keyspace was uniform when it was
-- not -- and a half-rewritten keyspace is the exact failure this script exists to prevent.
--
-- TODAY THAT IS ONE ROW: product 105424, whose undecoded `&#039;` shields it from
-- COUNT_UNIT_RE reading "90's" as a ninety-piece pack count. Recomputing its key writes the
-- false pack count into the matcher. To run this script across the catalogue, either
-- exclude the held ids in the batch CTE, or -- if you have read the finding and mean it --
-- name the hold in the same transaction:
--
--     SET LOCAL "fmb.release_hold" = 'held:105424:entity-shields-count-unit';
--
-- Work-list items 237, 285 and 290.
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
