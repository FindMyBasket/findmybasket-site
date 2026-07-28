-- SECURITY: revoke anon/authenticated grants on three diagnostic views.
--
-- Closes the last hole in the table-exposure pass. The earlier revokes
-- (20260728130000, 20260728140000, 20260728150000) all filtered on
-- relkind IN ('r','p'), so they could not touch views. These three views run with
-- OWNER rights, because none of them carries security_invoker, and so they served
-- the contents of tables whose grants those migrations had just removed.
--
-- WHY A GRANT REVOKE AND NOT security_invoker
-- ===========================================
-- Adding security_invoker was the obvious fix and is the worse one:
--   * A revoke states the intent. security_invoker only makes the view inherit
--     whatever the caller happens to have, which is a different question.
--   * A revoke denies outright. security_invoker on saved_routines_stats would
--     still hand anon a row of zeros, which is information-free but noisy and
--     invites someone to "fix" the zeros later.
--   * Recreating a view can change its definition. A grant revoke cannot.
-- None of the three has any code reader: zero references across app, lib,
-- components, supabase/functions and scripts. They are hand-run diagnostics.
--
-- service_role and postgres keep their grants. Both carry BYPASSRLS, so ad-hoc
-- diagnostic access and any server-side read continue to work unchanged.
--
-- WHAT EACH ONE WAS EXPOSING
-- ==========================
-- feed_size_growth_trend  reads feed_size_history, whose anon grant was revoked
--   in 20260728130000 earlier the same evening. The view served that table's
--   contents to anon regardless. This is the clearest case of a view undoing a
--   table revoke.
--
-- saved_routines_stats  reads saved_routines, which has an INSERT policy and NO
--   SELECT policy specifically so anon can save a routine but cannot read any
--   back. The view returned real values anyway, because it ran as postgres.
--   IMPORTANT, so nobody overstates this later: the exposure was AGGREGATE ONLY.
--   The view is count(*), count(*) FILTER (WHERE active), count(DISTINCT email),
--   avg(...) and max(created_at), with no GROUP BY, so it returns exactly one row
--   and no email value or routine body is reachable through it. PostgREST filters
--   apply to that single output row and cannot pivot it into row-level
--   disclosure. What leaked was business metrics, including the unique user
--   count, not personal data.
--
-- brand_index_health  reads brand_search_index and products_active, both of which
--   anon can already read, plus retailer_import_config, which it cannot. The only
--   thing that leaked was the catalogue watermark, max(last_imported_at). Minor,
--   revoked for consistency. Note this view was already correctly restricted to
--   anon=r rather than arwdDxtm by 20260727200000: that migration revoked first
--   and granted only SELECT, and is the model the others should have followed.
--
-- DELIBERATELY NOT TOUCHED: products_active, ean_product_index, mpn_product_index,
-- active_category_subcategories. They also lack security_invoker, but their base
-- tables (products, retailer_prices, retailers) already carry USING (true) SELECT
-- policies plus anon grants, so anon can read that data directly and neither a
-- revoke nor security_invoker would deny anything. Meanwhile products_active has
-- 12 frontend and lib callers, and the two index views are read by the Shopify and
-- Rakuten importers. Zero security benefit against non-zero risk to the site and
-- the import path. Do not "finish the job" by sweeping them in.
--
-- PUBLIC is included in the REVOKE per README convention 1. Currently a no-op for
-- relations, but every REVOKE in this codebase keeps the same shape.
-- The three are listed by name per README convention 3.

DO $$
DECLARE
  v       text;
  v_oid   oid;
  v_acl   text;
  views   text[] := ARRAY[
    'public.brand_index_health',
    'public.feed_size_growth_trend',
    'public.saved_routines_stats'
  ];
BEGIN
  FOREACH v IN ARRAY views LOOP
    BEGIN
      v_oid := v::regclass::oid;
    EXCEPTION WHEN undefined_table THEN
      RAISE NOTICE 'skipping %, not present in this database', v;
      CONTINUE;
    END;

    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, anon, authenticated', v);

    -- Read relacl directly per README convention 4: has_table_privilege rolls
    -- PUBLIC up into every role's answer and would report success on a view that
    -- is still open.
    SELECT relacl::text INTO v_acl FROM pg_class WHERE oid = v_oid;

    IF v_acl IS NULL THEN
      RAISE EXCEPTION 'unexpected NULL ACL on % after revoke', v;
    END IF;
    IF v_acl LIKE '%anon=%' THEN
      RAISE EXCEPTION 'anon still holds privileges on % (ACL: %)', v, v_acl;
    END IF;
    IF v_acl LIKE '%authenticated=%' THEN
      RAISE EXCEPTION 'authenticated still holds privileges on % (ACL: %)', v, v_acl;
    END IF;
    IF v_acl LIKE '{=%' OR v_acl LIKE '%,=%' THEN
      RAISE EXCEPTION 'PUBLIC still holds privileges on % (ACL: %)', v, v_acl;
    END IF;
    IF v_acl NOT LIKE '%service_role=%' THEN
      RAISE EXCEPTION 'service_role lost privileges on % (ACL: %)', v, v_acl;
    END IF;

    RAISE NOTICE 'secured %, ACL now %', v, v_acl;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Record the access constraint on the object itself.
--
-- The data-quality dashboard is specified to surface brand index staleness
-- (behind-by duration and brand count gap) from this view. Because authenticated
-- is revoked above, a dashboard that reaches for it through the browser or an
-- authenticated client will get permission denied, and the cause will not be
-- obvious two weeks from now.
--
-- The decision, recorded rather than left to be discovered: the dashboard reads
-- this view SERVER-SIDE via service_role, using the existing client in
-- lib/supabase.ts. That route is authenticated and server-rendered already, and
-- lib/supabase.ts is built from SUPABASE_SERVICE_ROLE_KEY specifically to bypass
-- RLS for this kind of read, so no new plumbing is needed. Keeping the view
-- closed to authenticated was preferred over widening it for one consumer.
-- ---------------------------------------------------------------------------
COMMENT ON VIEW public.brand_index_health IS
  'Staleness signal for brand_search_index. brand_count_gap is an INDEPENDENT check: it compares catalogue to index directly and shares no logic with watermark_behind, so it still fires if the watermark mechanism itself is broken. Non-zero gap or watermark_behind = true means the index needs a rebuild. ACCESS: anon and authenticated are revoked (20260728160000). Read this SERVER-SIDE via service_role, e.g. the client in lib/supabase.ts. A browser or authenticated-client read WILL fail with permission denied - that is deliberate, do not fix it by granting authenticated.';
