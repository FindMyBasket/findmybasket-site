-- SECURITY: revoke anon/authenticated grants on the 49 scratch tables.
--
-- Completes the table-exposure pass. 20260728130000 secured the seven operational
-- tables; these are the other half of the 56, and every one of them was still
-- carrying the full default grant:
--
--   {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,
--    authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
--
-- arwdDxtm is INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, and
-- RLS is disabled on all 49, so anyone holding the public anon key could read,
-- rewrite, empty or TRUNCATE any of them over /rest/v1/. Several hold pre-change
-- snapshots of live catalogue rows, so they leak catalogue state as well as being
-- writable.
--
-- THIS MIGRATION DROPS NOTHING, DELIBERATELY
-- ==========================================
-- All 49 are drop CANDIDATES: each was verified to have zero database-side
-- readers (no view, no function, no cron job, no inbound foreign key) and no
-- meaningful code reader. But dropping is irreversible and revoking is not, so
-- the two decisions are separated on purpose. Revoking closes the exposure in
-- full, immediately, and needs no per-table judgement; the drop decision can then
-- take as long as it deserves.
--
-- That separation matters because "no reader" does NOT mean "safe to drop" here.
-- Several of these are the documented undo for an already-applied backfill:
-- stranded_price_reclaim_backup is created by 20260702120100 under the comment
-- "persists as the audit / rollback artifact", and
-- fmb_skincare_colour_snapshot_20260701 is the rollback path for the skincare
-- colour decontamination, whose programme is unfinished. Dropping those would
-- destroy the only way back from changes already applied to production.
--
-- WHY THE 49 ARE LISTED BY NAME
-- =============================
-- The obvious implementation is a dynamic sweep over "RLS off AND anon granted".
-- That is wrong for a migration, because a migration is replayed later against a
-- different schema: on a PITR restore or a fresh branch it would revoke on
-- whatever matched THEN, including future tables that legitimately need anon
-- SELECT. An explicit list can only ever affect the 49 tables this pass actually
-- audited. Tables absent from the database are skipped, so this stays correct
-- once they are eventually dropped.
--
-- RLS IS NOT ENABLED ON ANY OF THEM, and this migration asserts that afterwards.
-- Revoking the grants closes the exposure by itself; RLS is a separate, later,
-- per-table decision.
--
-- PUBLIC is included in the REVOKE. For tables it is currently a no-op, since
-- Postgres grants nothing on new tables to PUBLIC, but omitting it is the exact
-- defect that made the Tier 1 functions look secured when they were not, and it
-- keeps every REVOKE in this codebase the same shape.
--
-- IDEMPOTENT: REVOKE of an already-absent privilege is a no-op and absent tables
-- are skipped. Safe to re-run, on a branch, or after a PITR restore, which is the
-- case that matters: grants live only in the database, so a restore without this
-- migration silently reopens all 49.

DO $$
DECLARE
  tbl     text;
  tbl_oid oid;
  tbl_acl text;
  rls_on  boolean;
  n_done  int := 0;
  n_skip  int := 0;
  tables  text[] := ARRAY[
    'public._regroup_dryrun',
    'public._regroup_final',
    'public._regroup_plan',
    'public.anua_merge_backup_20260703',
    'public.boj_greenplum_backup_20260716',
    'public.boj_relief_sun_merge_backup_20260703',
    'public.clarins_bodyfit_merge_backup_20260701',
    'public.clarins_merge_backup_20260702',
    'public.clarins_merge_plan_20260702',
    'public.debenhams_name_backup_20260701',
    'public.dedup_brandword_backup_20260703',
    'public.dedup_brandword_snap_history_20260703',
    'public.dedup_brandword_snap_prices_20260703',
    'public.dedup_canary_snap_history_20260702',
    'public.dedup_canary_snap_prices_20260702',
    'public.dedup_canary_snap_products_20260702',
    'public.dedup_candidates_20260703',
    'public.dedup_countunit_backup_20260703',
    'public.dedup_countunit_snap_history_20260703',
    'public.dedup_countunit_snap_prices_20260703',
    'public.dedup_rest_pairs',
    'public.dedup_rest_snap_history_20260702',
    'public.dedup_rest_snap_prices_20260702',
    'public.dedup_rest_snap_products_20260702',
    'public.ean_safe_merges_20260701',
    'public.fmb_bathbody_phase1_snapshot_20260701',
    'public.fmb_skincare_colour_snapshot_20260701',
    'public.fuzzy_scan_base',
    'public.fuzzy_scan_hits',
    'public.fuzzy_typo_candidates',
    'public.fwee_recat_backup_20260716',
    'public.kbeauty_dupe_candidates_20260702',
    'public.kbeauty_merge_backup_20260702',
    'public.kbeauty_reviewtier_backup_20260703',
    'public.kbeauty_safe_merges_20260702',
    'public.kbeauty_unitword_backup_20260703',
    'public.medicube_cosrx_merge_backup_20260701',
    'public.medicube_toner_merge_backup_20260701',
    'public.medicube_vitac_backup_20260716',
    'public.medicube_zeropore_backup_20260703',
    'public.purito_merge_backup_20260703',
    'public.shade_backfill_backup_20260701',
    'public.shade_collapse_unparent_backup_20260722',
    'public.shade_extract_20260701',
    'public.shade_variant_fix_proposals',
    'public.spelling_dupes_20260701',
    'public.spelling_merge_plan_20260701',
    'public.stranded_price_reclaim_backup',
    'public.ultrasun_merge_backup_20260716'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    BEGIN
      tbl_oid := tbl::regclass::oid;
    EXCEPTION WHEN undefined_table THEN
      -- Expected once these are dropped. Not an error.
      n_skip := n_skip + 1;
      CONTINUE;
    END;

    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', tbl);

    -- Read relacl directly. has_table_privilege rolls PUBLIC up into every role's
    -- answer and would report success on a table that is still open.
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
    IF tbl_acl LIKE '{=%' OR tbl_acl LIKE '%,=%' THEN
      RAISE EXCEPTION 'PUBLIC still holds privileges on % (ACL: %)', tbl, tbl_acl;
    END IF;

    -- These are scratch, but service_role is how any future cleanup script or
    -- exporter would reach them, and postgres owns them.
    IF tbl_acl NOT LIKE '%service_role=arwdDxtm%' THEN
      RAISE EXCEPTION 'service_role lost privileges on % (ACL: %)', tbl, tbl_acl;
    END IF;

    -- Acceptance criterion for this pass: RLS state unchanged everywhere.
    IF rls_on THEN
      RAISE EXCEPTION 'RLS is ENABLED on % — this pass must not enable RLS anywhere', tbl;
    END IF;

    n_done := n_done + 1;
  END LOOP;

  RAISE NOTICE 'secured % scratch tables, skipped % already dropped', n_done, n_skip;
END
$$;
