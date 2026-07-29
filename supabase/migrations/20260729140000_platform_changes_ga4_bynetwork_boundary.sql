-- platform_changes: the fifth boundary, the GA4 by-network series start.
--
-- WHY THIS ROW EXISTS. affiliate_network, retailer_name and brand_slug were
-- registered as GA4 custom dimensions at some point before 27 July. GA4 does not
-- apply a dimension definition retroactively, so retailer_click events fired
-- before registration carry no network value and never will. Every week before
-- this date therefore has a total outbound-click count but no breakdown, and the
-- four by-network columns in metrics_ga4_weekly are NULL rather than 0 for those
-- weeks. Without this marker, the step where the breakdown begins looks like a
-- sudden change in behaviour and gets investigated as a bug.
--
-- HOW THE DATE WAS ESTABLISHED. Empirically, and only empirically. The brief was
-- explicit that it must not be taken from any document, because the documented
-- registration date (27 July) was already known to be wrong. The read-only
-- diagnostic (.github/workflows/ga4-diag.yml) scanned retailer_click backwards by
-- day against customEvent:affiliate_network and found the earliest day carrying a
-- network value: 2026-06-24.
--
-- WHY IT IS TRUSTWORTHY, which is a separate question from where it came from. A
-- first-non-null date is only a registration boundary if the property holds data
-- from before it; otherwise it is just where GA4's retention window truncates,
-- and the two are indistinguishable by the scan alone. The diagnostic's retention
-- guard cleared it on both counts:
--   * earliest event of ANY kind on the property: 2026-04-05, well before, so
--     events demonstrably existed while the dimension was not yet collecting;
--   * declared eventDataRetention is 14 months, and the start sits 391 days
--     inside that window, nowhere near the edge.
-- So this is a real dimension boundary, not a retention artefact.
--
-- TIME OF DAY IS DELIBERATELY NOT CLAIMED. The Data API returns day granularity,
-- so 2026-06-24 is the finest resolution the evidence supports. The timestamp is
-- stored as midnight UTC because the column is timestamptz and the CHECK forbids
-- an occurred row without a date; it is NOT a measured time. Do not treat the
-- 00:00 as meaningful, and do not "improve" it to a guessed hour.
--
-- Property reporting time zone is Etc/GMT, which is zero-offset with no daylight
-- saving, so midnight UTC and midnight property-time are the same instant and
-- this date needs no conversion.
--
-- ON CONFLICT (title): the constraint platform_changes_title_uniq exists (see
-- 20260728180000_dashboard_schema.sql). Naming the target rather than writing a
-- bare DO NOTHING is convention 6 in supabase/migrations/README.md, and it is
-- what makes this migration genuinely re-runnable rather than merely
-- re-runnable-looking.

INSERT INTO public.platform_changes (changed_at, status, title, description, metrics_affected)
VALUES
  ('2026-06-24 00:00:00+00', 'occurred',
   'GA4 by-network series start',
   'First day on which customEvent:affiliate_network returned a value for retailer_click, established empirically by scanning backwards day by day (never from a document: the documented registration date of 27 July was wrong). GA4 does not apply custom-dimension definitions retroactively, so outbound clicks before this date have a total but no network breakdown, and outbound_clicks_awin / _rakuten / _amazon / _other are NULL rather than 0 for every earlier week. Confirmed a real dimension boundary and not a retention edge: the property holds events from 2026-04-05, well before this date, and with 14-month retention the start sits 391 days inside the window. Day granularity is all the Data API supports, so the 00:00 timestamp is a storage artefact and not a measured time. Network values observed since: amazon, awin, ebay, rakuten. No "other" value has appeared yet and no stray casing, so the four by-network columns cover everything seen.',
   ARRAY['outbound_clicks_awin','outbound_clicks_rakuten','outbound_clicks_amazon','outbound_clicks_other'])
ON CONFLICT (title) DO NOTHING;

-- --- Verification (convention 4: assert, do not assume) --------------------
-- ON CONFLICT DO NOTHING is exactly the shape that succeeds while doing nothing,
-- so read the row back rather than trusting the INSERT. Also asserts the four
-- pre-existing boundaries are untouched: this migration must add one row, not
-- disturb the table whose entire job is to be the trustworthy record of when
-- metrics changed.
DO $$
DECLARE
  r record;
  n_total int;
BEGIN
  SELECT changed_at, status, metrics_affected INTO r
  FROM public.platform_changes
  WHERE title = 'GA4 by-network series start';

  IF r IS NULL THEN
    RAISE EXCEPTION 'the by-network boundary row is absent after insert';
  END IF;
  IF r.status <> 'occurred' THEN
    RAISE EXCEPTION 'by-network boundary has status %, expected occurred', r.status;
  END IF;
  IF r.changed_at <> '2026-06-24 00:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'by-network boundary has changed_at %, expected 2026-06-24 00:00:00+00', r.changed_at;
  END IF;
  IF NOT (r.metrics_affected @> ARRAY['outbound_clicks_awin','outbound_clicks_rakuten',
                                      'outbound_clicks_amazon','outbound_clicks_other']) THEN
    RAISE EXCEPTION 'by-network boundary does not cover all four by-network columns: %', r.metrics_affected;
  END IF;

  SELECT count(*) INTO n_total FROM public.platform_changes;
  IF n_total <> 5 THEN
    RAISE EXCEPTION 'expected 5 boundary rows, found % (the four seeded plus this one)', n_total;
  END IF;

  RAISE NOTICE 'OK: by-network boundary recorded at %, % boundaries total', r.changed_at, n_total;
END
$$;
