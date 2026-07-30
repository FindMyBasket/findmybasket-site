-- Ninth boundary: 450 brand pages went 200 -> 404 on the r12 Superdrug retirement.
--
-- WHAT IT MARKS. Retiring Superdrug (retailer 12) set its rows inactive. The
-- brand page at /brands/{slug} resolves through products_active, which requires a
-- price row at an ACTIVE retailer. Any brand stocked ONLY at Superdrug therefore
-- left the view entirely, and its page began returning 404.
--
-- Measured 30 July 2026: 20,563 products across 1,140 brands now carry offers only
-- at inactive retailers, and 450 BRANDS are absent from products_active altogether.
-- Confirmed 404ing in production: bluesky (1,372 products), mua (301),
-- trouble-maker (318), profusion-cosmetics (290). The largest, bluesky, is
-- Superdrug-only across every one of its 1,372 products.
--
-- WHY THIS ROW EXISTS. It happened as a SIDE EFFECT, not as a decision. Nobody
-- chose to deindex 450 pages; the retirement was about catalogue accuracy and this
-- followed from how products_active is defined. Section 4.0 of the dashboard brief
-- is about exactly this class: a boundary nobody recorded because nobody decided
-- it. Without this row the next reader finds a step change in indexed pages and
-- investigates it as a bug.
--
-- WHY IT IS URGENT RATHER THAN TIDY. The Boots absence step-down decision on
-- 4 August 2026 rests on a Search Console read. GSC will show a wave of 404s dated
-- from 27 July that has nothing to do with Boots. Without this row that wave gets
-- read as evidence about absence handling, and the step-down decision is made on
-- the wrong signal.
--
-- SEPARABILITY, for whoever does that read. The two are cleanly separable by URL
-- path: this event is entirely /brands/*, while Boots absence handling acts on
-- product pages (/product/*, middleware.ts matches /product/:path*). Boots cannot
-- produce a /brands/ 404 unless it empties a brand entirely.
--
-- ONE CONFOUND INSIDE THE /brands/ BUCKET, stated so it is not double-counted.
-- A SEPARATE and unrelated defect was 404ing roughly 60 further brand pages over
-- the same period: findBrandBySlug paginated products_active with LIMIT/OFFSET and
-- no ORDER BY, so rows were skipped and single-product brands vanished. Fixed
-- 30 July (PR #157, cc70a34). Anyone reading /brands/ coverage as a measure of THIS
-- event will overstate it by about 13% for the window 27-30 July.
--
-- DATE. Anchored to 2026-07-27 11:06:00+00, the instant already recorded for the
-- savings and catalogue baseline reset (platform_changes id 1), because that is the
-- same retirement event. The r12 deactivation instant itself was never recorded
-- separately, so this is the nearest true anchor rather than an invented time.
--
-- STATUS 'occurred': it has happened and is observable in production today.
--
-- NOT A DECISION ABOUT WHAT SHOULD HAPPEN NEXT. Whether a brand with no live
-- offers ought to return 404, 200 with a "no current offers" state, or 410 is an
-- open product question. This row records what DID happen; it does not endorse it.
--
-- ON CONFLICT names (title), and platform_changes_title_uniq exists to conflict on.
-- Convention 6: a bare ON CONFLICT DO NOTHING here would guard nothing and would
-- duplicate this row on every PITR replay.

BEGIN;

INSERT INTO public.platform_changes (changed_at, title, description, status, metrics_affected)
VALUES (
  '2026-07-27 11:06:00+00',
  '450 brand pages 404 on r12 retirement',
  'Retiring Superdrug (retailer 12) left 450 brands with no offer at any active '
  || 'retailer. Brand pages resolve through products_active, which requires a price '
  || 'row at an active retailer, so those brands left the view and their pages began '
  || 'returning 404. A side effect of the retirement, not a decision. 20,563 products '
  || 'across 1,140 brands carry offers only at inactive retailers. Separable from '
  || 'Boots absence handling by URL path: this is /brands/*, Boots acts on /product/*. '
  || 'Note a separate pagination defect (fixed 30 Jul, PR #157) was 404ing ~60 further '
  || 'brand pages over the same window; do not attribute those here.',
  'occurred',
  ARRAY['indexed_pages', 'gsc_coverage', 'brand_page_availability']
)
ON CONFLICT (title) DO NOTHING;

-- Convention 4: assert by reading the catalogue back, do not assume the INSERT did
-- what it said. The failure mode defended against is a statement that succeeds and
-- changes nothing.
DO $$
DECLARE
  v_id     bigint;
  v_status text;
  v_when   timestamptz;
  v_metrics text[];
BEGIN
  SELECT id, status, changed_at, metrics_affected
    INTO v_id, v_status, v_when, v_metrics
  FROM public.platform_changes
  WHERE title = '450 brand pages 404 on r12 retirement';

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'ASSERTION FAILED: r12 brand-page row absent after insert';
  END IF;
  IF v_status <> 'occurred' THEN
    RAISE EXCEPTION 'ASSERTION FAILED: status is %, expected occurred', v_status;
  END IF;
  IF v_when <> '2026-07-27 11:06:00+00'::timestamptz THEN
    RAISE EXCEPTION 'ASSERTION FAILED: changed_at is %, expected 2026-07-27 11:06:00+00', v_when;
  END IF;
  IF NOT (v_metrics @> ARRAY['indexed_pages','gsc_coverage','brand_page_availability']) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: metrics_affected is %', v_metrics;
  END IF;

  RAISE NOTICE 'OK: r12 brand-page boundary recorded as platform_changes id %', v_id;
END $$;

COMMIT;
