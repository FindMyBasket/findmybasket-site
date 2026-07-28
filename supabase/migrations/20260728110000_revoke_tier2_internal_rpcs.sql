-- SECURITY, Tier 2: revoke EXECUTE on four internal RPCs from the public roles.
--
-- Follows the Tier 1 revokes (dd00d77, PR #135), same reasoning, lower blast
-- radius. All four are SECURITY DEFINER and none is meant to be reachable from a
-- browser, yet all four were callable by anyone holding the public anon key over
-- /rest/v1/rpc/. Pre-change ACL, identical on all four:
--
--   {=X/postgres,postgres=X/postgres,anon=X/postgres,
--    authenticated=X/postgres,service_role=X/postgres}
--    ^^^^^^^^^^^ the PUBLIC grant
--
-- WHY "PUBLIC" IS IN THE REVOKE LIST, AND MUST STAY THERE
-- =======================================================
-- Postgres grants EXECUTE to PUBLIC on every new function. These four ALSO carry
-- an explicit anon=X grant, so anon holds EXECUTE by TWO independent routes.
-- REVOKE ... FROM anon, authenticated removes one and leaves the other. The
-- statement succeeds, and has_function_privilege('anon', ...) STILL RETURNS TRUE
-- afterwards, because it rolls PUBLIC up into every role's answer. The hole stays
-- open and the check that should catch it agrees everything is fine.
--
-- Note that the default-privileges lockdown in 20260728100000 does NOT make this
-- unnecessary for future functions. That migration removes the explicit anon=X
-- and authenticated=X from new functions, but the PUBLIC grant is re-merged from
-- the built-in acldefault() and cannot be removed by ALTER DEFAULT PRIVILEGES.
-- A per-function REVOKE ... FROM PUBLIC like this one remains mandatory for every
-- new function in public. See that migration's header for the evidence.
--
-- PRECONDITION CHECKED BEFORE WRITING THIS, 28 Jul 2026
-- =====================================================
-- Every one of the four carries an explicit service_role=X/postgres grant of its
-- own rather than inheriting EXECUTE via PUBLIC, so removing the PUBLIC grant
-- cannot strip service_role. This was read out of proacl first, not assumed. Had
-- any of them relied on PUBLIC, the revoke would have broken the import path and
-- an explicit GRANT would have been required first.
--
-- CALLERS, VERIFIED FROM THE CODEBASE AND cron.job RATHER THAN ASSUMED
-- ====================================================================
-- fmb_invoke_import_slice(jsonb)  HIGHEST RISK. Chains every slice of the Boots
--   run. Callers: import-awin-feed/index.ts (6 call sites) and
--   import-rakuten-feed/index.ts (2), both on clients built from
--   SUPABASE_SERVICE_ROLE_KEY, so both arrive as service_role. Also called from
--   SQL inside fmb_watchdog_stalled_imports, which is SECURITY DEFINER and owned
--   by postgres, so that path executes as postgres. Both routes keep an explicit
--   grant. No browser or anon caller exists.
--
-- fmb_watchdog_stalled_imports(integer,integer,boolean)  Sole caller is pg_cron
--   jobid 28, "fmb-import-watchdog", */5 * * * *, active, username postgres.
--   Never reached through PostgREST. postgres is the owner and keeps postgres=X.
--
-- fmb_refresh_brand_index()
-- fmb_refresh_brand_index_if_stale()  No runtime caller at the time of writing.
--   The refresh poll is scheduled separately; cron.schedule runs the statement as
--   the job's owning role, postgres, which keeps postgres=X. Revoking here does
--   not block enabling that poll.
--
-- service_role is deliberately NOT revoked: it is how the importers arrive.
-- postgres is deliberately NOT revoked: it is how the cron jobs arrive.
--
-- IDEMPOTENT: skips any function absent from this database, and REVOKE of an
-- already-absent privilege is a no-op. Safe to re-run, on a branch, or after a
-- PITR restore. Privilege state lives only in the database, so a restore without
-- this migration would silently reopen all four.

DO $$
DECLARE
  fn_sig text;
  fn_oid oid;
  fn_acl text;
  sigs text[] := ARRAY[
    -- Type-only signatures: the regprocedure cast below rejects parameter names.
    'public.fmb_invoke_import_slice(jsonb)',
    'public.fmb_watchdog_stalled_imports(integer, integer, boolean)',
    'public.fmb_refresh_brand_index()',
    'public.fmb_refresh_brand_index_if_stale()'
  ];
BEGIN
  FOREACH fn_sig IN ARRAY sigs LOOP
    BEGIN
      fn_oid := fn_sig::regprocedure::oid;
    EXCEPTION WHEN undefined_function OR undefined_object THEN
      RAISE NOTICE 'skipping %, not present in this database', fn_sig;
      CONTINUE;
    END;

    -- Guard the precondition at run time too, not just at authoring time. If a
    -- future restore or CREATE OR REPLACE has dropped the explicit service_role
    -- grant, revoking PUBLIC here would silently break the feed importers, so
    -- refuse to proceed instead.
    SELECT proacl::text INTO fn_acl FROM pg_proc WHERE oid = fn_oid;
    IF fn_acl IS NOT NULL AND fn_acl NOT LIKE '%service_role=X%' THEN
      RAISE EXCEPTION
        'REFUSING to revoke on %: no explicit service_role grant in ACL (%). '
        'It would be inheriting EXECUTE via PUBLIC, and revoking PUBLIC would '
        'break the import path. GRANT EXECUTE TO service_role first.', fn_sig, fn_acl;
    END IF;

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

    -- Read the ACL directly for the PUBLIC check. has_function_privilege cannot
    -- answer this question: it rolls PUBLIC up into every role, so it reports
    -- success on a function that is still world-executable.
    SELECT proacl::text INTO fn_acl FROM pg_proc WHERE oid = fn_oid;
    IF fn_acl IS NULL OR fn_acl LIKE '{=X/%' OR fn_acl LIKE '%,=X/%' THEN
      RAISE EXCEPTION 'PUBLIC still holds EXECUTE on % (ACL: %)', fn_sig, fn_acl;
    END IF;

    -- Losing either of these would break the importers or the watchdog cron.
    IF NOT has_function_privilege('service_role', fn_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role LOST EXECUTE on % — importers would break', fn_sig;
    END IF;
    IF NOT has_function_privilege('postgres', fn_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'postgres LOST EXECUTE on % — cron jobs would break', fn_sig;
    END IF;

    RAISE NOTICE 'revoked on %, ACL now %', fn_sig, fn_acl;
  END LOOP;
END
$$;
