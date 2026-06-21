-- Helpers for the recategorise-products edge function (one-off + ongoing
-- catalogue re-categorisation pass). The function computes fresh categorisation
-- in TypeScript (inferCategorisation, the single source of truth) and hands the
-- precomputed values to these RPCs — the RPCs NEVER re-implement categorisation
-- rules in SQL. Their only jobs are (a) applying a batch of updates atomically
-- and (b) deleting excluded products with the correct FK ordering, both inside
-- a single plpgsql transaction so a mid-batch failure leaves no half-applied
-- state.

-- Bulk-apply re-categorisation. `updates` is a JSON array of
--   {id, top_category, product_type, subcategory, tags}
-- Each row's category column (the backwards-compat copy of product_type written
-- by the importers) is kept in sync. Runs as one statement / one transaction.
CREATE OR REPLACE FUNCTION public.fmb_recategorise_apply(updates jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  n integer := 0;
BEGIN
  IF updates IS NULL OR jsonb_array_length(updates) = 0 THEN RETURN 0; END IF;

  UPDATE public.products p
     SET top_category = u.top_category,
         product_type = u.product_type,
         subcategory  = u.subcategory,
         category     = u.product_type,
         tags         = u.tags
    FROM (
      SELECT (e->>'id')::integer                            AS id,
             NULLIF(e->>'top_category', '')                 AS top_category,
             COALESCE(e->>'product_type', '')               AS product_type,
             COALESCE(e->>'subcategory', '')                AS subcategory,
             COALESCE(
               (SELECT array_agg(x) FROM jsonb_array_elements_text(e->'tags') x),
               '{}'
             )::text[]                                      AS tags
        FROM jsonb_array_elements(updates) e
    ) u
   WHERE p.id = u.id;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Cascade-delete products that the categoriser now classifies as excluded
-- (wrong-catalogue, not wrong-tagged). Children deleted first because the FKs
-- are ON DELETE NO ACTION. price_history -> retailer_prices -> products, all in
-- one transaction. shade_variant_fix_proposals cascades automatically.
-- Self-references (parent_product_id / merged_into) pointing at a deleted id are
-- cleared first so a deletion never fails on its own variant/merge linkage.
-- Returns the number of products deleted.
CREATE OR REPLACE FUNCTION public.fmb_delete_products_cascade(ids integer[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  n integer := 0;
BEGIN
  IF ids IS NULL OR array_length(ids, 1) IS NULL THEN RETURN 0; END IF;

  UPDATE public.products SET parent_product_id = NULL WHERE parent_product_id = ANY(ids);
  UPDATE public.products SET merged_into        = NULL WHERE merged_into        = ANY(ids);

  DELETE FROM public.price_history   WHERE product_id = ANY(ids);
  DELETE FROM public.retailer_prices WHERE product_id = ANY(ids);
  DELETE FROM public.products        WHERE id         = ANY(ids);

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fmb_recategorise_apply(jsonb)        TO service_role;
GRANT EXECUTE ON FUNCTION public.fmb_delete_products_cascade(integer[]) TO service_role;
