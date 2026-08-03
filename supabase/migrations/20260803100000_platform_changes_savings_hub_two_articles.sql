-- platform_changes: two savings-hub articles publish on the next deploy.
--
-- lowest-price-per-product-basket.html and beauty-delivery-threshold-savings.html,
-- a must-publish-together pair. Adds two indexable pages and two sitemap entries.
--
-- WHY THIS ROW EXISTS AT ALL, given the change is small. indexed_pages is one of
-- the metrics platform_changes id 24 protects, and this deploy lands inside the
-- 4 August Boots GSC step-down observation window. Two added pages is a trivial
-- movement against 2,063 brand pages, but an unexplained upward step in
-- indexed_pages during a window that exists to measure a DOWNWARD step is exactly
-- the kind of thing that gets mis-attributed later.
--
-- IT DOES NOT CONFOUND THE BOOTS READ, and the deploy was deliberately not held.
-- GSC filters by path: these are /articles/*, the step-down read is /product/*
-- and /brands/*. Two added pages register as two added pages, not as coverage
-- errors. Same separability argument as id 24, which distinguishes /brands/* from
-- /product/* for the same reason.
--
-- STATUS IS 'expected' BECAUSE THE DEPLOY HAS NOT HAPPENED. Flip to 'occurred'
-- with the VERCEL DEPLOY timestamp, not the merge timestamp -- see
-- 20260729200000_platform_changes_gtag_race_fix_occurred.sql for why that
-- distinction has already caught this project once.
--
-- IDEMPOTENT: keyed on title (platform_changes_title_uniq, convention 6).
--
-- APPLICATION PATH: SQL rather than `apply_migration`, matching every
-- platform_changes row since 20260724102843. That divergence is work-list item 5
-- and is undecided; see 20260803090000 for the same note.

INSERT INTO public.platform_changes (changed_at, status, title, description, metrics_affected)
VALUES (
  NULL,
  'expected',
  'Savings hub: two whole-basket articles published',
  'Two articles publish together on the next deploy: /articles/lowest-price-per-product-basket.html and '
  '/articles/beauty-delivery-threshold-savings.html. Each links to the other and they are a must-publish-together '
  'pair. Adds 2 indexable pages, 2 sitemap-pages.xml entries and 2 savings-hub cards. '
  'DOES NOT CONFOUND THE 4 AUGUST BOOTS STEP-DOWN READ: GSC filters by path, these are /articles/*, the read is '
  '/product/* and /brands/*, and two added pages show as two added rather than as coverage errors. The deploy was '
  'deliberately not held. Recorded anyway because indexed_pages is a metric id 24 protects and this lands inside '
  'that observation window. '
  'COPY CAVEAT, live at publish time: both articles assert that per-product and whole-basket answers routinely '
  'disagree once delivery is counted. That is work-list item 12 and it is UNRESOLVED. If item 12 returns "found '
  'rarely" or "not found", these two articles and public/work-with-us.html:329 are where the claim is most exposed. '
  'Record the deploy timestamp and set status to occurred.',
  ARRAY['indexed_pages']
)
ON CONFLICT (title) DO NOTHING;

-- --- Verification (convention 4: assert, do not assume) --------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT id, status, changed_at, metrics_affected INTO r
  FROM public.platform_changes
  WHERE title = 'Savings hub: two whole-basket articles published';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'the savings-hub article boundary row is absent; the INSERT wrote nothing';
  END IF;
  IF r.status <> 'expected' OR r.changed_at IS NOT NULL THEN
    RAISE EXCEPTION 'row reads status % / changed_at %, expected ''expected'' and NULL', r.status, r.changed_at;
  END IF;
  IF NOT (r.metrics_affected @> ARRAY['indexed_pages']) THEN
    RAISE EXCEPTION 'row carries metrics_affected %, expected indexed_pages', r.metrics_affected;
  END IF;

  RAISE NOTICE 'OK: savings-hub article boundary recorded as expected, id %', r.id;
END
$$;
