-- Recurrence check for the normalised_brand staleness, built BEFORE the backfill
-- so it can be watched failing on dirty data.
--
-- THE PREDICATE. The awin importer sets normalised_brand = lower(trim(brand)) at
-- import-awin-feed/index.ts, AFTER alias canonicalisation, so the two can never
-- disagree on a row it wrote. Any row where they DO disagree was written by
-- something else. Measured 30 July 2026: 1,082 products across 47 brands.
--
-- WHERE THOSE CAME FROM. The 30 June partnership-split audit merged brand variants
-- via manual SQL, updating `brand` and leaving `normalised_brand` holding the old
-- lowercased name. Migration 20260630190443 then added brand_aliases rows so future
-- imports land correctly, and explicitly deferred the backfill of existing rows:
-- "tracked as a separate detection-then-allowlist follow-up, not done here." That
-- follow-up was never done. Every divergent value is an alias of the brand it sits
-- under, so this is staleness, not corruption.
--
-- WHY THIS LANDS BEFORE THE BACKFILL. Convention 8: a guard nobody has watched fail
-- is not known to be a guard. Built afterwards it would come up green on already
-- corrected data and nobody would ever see it fire. It has been proved to bite
-- against the live 1,082 and proved to reach zero against a simulated backfill,
-- both inside rolled-back transactions, before this migration was written.
--
-- SCOPE, AND IT DELIBERATELY DIFFERS FROM ITS SIBLINGS IN THIS TABLE.
-- Every other metric in capture_catalog_health() scopes to
-- `merged_into IS NULL AND parent_product_id IS NULL` (roots only). This one scopes
-- to `merged_into IS NULL` and INCLUDES shade children, because normalised_brand is
-- the leading column of idx_products_match and matching covers children —
-- fmb_family_best_price walks root plus children. A roots-only scope would leave
-- the matching surface unwatched.
--   Both scopes return 1,082 today, so this is not a numeric choice; it is a
--   correctness one, and it will diverge the moment a child row goes stale.
--   DO NOT "harmonise" this scope with the others without reading this note.
--
-- MERGED ROWS ARE EXCLUDED, and that is also deliberate. 13 further violations sit
-- on merged_into IS NOT NULL rows. A merged row's normalised_brand is inert:
-- products_active excludes it, fmb_family_best_price excludes it, nothing routes or
-- matches on it. Including them would park the check permanently at 13, and a check
-- that can never reach zero teaches people to read past it.
--
-- THRESHOLD IS ZERO, deliberately. The importer's rule is exact, so any deviation
-- is a defect. This check will be RED from the moment it ships until the backfill
-- lands. That is the intended behaviour, not noise: it is red because there is
-- something wrong, and it turns green when that is fixed.

BEGIN;

ALTER TABLE public.catalog_health_history
  ADD COLUMN IF NOT EXISTS brand_norm_violations integer,
  ADD COLUMN IF NOT EXISTS brand_norm_brands     integer;

COMMENT ON COLUMN public.catalog_health_history.brand_norm_violations IS
  'Products where normalised_brand <> lower(trim(brand)), scoped merged_into IS NULL '
  '(INCLUDES shade children, unlike the roots-only metrics in this table — see the '
  'migration header). Target 0. Non-zero means a brand rename updated `brand` without '
  'updating normalised_brand, which silently splits brand pages and matching.';

COMMENT ON COLUMN public.catalog_health_history.brand_norm_brands IS
  'Distinct brands covered by brand_norm_violations.';

CREATE OR REPLACE FUNCTION public.capture_catalog_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total INT;
  v_with_mk INT;
  v_without_mk INT;
  v_with_img INT;
  v_without_img INT;
  v_orphans INT;
  v_new_24h INT;
  v_new_24h_with_mk INT;
  v_pct_with_mk NUMERIC(5,2);
  v_pct_new_with_mk NUMERIC(5,2);
  v_bn_violations INT;
  v_bn_brands INT;
  v_regression BOOLEAN := FALSE;
  v_reason TEXT := NULL;
  v_inserted_id BIGINT;
