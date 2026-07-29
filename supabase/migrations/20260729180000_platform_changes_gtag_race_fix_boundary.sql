-- platform_changes: the seventh boundary, the gtag hydration race fix.
--
-- PROPOSED, NOT YET APPLIED. Gated. Apply on approval, before the fix reaches
-- production, then merge.
--
-- WHY IT GOES IN BEFORE THE DEPLOY, not after. The fix causes view_item to jump,
-- and the jump is a CORRECTION, not growth. If the row is added after the
-- deploy, there is a window in which somebody opens the dashboard, sees
-- comparison views climb, and reads it as the product working. Recording the
-- boundary first costs nothing and closes that window. This is the one boundary
-- whose timing we control, so there is no excuse for recording it late.
--
-- status = 'expected' with changed_at NULL, which the CHECK permits and which is
-- the honest state: the change is known and dated only once it ships. It flips
-- to 'occurred' with the deploy timestamp once the deploy is confirmed, not when
-- the PR merges. Merge and deploy are different events and only the second one
-- moves the data.
--
-- WHAT ACTUALLY CHANGES. Events fired from React mount effects were dropped
-- because window.gtag did not exist yet (the consent banner defines it and loads
-- afterInteractive, which runs after hydration). So the affected events were not
-- sparse, they were BIASED: undercounted by the share of page views that arrive
-- as cold loads rather than client-side navigations. For a site taking
-- search-engine landings straight onto product pages, that is likely most of
-- them.
--
-- THE TWO FUNNEL RATES MOVE IN OPPOSITE DIRECTIONS, which is the detail most
-- likely to be misread:
--
--   session to comparison-view rate        RISES  (its numerator was broken)
--   comparison-view to outbound-click rate FALLS, hard (its DENOMINATOR was
--                                          broken while retailer_click was
--                                          healthy, so it currently reads about
--                                          522%: 47 clicks over 9 view_item)
--
-- A fix that sends one indicator up and another sharply down, on the same day,
-- looks like a regression in the second if the first is what you were watching.
-- It is one correction with two signs.
--
-- All five affected metrics are suppressed from the dashboard until this lands
-- (see section 4.1 of docs/dashboard-build-brief.md). They become trustworthy
-- from the deploy date FORWARD ONLY. Do not compare across this boundary.
--
-- ON CONFLICT (title) names its target: convention 6 in
-- supabase/migrations/README.md.

INSERT INTO public.platform_changes (changed_at, status, title, description, metrics_affected)
VALUES
  (NULL, 'expected',
   'GA4 gtag hydration race fix',
   'Fix for GA4 events fired from React mount effects being dropped before window.gtag existed (docs/ticket-gtag-hydration-race.md). ANY JUMP AT THIS BOUNDARY IS A CORRECTION, NOT GROWTH: the affected events were undercounting by the share of page views arriving as cold loads rather than client-side navigations, so the series before this date is biased low by an unknown factor rather than merely sparse. Affects view_item and everything derived from it: qualified_sessions, comparison_views, session-to-comparison rate and comparison-view-to-outbound-click rate. The two rates move in OPPOSITE directions, which is the easiest thing here to misread: session-to-comparison RISES because its numerator was broken, while comparison-view-to-outbound-click FALLS steeply because its denominator was broken while retailer_click stayed healthy (it currently reads roughly 522%, being 47 outbound clicks over 9 view_item). One correction, two signs, same day. All five metrics are suppressed from the dashboard until this lands and are trustworthy from the deploy date forward only; do not compare across this boundary. Also expected to restore the GA4 search event, which sits at zero, and with it the search-to-comparison indicator that cannot be computed at all today. Flips to occurred with the deploy timestamp once the deploy is confirmed, NOT when the pull request merges.',
   ARRAY['view_item','qualified_sessions','comparison_views',
         'session_to_comparison_rate','comparison_view_to_outbound_click_rate',
         'search_to_comparison_rate'])
ON CONFLICT (title) DO NOTHING;

-- --- Verification (convention 4: assert, do not assume) --------------------
DO $$
DECLARE
  r record;
  n_total int;
BEGIN
  SELECT changed_at, status, metrics_affected INTO r
  FROM public.platform_changes
  WHERE title = 'GA4 gtag hydration race fix';

  IF r IS NULL THEN
    RAISE EXCEPTION 'the gtag race boundary row is absent after insert';
  END IF;
  IF r.status <> 'expected' THEN
    RAISE EXCEPTION 'gtag race boundary has status %, expected ''expected'' until the deploy is confirmed', r.status;
  END IF;
  -- Belt and braces against the CHECK: an expected row must NOT carry a date,
  -- or it would render as a marker on a day nothing happened.
  IF r.changed_at IS NOT NULL THEN
    RAISE EXCEPTION 'gtag race boundary carries changed_at %; it must stay NULL until the deploy', r.changed_at;
  END IF;
  IF NOT (r.metrics_affected @> ARRAY['view_item','qualified_sessions','comparison_views']) THEN
    RAISE EXCEPTION 'gtag race boundary does not cover the view_item-derived metrics: %', r.metrics_affected;
  END IF;

  SELECT count(*) INTO n_total FROM public.platform_changes;
  IF n_total <> 7 THEN
    RAISE EXCEPTION 'expected 7 boundary rows, found %', n_total;
  END IF;

  RAISE NOTICE 'OK: gtag race boundary recorded as expected, % boundaries total', n_total;
END
$$;
