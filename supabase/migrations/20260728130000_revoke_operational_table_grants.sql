-- SECURITY: revoke anon/authenticated grants on the seven operational tables.
--
-- These seven have RLS disabled AND carry the full default grant to anon and
-- authenticated. Pre-change ACL, identical on all seven:
--
--   {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,
--    authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
--
-- arwdDxtm is INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER. With
-- RLS off there is nothing behind the grant, so anyone holding the public anon key
-- could read, rewrite, empty or TRUNCATE any of them over /rest/v1/.
--
-- import_run_state is the one that matters most. It is what
-- fmb_watchdog_stalled_imports reads to detect a stalled import, so an anon caller
-- could delete or rewrite slice state and either stall a feed run or blind the
-- watchdog to a run that had already stalled. 1520 kB of live import state.
--
-- They are born this way rather than made this way: the default ACL for schema
-- public granted arwdDxtm to anon on every new table. 20260728100000 fixes that
-- going forward. This migration is the retrospective half for these seven.
--
-- WHY "PUBLIC" IS IN THE REVOKE LIST
-- ==================================
-- None of these seven currently carries a PUBLIC element, so for tables today it
-- is strictly a no-op: unlike functions, Postgres does NOT grant anything on new
-- tables to PUBLIC by default, so there is no second route to close here. It is
-- included anyway because a REVOKE that omits PUBLIC is the exact defect that made
-- the Tier 1 functions look secured when they were not, and because someone
-- granting to PUBLIC by hand later should not silently survive a re-run of this
-- migration. Cheap insurance, and it keeps every REVOKE in this codebase the same
-- shape so the habit does not decay.
--
-- RLS IS DELIBERATELY NOT ENABLED, ON ANY OF THE SEVEN
-- ====================================================
-- Revoking the grants closes the exposure by itself; RLS is defence in depth on
-- top of that, and it is a separate decision with its own test plan.
--
-- Specifically NOT on import_run_state. The watchdog reads it every 5 minutes to
-- detect stalls, and enabling RLS in the week before the 4 August Boots
-- step-down decision risks breaking stall detection silently. A stalled import
-- between now and then would cost the read the decision rests on. The same
-- caution applies in weaker form to pending_merges.
--
-- This migration ASSERTS that RLS is still disabled on all seven afterwards. If a
-- later edit turns it on here, this migration fails rather than shipping it
-- quietly.
--
-- A KNOWN REMAINING BYPASS, NOT CLOSED HERE
-- ==========================================
-- public.feed_size_growth_trend is a view over feed_size_history. It has no
-- security_invoker, so it runs with owner rights, and it grants arwdDxtm to anon.
-- Revoking the base-table grant therefore does NOT stop anon reading
-- feed_size_history's contents through that view. The view is read-only in
-- practice (pg_relation_is_updatable returns 0; the CTE and window functions make
-- it non-auto-updatable), so this is a read bypass, not a write one, and nothing
-- in the codebase references the view. It is left for the views pass rather than
-- fixed here, but it means feed_size_history is not fully closed by this file.
--
-- service_role and postgres keep everything. The importers write import_run_state
-- and feed_size_history on the service-role key; the categoriser safety net,
-- catalog health snapshot and shade regroup crons run as postgres.
--
-- IDEMPOTENT: REVOKE of an already-absent privilege is a no-op, and the loop skips
-- any table absent from this database. Safe to re-run, on a branch, or after a
-- PITR restore. That last case is the one that matters: grants live only in the
-- database, so a restore without this migration silently reopens all seven.

DO $$
DECLARE
  tbl      text;
  tbl_oid  oid;
  tbl_acl  text;
  rls_on   boolean;
  tables   text[] := ARRAY[
    'public.import_run_state',
    'public.pending_merges',
    'public.catalog_health_history',
    'public.feed_size_history',
    'public.categoriser_safety_net_log',
    'public.shade_regroup_log',
    'public.shade_family_stems'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    BEGIN
      tbl_oid := tbl::regclass::oid;
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'skipping %, not present in this database', tbl;
      CONTINUE;
    END;

    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', tbl);

    -- Read relacl directly. has_table_privilege rolls PUBLIC up into every role's
    -- answer and would report success on a table that is still open, which is the
    -- failure mode this migration exists to prevent.
    SELECT relacl::text, relrowsecurity INTO tbl_acl, rls_on
      FROM pg_class WHERE oid = tbl_oid;

    IF tbl_acl IS NULL THEN
      RAISE EXCEPTION 'unexpected NULL ACL on % after revoke', tbl;
    END IF;
    IF tbl_acl LIKE '%anon=%' THEN
      RAISE EXCEPTION 'anon still holds privileges on % (ACL: %)', tbl, tbl_acl;
    END IF;
    IF tbl_acl LIKE '%authenticated=%' THEN
      RAISE EXCEPTION 'authenticated still holds privileges on % (ACL: %)', tbl, tbl_acl;
    END IF;
    -- A leading "=" element, or one after a comma, is a PUBLIC grant.
    IF tbl_acl LIKE '{=%' OR tbl_acl LIKE '%,=%' THEN
      RAISE EXCEPTION 'PUBLIC still holds privileges on % (ACL: %)', tbl, tbl_acl;
    END IF;

    -- Importers and crons must keep full access or feed runs break.
    IF tbl_acl NOT LIKE '%service_role=arwdDxtm%' THEN
      RAISE EXCEPTION 'service_role lost privileges on % (ACL: %)', tbl, tbl_acl;
    END IF;
    IF tbl_acl NOT LIKE '%postgres=arwdDxtm%' THEN
      RAISE EXCEPTION 'postgres lost privileges on % (ACL: %)', tbl, tbl_acl;
    END IF;

    -- Acceptance criterion for this pass: RLS state unchanged everywhere. If RLS
    -- is on here, something enabled it and that is a defect, not an improvement.
    IF rls_on THEN
      RAISE EXCEPTION
        'RLS is ENABLED on % — this pass must not enable RLS anywhere. '
        'See the header: import_run_state in particular must not get RLS before '
        '5 August, because silent stall-detection failure would cost the Boots read.', tbl;
    END IF;

    RAISE NOTICE 'secured %, ACL now %, RLS still off', tbl, tbl_acl;
  END LOOP;
END
$$;
