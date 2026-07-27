-- SECURITY: revoke EXECUTE on nine admin/bulk-mutation RPCs from public roles.
--
-- These are SECURITY DEFINER (seven of the nine) and were callable by anyone
-- holding the public anon key over /rest/v1/rpc/, bypassing RLS entirely. Between
-- them they delete catalogue rows, rewrite any price, overwrite images and
-- descriptions, and merge products.
--
-- WHY "PUBLIC" IS IN THE REVOKE LIST, AND MUST STAY THERE
-- =======================================================
-- Postgres grants EXECUTE to PUBLIC on every new function by default. These nine
-- ALSO carried an explicit anon=X grant, so anon held EXECUTE by TWO independent
-- routes. Their ACLs read:
--
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,...}
--    ^^^^^^^^^^^ this leading "=X/" IS the PUBLIC grant
--
-- `REVOKE ... FROM anon, authenticated` removes one route and leaves the other.
-- The statement looks correct, it runs without error, and
-- has_function_privilege('anon', ...) STILL RETURNS TRUE afterwards, because it
-- rolls PUBLIC up into every role's answer. The hole stays open and the check
-- that should catch it agrees that everything is fine.
--
-- Do not "simplify" this to FROM anon, authenticated. If you need to confirm the
-- revoke took, read proacl directly and check the leading "=X/" element is gone;
-- that is stronger evidence than has_function_privilege.
--
-- service_role is deliberately NOT revoked. All four legitimate callers, the
-- three feed importers and recategorise-products, build their client from
-- SUPABASE_SERVICE_ROLE_KEY, and every one of the nine carries an explicit
-- service_role=X grant of its own rather than inheriting via PUBLIC, so removing
-- the PUBLIC grant cannot strip it. Three of the nine are on the import path,
-- so getting this wrong would break the nightly feed runs.
--
-- IDEMPOTENT: safe to re-run after a PITR restore, on a fresh branch, or twice.
-- Skips any function that does not exist, and REVOKE of an absent privilege is
-- already a no-op.

DO $$
DECLARE
  fn_sig text;
  fn_oid oid;
  sigs text[] := ARRAY[
    -- Type-only signatures: the regprocedure cast below rejects parameter names.
    'public.bulk_update_match_keys(jsonb)',
    'public.bulk_update_product_descriptions(jsonb)',
    'public.bulk_update_product_images(jsonb)',
    'public.bulk_update_retailer_prices(jsonb)',
    'public.fmb_delete_products_cascade(integer[])',
    'public.fmb_recategorise_apply(jsonb)',
    'public.fmb_soft_merge_group(integer, integer[], text)',
    'public.merge_product_group(integer, integer[], text, text)',
    'public.merge_products(bigint, text, boolean)'
  ];
BEGIN
  FOREACH fn_sig IN ARRAY sigs LOOP
    BEGIN
      fn_oid := fn_sig::regprocedure::oid;
    EXCEPTION WHEN undefined_function OR undefined_object THEN
      RAISE NOTICE 'skipping %, not present in this database', fn_sig;
      CONTINUE;
    END;

    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn_sig);

    -- Self-verifying: assert rather than trust. The failure mode this migration
    -- exists to prevent is a revoke that looks like it worked but did not.
    IF has_function_privilege('anon', fn_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon still holds EXECUTE on % after revoke (ACL: %)',
        fn_sig, (SELECT proacl::text FROM pg_proc WHERE oid = fn_oid);
    END IF;
    IF has_function_privilege('authenticated', fn_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated still holds EXECUTE on % after revoke', fn_sig;
    END IF;
    -- Losing service_role would break the feed importers on the next run.
    IF NOT has_function_privilege('service_role', fn_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role LOST EXECUTE on % — importers would break', fn_sig;
    END IF;
  END LOOP;
END
$$;
