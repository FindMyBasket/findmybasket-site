-- platform_changes: the sixth boundary, the server-side event-logging start.
--
-- WHY THIS ROW EXISTS. lib/events.ts writes search_events and outbound_clicks
-- server-side via the service role, independently of GA4 and independently of
-- cookie consent. It shipped in 2b54593 on 2026-07-01. Every week before that
-- has no server-side rows at all, and any week straddling it has a PARTIAL set.
--
-- That matters because those two tables are denominators, not just series. The
-- consent ratio (Step 6) is GA4 clicks over server-side clicks for the same ISO
-- week, so a short server-side denominator does not read as missing data, it
-- reads as unusually HIGH consent. That is the failure this row exists to
-- prevent: a boundary that makes a metric look better rather than emptier is one
-- nobody thinks to question.
--
-- Concretely, and this has now needed explaining twice in two days: the ISO week
-- beginning 2026-06-29 shows 36 GA4 clicks against 39 server-side, a 92% consent
-- ratio, against 62%, 81% and 66% for the three complete weeks that follow. It is
-- not a good week. It is 7 GA4 days measured against roughly 4.5 server-side
-- days. The three clean weeks put the real cost of consent plus blockers at
-- roughly a fifth to two fifths of clicks.
--
-- The outlier is deliberately NOT deleted from the brief's table. The reason it
-- is an outlier is the useful part, and a series with a quietly removed point
-- teaches nobody anything.
--
-- THE TIMESTAMP IS THE EARLIEST OBSERVED ROW, and is a bound rather than an
-- event. 2026-07-01 11:13:42.836544+00 is the first search_events row (the first
-- outbound_clicks row follows at 11:15:10). Logging was therefore live BY that
-- moment; the deploy itself may have been slightly earlier with no traffic to
-- record. Recording the first observed row is the strongest claim the evidence
-- supports, and it is more honest than rounding to midnight, which would assert
-- a whole morning of coverage that may not exist.
--
-- ON CONFLICT (title) names its target: convention 6 in
-- supabase/migrations/README.md. A bare DO NOTHING guards nothing.

INSERT INTO public.platform_changes (changed_at, status, title, description, metrics_affected)
VALUES
  ('2026-07-01 11:13:42.836544+00', 'occurred',
   'Server-side event logging start',
   'lib/events.ts began writing search_events and outbound_clicks via the service role, shipped in 2b54593. These two tables are consent-independent, so they are the denominator for every cross-check against GA4, including the Step 6 consent ratio. Weeks before this date have no server-side rows and the week beginning 2026-06-29 has a partial set (roughly 4.5 days of 7), which INFLATES the consent ratio for that week to 92% against 62/81/66% for the three complete weeks that follow. Treat any ratio spanning this boundary as unusable rather than good. The timestamp is the earliest observed row (first search_events row; first outbound_clicks row at 11:15:10), so logging was live by then and the deploy may have been marginally earlier with no traffic to record. It is a bound, not a measured start.',
   ARRAY['consent_ratio','zero_result_search_rate','outbound_clicks_server_side','search_events_volume'])
ON CONFLICT (title) DO NOTHING;

-- --- Verification (convention 4: assert, do not assume) --------------------
DO $$
DECLARE
  r record;
  n_total int;
BEGIN
  SELECT changed_at, status, metrics_affected INTO r
  FROM public.platform_changes
  WHERE title = 'Server-side event logging start';

  IF r IS NULL THEN
    RAISE EXCEPTION 'the server-side logging boundary row is absent after insert';
  END IF;
  IF r.status <> 'occurred' THEN
    RAISE EXCEPTION 'server-side logging boundary has status %, expected occurred', r.status;
  END IF;
  IF r.changed_at <> '2026-07-01 11:13:42.836544+00'::timestamptz THEN
    RAISE EXCEPTION 'server-side logging boundary has changed_at %, expected the first observed row', r.changed_at;
  END IF;
  IF NOT (r.metrics_affected @> ARRAY['consent_ratio']) THEN
    RAISE EXCEPTION 'server-side logging boundary does not name consent_ratio: %', r.metrics_affected;
  END IF;

  -- The timestamp must not have drifted later than the data it claims to bound.
  -- If a row ever predates it, the boundary is wrong and every ratio computed
  -- against it is wrong too.
  IF EXISTS (SELECT 1 FROM public.search_events WHERE created_at < r.changed_at)
     OR EXISTS (SELECT 1 FROM public.outbound_clicks WHERE created_at < r.changed_at) THEN
    RAISE EXCEPTION 'server-side rows exist BEFORE the recorded boundary; the date is wrong';
  END IF;

  SELECT count(*) INTO n_total FROM public.platform_changes;
  IF n_total <> 6 THEN
    RAISE EXCEPTION 'expected 6 boundary rows, found %', n_total;
  END IF;

  RAISE NOTICE 'OK: server-side logging boundary at %, % boundaries total', r.changed_at, n_total;
END
$$;
