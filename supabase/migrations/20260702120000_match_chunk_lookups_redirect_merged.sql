-- Correctness fix to the soft-merge mechanism (NOT category-specific).
--
-- Bug: match_chunk_lookups returned soft-merged (dead) product rows as live name-
-- match candidates — the products subquery had no merged_into guard. Because the
-- importer's name tier is first-wins-lowest-id and merged rows keep their own
-- distinct match_key, a re-imported feed row that used to belong to a merged-away
-- duplicate would LINK a fresh retailer_price onto the dead row instead of the
-- keeper. The dead row stays hidden (products_active filters merged_into IS NULL),
-- so the price is stranded: invisible on-site AND missing from the keeper's
-- comparison. Measured 2026-07-02: 213 stranded prices on 211 dead rows / 211
-- keepers, 182 of them offers the keeper otherwise lacks; still accreting.
--
-- Why REDIRECT, not just exclude: 516/1534 merged rows (34%; 210/211 of the
-- currently-stranded) have a match_key that DIFFERS from their keeper's — by
-- design, since manual merges fold products whose names normalise differently.
-- A plain `AND merged_into IS NULL` would drop the dead row as a candidate, but
-- then a divergent-key feed row matches NEITHER the dead row (gone) NOR the keeper
-- (different key) and falls through to CREATE a fresh, visible duplicate — worse
-- than the invisible stranding. match_key normalisation cannot close this (one
-- keeper key can't equal two different names). So instead we keep the dead row's
-- (name, brand) in the candidate set but emit COALESCE(merged_into, id) as its id:
-- the dead row's match_key now resolves to the KEEPER, never to the dead row.
--
-- PARITY: for non-merged rows merged_into IS NULL so COALESCE(merged_into, id) = id
-- — byte-identical to the previous payload. Only merged rows change, and they
-- change from "dead id (wrong)" to "keeper id (correct)". ORDER BY p.id is kept so
-- the JS first-wins-lowest-id collision rule is unchanged for non-merged keys.
-- ean/mpn/extid sections are unchanged: soft-merge moved those onto the keeper, and
-- with the name path fixed no new price can land on a dead row, so those indexes
-- stay keeper-pointing (existing stranded prices are repaired by the companion
-- reclaim migration 20260702120100).
--
-- CHAINS: COALESCE(merged_into, id) is a SINGLE hop. A health-check found 9 rows
-- whose merged_into points to a keeper that is ITSELF merged (A -> B -> C, max
-- depth 2, no cycles). Single-hop would route those to the intermediate dead row
-- B, not the ultimate survivor C. So FIRST flatten every chain to its ultimate
-- survivor (recursive, idempotent) — after which merged_into is single-hop for all
-- rows and the COALESCE below is exact. fmb_soft_merge_group already rejects
-- merging into an already-merged member, so no new chains form; this is a one-off
-- repair of pre-guard rows. Kept in THIS migration so the redirect function is
-- never live against un-flattened data (atomic within the migration transaction).

-- Flatten merge chains to the ultimate (non-merged) survivor.
WITH RECURSIVE chain AS (
  SELECT id AS start_id, merged_into AS cur, ARRAY[id] AS path
  FROM products WHERE merged_into IS NOT NULL
  UNION ALL
  SELECT c.start_id, p.merged_into, c.path || p.id
  FROM chain c
  JOIN products p ON p.id = c.cur
  WHERE p.merged_into IS NOT NULL
    AND NOT p.id = ANY(c.path)          -- cycle guard
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

CREATE OR REPLACE FUNCTION match_chunk_lookups(
  p_retailer_id integer,
  p_brands      text[],
  p_eans        text[],
  p_mpns        text[],
  p_extids      text[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT jsonb_build_object(
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', COALESCE(p.merged_into, p.id), 'name', p.name, 'brand', p.brand) ORDER BY p.id)
      FROM products p
      WHERE p.match_brand = ANY(p_brands)
    ), '[]'::jsonb),
    'eans', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('ean', e.ean, 'product_id', e.product_id) ORDER BY e.ean)
      FROM ean_product_index e
      WHERE e.ean = ANY(p_eans)
    ), '[]'::jsonb),
    'mpns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('mpn', m.mpn, 'product_id', m.product_id) ORDER BY m.mpn)
      FROM mpn_product_index m
      WHERE m.mpn = ANY(p_mpns)
    ), '[]'::jsonb),
    'extids', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', rp.id, 'product_id', rp.product_id, 'external_product_id', rp.external_product_id) ORDER BY rp.id)
      FROM retailer_prices rp
      WHERE rp.retailer_id = p_retailer_id
        AND rp.external_product_id = ANY(p_extids)
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION match_chunk_lookups(integer, text[], text[], text[], text[]) TO service_role;
