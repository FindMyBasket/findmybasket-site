-- Eighth boundary: real traffic start, 2026-06-08.
--
-- APPROVED AND APPLIED 2026-07-29. This file was carried as
-- PROPOSED_20260729260000_... until the operator approved it; the prefix kept
-- the migration runner off it while it was still a proposal. Dry-run twice in a
-- rolled-back transaction before approval, applied on approval.
--
-- ============================================================================
-- Eighth boundary: real traffic start, 2026-06-08, status 'occurred'.
-- ============================================================================
--
-- WHAT IT MARKS. GA4's earliest event in the property is 2026-04-05. The site
-- launched on 2026-06-08. Everything between those two dates is pre-launch
-- testing against a live property, not traffic.
--
-- THE EVIDENCE THAT FORCED THIS. The view_search_results series looked like it
-- began 2026-04-13. It does not. That first week holds exactly ONE event and is
-- then followed by a two-month gap before the series actually starts on
-- 2026-06-15. One event in April is a developer loading a search page, and a
-- naive "earliest non-zero week" reading treats it as the series start.
--
-- WHY IT IS WORTH A ROW RATHER THAN A NOTE. Without it, every trend on the
-- dashboard begins with roughly two months of near-zero weeks that are not a
-- slow start, they are the absence of a website. A reader looking at a chart
-- that opens flat and then climbs reads a growth story that never happened, and
-- the natural response to it ("what changed in June?") has no true answer
-- because nothing changed except the site existing.
--
-- THIS IS A DENOMINATOR BOUNDARY, section 4.0's class. It does not flatter a
-- rate directly, it flatters the SHAPE of every series that crosses it, and in
-- the same direction every time: the run-in makes the present look like the
-- result of improvement rather than of launch.
--
-- WHY 2026-06-08 AND NOT 2026-06-15. 8 June is the launch, which is the fact
-- being recorded. 15 June is the first ISO week in which view_search_results
-- shows sustained volume, which is a consequence, and one particular series'
-- consequence at that. Dating the boundary at the observation rather than at
-- the cause would make it wrong for every other metric. Note the two are
-- consistent: 2026-06-08 IS an ISO Monday, and the launch week's own searches
-- would land in the 2026-06-08 bucket.
--
-- NOT RETROSPECTIVELY DELETING ANYTHING. The April to June rows stay queryable.
-- This marks them as pre-launch so the dashboard can exclude them from trend
-- rendering by the same predicate mechanism used for the id 17 suppression,
-- rather than by anyone remembering to.
--
-- Uses ON CONFLICT (title), the real UNIQUE constraint, per convention 6.
-- changed_at is a hard-coded literal, never now(): a PITR replay must write the
-- launch date, not the restore date.

INSERT INTO public.platform_changes (changed_at, status, title, description, metrics_affected)
VALUES (
  TIMESTAMPTZ '2026-06-08 00:00:00+00',
  'occurred',
  'Real traffic start (site launch)',
  'Site launched 2026-06-08. GA4 events exist from 2026-04-05, but everything '
  'before the launch date is pre-launch testing against a live property, not '
  'traffic. Established from the view_search_results series, which appears to '
  'start 2026-04-13 but whose first week holds a single event followed by a '
  'two-month gap before real volume begins 2026-06-15. Every GA4-sourced series '
  'crossing this date opens with a run-in of near-zero weeks that reads as a slow '
  'start and is in fact the absence of a website. Exclude pre-boundary weeks from '
  'trend rendering rather than plotting them as a baseline. Dated at the launch, '
  'not at 2026-06-15, because the latter is one series observation of the cause.',
  ARRAY[
    'sessions',
    'qualified_sessions',
    'comparison_views',
    'searches_view_search_results',
    'searches_custom_event',
    'outbound_clicks_awin',
    'outbound_clicks_rakuten',
    'outbound_clicks_amazon',
    'outbound_clicks_other'
  ]
)
ON CONFLICT (title) DO NOTHING;

-- --- Verification (convention 4) -------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT id, changed_at, status INTO r
  FROM public.platform_changes
  WHERE title = 'Real traffic start (site launch)';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'the real-traffic-start row is absent; the INSERT did nothing';
  END IF;
  IF r.status <> 'occurred' THEN
    RAISE EXCEPTION 'real-traffic-start row reads status %, expected occurred', r.status;
  END IF;
  IF r.changed_at IS DISTINCT FROM TIMESTAMPTZ '2026-06-08 00:00:00+00' THEN
    RAISE EXCEPTION 'real-traffic-start row carries changed_at %, expected 2026-06-08', r.changed_at;
  END IF;

  -- ON CONFLICT DO NOTHING is only protective if the constraint it needs exists
  -- (convention 6). Prove it rather than trusting the clause.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.platform_changes'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%(title)%'
  ) THEN
    RAISE EXCEPTION 'no UNIQUE constraint on platform_changes(title): the ON CONFLICT guarded nothing and a replay would duplicate this row';
  END IF;

  RAISE NOTICE 'OK: real traffic start recorded as id % at %', r.id, r.changed_at;
END
$$;
