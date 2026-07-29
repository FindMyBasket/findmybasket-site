-- metrics_ga4_weekly: two search columns, one per event, never summed.
--
-- WHY TWO COLUMNS AND NOT ONE. GA4 has two different search events firing on the
-- same user action, for different reasons and over different periods:
--
--   view_search_results  enhanced measurement, emitted by gtag.js itself. It
--                        never depended on our mount-effect code, so it SURVIVED
--                        the hydration race and carries usable history.
--   search               our own custom event, fired from a mount effect
--                        (SearchEventTracker.tsx:30) with nothing awaited in
--                        front of it. It lost the race on every cold load and
--                        read exactly ZERO until the fix on 2026-07-29.
--
-- ADDING THEM TOGETHER WOULD DOUBLE-COUNT every search. This is the same hazard
-- as the three click events (click / retailer_click / affiliate_clickout), and
-- it is worse here for being asymmetric: the two columns overlap completely in
-- the post-fix period and not at all before it, so a sum is not even wrong by a
-- constant factor. It would read as a step change in search volume at exactly
-- the week the fix landed.
--
-- WHY NOT JUST KEEP view_search_results AND DROP THE OTHER. Because they do not
-- carry the same payload. view_search_results carries search_term but NOT
-- result_count, which rides on our custom event. Zero-result rate therefore
-- cannot come from it, and stays Supabase-only (search_events.result_count).
-- Keeping both columns is what lets the longer series and the richer series
-- coexist without either pretending to be the other.
--
-- WHAT EACH COLUMN IS FOR:
--   searches_view_search_results  the SEARCH VOLUME series, with a baseline.
--                                 Usable history from 2026-06-15.
--   searches_custom_event         NULL for every week before the race fix, by
--                                 the null-not-zero rule: it was not measured,
--                                 it was measured broken. First trustworthy week
--                                 is week_start 2026-08-03, the first ISO week
--                                 lying entirely after 2026-07-29 14:12:58+00.
--                                 See section 4.1 of the build brief for why the
--                                 straddling 2026-07-27 week does not count.
--
-- NULLABLE AND NO DEFAULT, deliberately. A DEFAULT 0 would write "zero searches"
-- into every historical week, which is a measurement never taken recorded as a
-- measurement of nothing, and it cannot be undone once written.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS plus COMMENT ON, both re-runnable.
-- Additive and reversible; no backfill, no data movement, no privilege change.

ALTER TABLE public.metrics_ga4_weekly
  ADD COLUMN IF NOT EXISTS searches_view_search_results integer NULL,
  ADD COLUMN IF NOT EXISTS searches_custom_event        integer NULL;

COMMENT ON COLUMN public.metrics_ga4_weekly.searches_view_search_results IS
  'GA4 enhanced-measurement view_search_results event count for the ISO week. '
  'Emitted by gtag.js, so it did NOT depend on our mount-effect code and did NOT '
  'suffer the hydration race: this is the search series WITH history, usable from '
  '2026-06-15. Carries search_term but NOT result_count, so zero-result rate '
  'cannot be derived from it (that stays Supabase-only, search_events). '
  'NEVER SUM WITH searches_custom_event: both fire on the same user action, and '
  'they overlap fully after 2026-07-29 and not at all before it, so a sum reads as '
  'a step change in search volume that did not happen.';

COMMENT ON COLUMN public.metrics_ga4_weekly.searches_custom_event IS
  'GA4 custom `search` event count for the ISO week. Fired from a mount effect '
  '(SearchEventTracker.tsx) with nothing awaited in front of it, so it lost the '
  'gtag hydration race on every cold load and read exactly ZERO from 2026-07-25 '
  'until the fix at 2026-07-29 14:12:58+00 (platform_changes id 17). '
  'NULL, never 0, for every week before that: the value was not unmeasured, it was '
  'measured wrong, and null-not-zero is the convention. First trustworthy week is '
  'week_start 2026-08-03, the first ISO week lying entirely after the fix; the '
  '2026-07-27 week straddles it and is excluded. This is the event that carries '
  'result_count. NEVER SUM WITH searches_view_search_results.';

-- --- Verification (convention 4: assert, do not assume) --------------------
DO $$
DECLARE
  n_cols   int;
  n_notnull int;
  n_default int;
  n_comment int;
BEGIN
  SELECT count(*) INTO n_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'metrics_ga4_weekly'
    AND column_name IN ('searches_view_search_results', 'searches_custom_event');
  IF n_cols <> 2 THEN
    RAISE EXCEPTION 'expected both search columns present, found %', n_cols;
  END IF;

  -- Both must be NULLable and DEFAULT-less. A default would silently convert
  -- "not measured" into "measured zero" on every existing and future row, which
  -- is the one thing this table's conventions forbid.
  SELECT count(*) INTO n_notnull
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'metrics_ga4_weekly'
    AND column_name IN ('searches_view_search_results', 'searches_custom_event')
    AND is_nullable = 'NO';
  IF n_notnull <> 0 THEN
    RAISE EXCEPTION '% of the search columns are NOT NULL; both must be nullable', n_notnull;
  END IF;

  SELECT count(*) INTO n_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'metrics_ga4_weekly'
    AND column_name IN ('searches_view_search_results', 'searches_custom_event')
    AND column_default IS NOT NULL;
  IF n_default <> 0 THEN
    RAISE EXCEPTION '% of the search columns carry a DEFAULT; null-not-zero forbids it', n_default;
  END IF;

  -- The comments carry the do-not-sum rule. If they are absent the rule exists
  -- only in a document, which is how the Superdrug name-keyed suppression
  -- survived a rewrite.
  SELECT count(*) INTO n_comment
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'metrics_ga4_weekly'
    AND c.column_name IN ('searches_view_search_results', 'searches_custom_event')
    AND col_description(('public.' || c.table_name)::regclass, c.ordinal_position) IS NOT NULL;
  IF n_comment <> 2 THEN
    RAISE EXCEPTION 'expected a comment on both search columns, found %', n_comment;
  END IF;

  RAISE NOTICE 'OK: both search columns present, nullable, default-less, commented';
END
$$;
