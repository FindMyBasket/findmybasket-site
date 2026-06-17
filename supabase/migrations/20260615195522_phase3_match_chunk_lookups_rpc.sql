-- Phase 3 (Option B) — collapse the per-chunk catalogue lookups into ONE round-trip.
--
-- WHY: profiling (2026-06-15) showed import-awin-feed's big-feed 546 is DB
-- round-trip latency in loadChunkMaps (~94% of wall), dominated by the products
-- lookup. Today loadChunkMaps issues FOUR PostgREST helpers (products / ean / mpn /
-- ext-id), each sliced into 300-key IN-chunks and paginated past the 1000-row cap —
-- DOZENS of network round-trips per chunk, plus deep-OFFSET re-scans. This RPC
-- returns all four lookup sets in a single JSONB payload from one call: one
-- round-trip per chunk, and each subquery is an unbounded single index scan (no
-- OFFSET pagination). It does the SAME total query work; the win is the round-trip
-- count. See PHASE_3_CPU_PROFILE_AND_OPTIONS.md (Option B).
--
-- PARITY (must match the JS map-build order in loadChunkMaps exactly):
--   * products  → ORDER BY id ASC. productByExact/productByStripped are FIRST-wins
--     (`if (!map.has(key))`), so the lowest id must arrive first for a colliding
--     match key. CRITICAL — without this, a different product id can win and the
--     importer links/creates differently.
--   * ean/mpn   → ORDER BY ean/mpn. eanToProductId/mpnToProductId are first-wins.
--   * ext-ids   → ORDER BY id ASC, but existingByExtId is LAST-wins in JS
--     (`.set(extid, row)` with no guard), so the HIGHEST id wins — same as the old
--     order-by-id-asc + last-write. JS keeps doing an unguarded .set().
--
-- Each section is an INDEPENDENT set lookup, all index-supported
-- (idx_products_match_brand; retailer_prices ean/mpn normalised indexes via the
-- ean_product_index/mpn_product_index VIEWS; idx_rp_external_product_id). The
-- planner runs them as four uncorrelated subqueries — no join, no row explosion.
--
-- match-tier LOGIC stays in JS (buildMatchKey / stripSize / size-verify): this RPC
-- only FETCHES, so outputs are byte-identical to the four eachIn() calls. Tier 5 /
-- urlToProductId is NOT populated here (it stays dead, same strict-parity scope as
-- the chunked-apply work).

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
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'brand', p.brand) ORDER BY p.id)
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
