-- SECURITY: revoke anon/authenticated grants on 21 RLS-enabled, zero-policy tables.
--
-- NO BEHAVIOUR CHANGES TODAY. This is a trap removal, not a fix.
--
-- These 21 have RLS ENABLED with ZERO policies. RLS with no policy denies every
-- row to any role subject to it, so the anon and authenticated grants they carry
-- are already unusable. Nothing anon can do today stops working.
--
-- The grants are therefore provably unnecessary, and their harmlessness depends
-- entirely on nobody ever adding a permissive policy. That is the trap: someone
-- adds a `FOR SELECT USING (true)` policy in six months to expose one column to
-- the site, and because the underlying grant is still arwdDxtm they silently
-- enable INSERT, UPDATE, DELETE and TRUNCATE for anon at the same time. The
-- policy review would look correct. The grant is what actually decides.
--
-- Same reasoning that made REVOKE ALL right on the default privileges in
-- 20260728100000: a missing grant fails loudly at build time, a stale one fails
-- silently forever. Adding a policy later should require deliberately granting
-- the privilege it needs.
--
-- RLS state is NOT touched. These stay RLS-enabled, and the migration asserts it.
-- Do not read this as making the RLS redundant: the two are independent controls
-- and both should hold.
--
-- SCOPE: exactly these 21. The other 15 RLS-enabled tables that carry anon grants
-- are deliberately left alone, because their grants ARE load-bearing:
--   * products, retailer_prices, retailers, brand_search_index, price_history,
--     category_savings, brand_hubs, brand_hub_products, product_change_events,
--     routine_alerts  - SELECT policies the public site depends on
--   * tracked_products, user_routines, user_alert_prefs - owner-scoped user data
--     (auth.uid() = user_id), needed by authenticated
--   * saved_routines, category_interest - intended anon-write public features
--
-- service_role and postgres keep their grants. Both carry BYPASSRLS, so they are
-- unaffected by the policies and reach these tables through the grant alone;
-- revoking theirs would break the importers and the crons that write them.
--
-- PUBLIC is included in the REVOKE. Currently a no-op for tables, since Postgres
-- grants nothing on new tables to PUBLIC, but omitting it is the exact defect
-- that made the Tier 1 functions look secured when they were not. See
-- supabase/migrations/README.md, convention 1.
--
-- The 21 are listed by name rather than swept with a predicate, per convention 3
-- in that README: a migration that computes its own scope behaves differently on
-- every replay, and this one would otherwise revoke on whatever happened to have
-- RLS-on-and-no-policies at restore time.
--
-- IDEMPOTENT: REVOKE of an absent privilege is a no-op, absent tables are skipped.

DO $$
DECLARE
  tbl     text;
  tbl_oid oid;
  tbl_acl text;
  rls_on  boolean;
  n_done  int := 0;
  n_skip  int := 0;
  tables  text[] := ARRAY[
    'public.bot_block_test_results',
    'public.brand_aliases',
    'public.dedupe_high_confidence',
    'public.dedupe_strict',
    'public.dq_dashboard_log',
    'public.matcher_filler_phrases',
    'public.merge_candidates',
    'public.outbound_clicks',
    'public.product_detach_log',
    'public.product_merge_log',
    'public.retailer_config',
    'public.retailer_import_config',
    'public.retailer_prices_dedupe_backup',
    'public.retailer_prices_skincupid_backup',
    'public.retailer_prices_skincupid_backup_2',
    'public.routine_email_log',
    'public.scrape_log',
    'public.search_events',
    'public.stylevana_url_health_queue',
    'public.stylevana_url_health_results',
    'public.superdrug_delta_staging'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    BEGIN
      tbl_oid := tbl::regclass::oid;
    EXCEPTION WHEN undefined_table THEN
      n_skip := n_skip + 1;
      CONTINUE;
    END;

    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated', tbl);

    -- Read relacl directly, per README convention 4. has_table_privilege rolls
    -- PUBLIC up into every role's answer and would report success on a table that
    -- is still open.
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
    IF tbl_acl NOT LIKE '%service_role=arwdDxtm%' THEN
      RAISE EXCEPTION 'service_role lost privileges on % (ACL: %)', tbl, tbl_acl;
    END IF;

    -- RLS must remain ENABLED here. These tables rely on it as the second of two
    -- independent controls, and this pass must not change RLS state either way.
    IF NOT rls_on THEN
      RAISE EXCEPTION 'RLS is DISABLED on % — it must stay enabled', tbl;
    END IF;

    n_done := n_done + 1;
  END LOOP;

  RAISE NOTICE 'secured % RLS-on zero-policy tables, skipped %', n_done, n_skip;
END
$$;
