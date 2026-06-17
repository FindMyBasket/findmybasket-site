-- Change 2c — revalidate brand pages after a merge.
-- merge_product_group() and merge_products() both INSERT one row per removed
-- product into product_merge_log on a successful LIVE merge (dry-runs return
-- before inserting). Rather than rewrite those destructive SECURITY DEFINER
-- functions, we hang an additive AFTER INSERT trigger off product_merge_log: it
-- looks up the keeper's brand and fires fmb_revalidate_brand_slugs. pg_net is
-- transactional + async, so a rolled-back merge sends nothing and a committed
-- merge revalidates after commit without blocking it.
CREATE OR REPLACE FUNCTION public.fmb_revalidate_on_merge_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  kbrand text;
BEGIN
  SELECT coalesce(p.normalised_brand, p.brand) INTO kbrand
  FROM public.products p WHERE p.id = NEW.keeper_product_id;
  IF kbrand IS NOT NULL AND kbrand <> '' THEN
    BEGIN
      PERFORM public.fmb_revalidate_brand_slugs(ARRAY[public.fmb_brand_slug(kbrand)]);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- never let revalidation failure affect the merge
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_revalidate_on_merge_log ON public.product_merge_log;
CREATE TRIGGER trg_revalidate_on_merge_log
AFTER INSERT ON public.product_merge_log
FOR EACH ROW EXECUTE FUNCTION public.fmb_revalidate_on_merge_log();