BEGIN
  -- Capture core metrics
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE match_key IS NOT NULL),
    COUNT(*) FILTER (WHERE match_key IS NULL),
    COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url != ''),
    COUNT(*) FILTER (WHERE image_url IS NULL OR image_url = ''),
    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours'),
    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours' AND match_key IS NOT NULL)
  INTO v_total, v_with_mk, v_without_mk, v_with_img, v_without_img, v_new_24h, v_new_24h_with_mk
  FROM products
  WHERE merged_into IS NULL AND parent_product_id IS NULL;

  -- Orphans: products with no retailer prices
  SELECT COUNT(*) INTO v_orphans
  FROM products p
  WHERE p.merged_into IS NULL AND p.parent_product_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM retailer_prices rp WHERE rp.product_id = p.id);

  -- Brand canonicalisation drift. NOTE the scope: merged_into IS NULL only, so
  -- shade CHILDREN are included, unlike every other metric above. normalised_brand
  -- leads idx_products_match and matching covers children, so a roots-only scope
  -- would leave the matching surface unwatched. See the migration header.
  SELECT COUNT(*), COUNT(DISTINCT brand)
  INTO v_bn_violations, v_bn_brands
  FROM products
  WHERE merged_into IS NULL
    AND brand IS NOT NULL AND normalised_brand IS NOT NULL
    AND normalised_brand <> lower(trim(brand));

  v_pct_with_mk := ROUND(100.0 * v_with_mk / NULLIF(v_total, 0), 2);
  v_pct_new_with_mk := ROUND(100.0 * v_new_24h_with_mk / NULLIF(v_new_24h, 0), 2);

  -- Regression detection: the key signal
  -- If new products in last 24h have < 90% match_key coverage, that's a regression
  -- (Once the fix is in, this should consistently sit above 95%)
  IF v_new_24h > 50 AND v_pct_new_with_mk < 90.0 THEN
    v_regression := TRUE;
    v_reason := FORMAT('Only %s%% of new products (last 24h) have match_key. Expected >= 90%%.', v_pct_new_with_mk);
  END IF;

  -- Also flag if total match_key coverage drops (importer might have stopped writing match_keys silently)
  IF v_pct_with_mk < (
    SELECT COALESCE(MAX(pct_with_match_key) - 5.0, 0)  -- 5pp drop from historical high
    FROM catalog_health_history
    WHERE snapshot_at >= NOW() - INTERVAL '7 days'
  ) THEN
    v_regression := TRUE;
    v_reason := COALESCE(v_reason || ' Also: ', '') || 'Total match_key coverage dropped > 5pp in 7 days.';
  END IF;

  -- Brand canonicalisation drift. Threshold is ZERO: the importer's rule is exact,
  -- so any deviation is a defect rather than a tolerance to be tuned.
  IF v_bn_violations > 0 THEN
    v_regression := TRUE;
    v_reason := COALESCE(v_reason || ' Also: ', '') || FORMAT(
      '%s products across %s brands have normalised_brand <> lower(trim(brand)). '
      'A brand rename updated `brand` without updating normalised_brand; this splits '
      'brand pages and matching silently.', v_bn_violations, v_bn_brands);
  END IF;

  INSERT INTO public.catalog_health_history (
    total_active_products, products_with_match_key, products_without_match_key,
    pct_with_match_key, products_with_image, products_without_image, orphan_products,
    new_products_24h, new_products_24h_with_match_key, new_products_24h_without_match_key,
    pct_new_with_match_key, brand_norm_violations, brand_norm_brands,
    regression_detected, regression_reason
  )
  VALUES (
    v_total, v_with_mk, v_without_mk, v_pct_with_mk,
    v_with_img, v_without_img, v_orphans,
    v_new_24h, v_new_24h_with_mk, v_new_24h - v_new_24h_with_mk,
    v_pct_new_with_mk, v_bn_violations, v_bn_brands,
    v_regression, v_reason
  )
  RETURNING id INTO v_inserted_id;

  RETURN jsonb_build_object(
    'snapshot_id', v_inserted_id,
    'snapshot_at', NOW(),
    'total_active_products', v_total,
    'pct_with_match_key', v_pct_with_mk,
    'new_24h', v_new_24h,
    'pct_new_with_match_key', v_pct_new_with_mk,
    'orphan_products', v_orphans,
    'products_without_image', v_without_img,
    'brand_norm_violations', v_bn_violations,
    'brand_norm_brands', v_bn_brands,
    'regression_detected', v_regression,
    'regression_reason', v_reason
  );
END;
$function$;

-- Convention 1: a new/replaced function is born EXECUTE-to-PUBLIC no matter what
-- ALTER DEFAULT PRIVILEGES says, because acldefault() is re-merged at creation.
-- This is permanent for functions and is not made redundant by 20260728100000.
REVOKE EXECUTE ON FUNCTION public.capture_catalog_health() FROM PUBLIC, anon, authenticated;

-- Convention 4: read the catalogue back, do not assume.
DO $$
DECLARE v_acl text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='catalog_health_history'
                   AND column_name='brand_norm_violations') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: catalog_health_history.brand_norm_violations absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='catalog_health_history'
                   AND column_name='brand_norm_brands') THEN
    RAISE EXCEPTION 'ASSERTION FAILED: catalog_health_history.brand_norm_brands absent';
  END IF;

  SELECT COALESCE(proacl::text, '(null)') INTO v_acl
  FROM pg_proc WHERE proname='capture_catalog_health' AND pronamespace='public'::regnamespace;
  -- The PUBLIC grant is the element with an EMPTY grantee, so it is '=X/grantor'
  -- appearing either first ('{=X/...') or after a comma (',=X/...'). Matching a bare
  -- '%=X/%' is WRONG: it also matches 'postgres=X/postgres' and 'service_role=X/postgres',
  -- i.e. the grants that are supposed to be there. That over-broad form was written
  -- here first and raised against a correctly-secured function — a guard firing on a
  -- false positive, which is as dangerous as one that never fires. See README
  -- convention 1 for the ACL grammar.
  IF v_acl LIKE '{=X/%' OR v_acl LIKE '%,=X/%'
     OR v_acl LIKE '%anon=%' OR v_acl LIKE '%authenticated=%' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: capture_catalog_health still executable by PUBLIC/anon/authenticated: %', v_acl;
  END IF;

  RAISE NOTICE 'OK: brand-norm check installed, acl %', v_acl;
END $$;

COMMIT;
