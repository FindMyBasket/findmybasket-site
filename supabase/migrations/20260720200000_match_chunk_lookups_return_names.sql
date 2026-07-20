-- match_chunk_lookups: return the matched product's NAME on the ean / mpn /
-- extid projections too, not only on `products`.
--
-- WHY. The multipack guard (_shared/multipack-guard.ts) must test the name of
-- the product a feed row MATCHED. The importer built that name map from the
-- `products` set alone, so a row matched via external_product_id, EAN or MPN had
-- no name available and the guard fell back to the feed's own product_name —
-- which is exactly the invalid proxy the guard exists to avoid. One live row
-- (51523, Scottish Fine Soaps "duo" matched on external_product_id) escaped
-- through that hole after the name-match path was fixed.
--
-- Additive only: every existing key is preserved and one key is added to three
-- projections, so an older function build reading this RPC keeps working.
--
-- Cost: three id joins to products on primary key, within an already
-- chunk-scoped query. The `products` projection is unchanged.

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
      SELECT jsonb_agg(jsonb_build_object('ean', e.ean, 'product_id', e.product_id, 'name', p.name) ORDER BY e.ean)
      FROM ean_product_index e
      LEFT JOIN products p ON p.id = e.product_id
      WHERE e.ean = ANY(p_eans)
    ), '[]'::jsonb),
    'mpns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('mpn', m.mpn, 'product_id', m.product_id, 'name', p.name) ORDER BY m.mpn)
      FROM mpn_product_index m
      LEFT JOIN products p ON p.id = m.product_id
      WHERE m.mpn = ANY(p_mpns)
    ), '[]'::jsonb),
    'extids', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', rp.id, 'product_id', rp.product_id, 'external_product_id', rp.external_product_id, 'name', p.name) ORDER BY rp.id)
      FROM retailer_prices rp
      LEFT JOIN products p ON p.id = rp.product_id
      WHERE rp.retailer_id = p_retailer_id
        AND rp.external_product_id = ANY(p_extids)
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION match_chunk_lookups(integer, text[], text[], text[], text[]) TO service_role;
