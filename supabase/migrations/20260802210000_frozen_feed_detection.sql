-- Frozen-feed detection. Work-list item 14, the detection gap.
--
-- NOT SCHEDULED BY THIS MIGRATION. It creates the table and the function and
-- stops. Wiring it to pg_cron is a separate, gated step — see the note at the
-- foot of this file.
--
-- THE GAP THIS CLOSES
-- Ingestion is observed only at the import step. When a feed stops being
-- refreshed, the importer re-reads the same content, succeeds, and writes
-- last_import_status = 'ok'. It will do so indefinitely. absence_threshold_days
-- cannot help: it keys on rows missing from the feed, and no row is missing.
-- Every failure in this class reports success.
--
-- Found by reading feed_size_history on 2 August 2026, before this existed:
--   The Organic Pharmacy  99,242 bytes, byte-identical 27 Jun - 2 Aug (37 days),
--                         'ok' throughout. Still frozen at the time of writing.
--   Stylevana             17,556,316 bytes, byte-identical 10-16 Jul (7 days),
--                         'ok' throughout, self-resolved on the 17th.
-- Neither was noticed by anything.
--
-- WHY inflated_bytes AND NOT SOMETHING ELSE
--   scrape_log.price_updates  - identical to matched_count in every row. It
--                               counts rows written, not rows changed, so it
--                               never falls to zero on a frozen read.
--   retailer_prices.last_updated - rewritten on every row every run regardless
--                               of change. The Organic Pharmacy's 75 rows all
--                               carry one identical timestamp.
--   storage.objects.updated_at - works, but only for the three retailers whose
--                               feed_url is storage://. Neither real episode was
--                               one of them; both fetch live from AWIN.
-- inflated_bytes measures what ARRIVED, independent of where it came from, so
-- one check covers both the storage-backed and live-AWIN sub-classes.
--
-- WHY ONE ROW PER RETAILER PER DAY
-- feed_size_history holds MULTIPLE runs per day when a run is retried by hand.
-- Gorgeous Shop has three identical reads at 13:48, 14:06 and 14:26 on 20 July
-- 2026 — three manual retries, 38 minutes apart. Counting raw rows reads that as
-- a 3-run streak and the check fires on a person pressing the button twice.
-- Collapsing to the LAST run of each calendar day is what makes the threshold
-- mean days rather than invocations.

-- ── FINDINGS TABLE ──────────────────────────────────────────────────────────
-- Surfaces only. Nothing in this migration flips stock, disables a retailer or
-- touches retailer_prices. The Branded Beauty decision took a day of analysis
-- and a gated ruling; an automated version of that decision could take a quarter
-- of the catalogue offline on a single false positive.
CREATE TABLE IF NOT EXISTS public.feed_freeze_findings (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  retailer_id      integer NOT NULL REFERENCES public.retailers(id),
  kind             text    NOT NULL CHECK (kind IN ('freeze', 'truncation')),
  detected_at      timestamptz NOT NULL DEFAULT now(),
  first_seen_on    date    NOT NULL,
  last_seen_on     date    NOT NULL,
  days_identical   integer,
  frozen_bytes     bigint,
  staged_rows      integer,
  trailing_avg     numeric,
  -- Set by hand when someone has dealt with it. An open row (resolved_at IS
  -- NULL) is what suppresses re-alerting, so leaving it open is safe and
  -- closing it prematurely is what makes the alert repeat.
  resolved_at      timestamptz,
  note             text
);

-- One OPEN finding per retailer per kind per frozen value. This is the
-- re-alert suppression: without it The Organic Pharmacy alone would have
-- emitted 34 rows, which is how an alert channel gets muted.
CREATE UNIQUE INDEX IF NOT EXISTS feed_freeze_findings_open_uniq
  ON public.feed_freeze_findings (retailer_id, kind, COALESCE(frozen_bytes, -1))
  WHERE resolved_at IS NULL;

COMMENT ON TABLE public.feed_freeze_findings IS
  'Surfaced feed-staleness findings. Detection only — a person decides what to do. Work-list item 14.';

-- ── DETECTION ───────────────────────────────────────────────────────────────
-- p_min_days = 4. Justified against 38 days of observed volatility, collapsed to
-- one row per retailer per day:
--   longest legitimate streak observed  3 days  (Beauty Flash x5, Gorgeous Shop x1)
--   Stylevana freeze                    7 days
--   The Organic Pharmacy freeze        37 days
-- At 4 the backtest fires exactly twice across the whole window, both real. At 3
-- it fires six additional times, all benign. Detecting on day four rather than
-- day three is nearly free; one false positive that trains a reader to skim is
-- what makes the next real freeze invisible.
--
-- CAUTION, BEAUTY FLASH. Its 3-day streaks recur on a roughly weekly cadence
-- (27-29 Jun, 4-6 Jul, 11-13 Jul, 18-20 Jul, 25-27 Jul), which looks like a feed
-- refreshed about twice a week rather than daily. It sits one day under the
-- threshold by habit, not by luck. If it produces the first false positive,
-- raise ITS threshold rather than the global one.
CREATE OR REPLACE FUNCTION public.fmb_detect_frozen_feeds(
  p_min_days integer DEFAULT 4,
  p_truncation_pct numeric DEFAULT 0.60,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_freeze_found   jsonb[] := ARRAY[]::jsonb[];
  v_trunc_found    jsonb[] := ARRAY[]::jsonb[];
  rec              RECORD;
  v_inserted       integer := 0;
BEGIN
  -- FREEZE: current run of identical daily inflated_bytes, per retailer.
  FOR rec IN
    WITH daily AS (
      SELECT retailer_id,
             recorded_at::date AS d,
             (array_agg(inflated_bytes ORDER BY recorded_at DESC))[1] AS bytes,
             (array_agg(staged_rows    ORDER BY recorded_at DESC))[1] AS rows
      FROM feed_size_history
      GROUP BY retailer_id, recorded_at::date
    ),
    marked AS (
      SELECT *,
             CASE WHEN bytes IS NOT DISTINCT FROM
                       lag(bytes) OVER (PARTITION BY retailer_id ORDER BY d)
                  THEN 0 ELSE 1 END AS chg
      FROM daily
    ),
    grp AS (
      SELECT *, sum(chg) OVER (PARTITION BY retailer_id ORDER BY d) AS g FROM marked
    ),
    streaks AS (
      SELECT retailer_id, g,
             min(d) AS first_d, max(d) AS last_d,
             count(*) AS days_identical,
             max(bytes) AS bytes, max(rows) AS rows
      FROM grp GROUP BY retailer_id, g
    ),
    -- Only the streak that is still running: its last day must be the retailer's
    -- most recent import day. A streak that has already ended resolved itself and
    -- is not worth waking anyone for.
    current_streak AS (
      SELECT s.* FROM streaks s
      WHERE s.last_d = (SELECT max(d) FROM daily d2 WHERE d2.retailer_id = s.retailer_id)
    )
    SELECT cs.*, r.name AS retailer_name
    FROM current_streak cs
    JOIN retailers r ON r.id = cs.retailer_id
    JOIN retailer_import_config ric ON ric.retailer_id = cs.retailer_id
    WHERE cs.days_identical >= p_min_days
      AND r.active
      AND ric.enabled          -- a deliberately disabled importer is not a fault
    ORDER BY cs.days_identical DESC
  LOOP
    v_freeze_found := v_freeze_found || jsonb_build_object(
      'retailer_id', rec.retailer_id, 'retailer', rec.retailer_name,
      'days_identical', rec.days_identical, 'frozen_bytes', rec.bytes,
      'first_seen_on', rec.first_d, 'last_seen_on', rec.last_d
    );

    IF NOT p_dry_run THEN
      -- ON CONFLICT DO UPDATE, not DO NOTHING: while a freeze persists we want
      -- last_seen_on and the day count to keep advancing on the SAME row, so the
      -- finding shows how long it has been going without emitting a new alert.
      INSERT INTO feed_freeze_findings
        (retailer_id, kind, first_seen_on, last_seen_on, days_identical, frozen_bytes, staged_rows)
      VALUES
        (rec.retailer_id, 'freeze', rec.first_d, rec.last_d, rec.days_identical, rec.bytes, rec.rows)
      ON CONFLICT (retailer_id, kind, COALESCE(frozen_bytes, -1)) WHERE resolved_at IS NULL
      DO UPDATE SET last_seen_on = EXCLUDED.last_seen_on,
                    days_identical = EXCLUDED.days_identical;
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  -- TRUNCATION: a feed that arrived fresh but far smaller than usual. Different
  -- failure, same silence. Cheap because the same table already carries the row
  -- counts. Backtested over 38 days at 0.60: zero firings, so no per-retailer
  -- tuning was needed. If it ever does need per-retailer thresholds, delete this
  -- block rather than delay the freeze check for it.
  FOR rec IN
    WITH daily AS (
      SELECT retailer_id, recorded_at::date AS d,
             (array_agg(staged_rows ORDER BY recorded_at DESC))[1] AS rows
      FROM feed_size_history GROUP BY retailer_id, recorded_at::date
    ),
    windowed AS (
      SELECT retailer_id, d, rows,
             avg(rows) OVER (PARTITION BY retailer_id ORDER BY d
                             ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING) AS prev7
      FROM daily
    ),
    latest AS (
      SELECT DISTINCT ON (retailer_id) retailer_id, d, rows, prev7
      FROM windowed ORDER BY retailer_id, d DESC
    )
    SELECT l.*, r.name AS retailer_name
    FROM latest l
    JOIN retailers r ON r.id = l.retailer_id
    JOIN retailer_import_config ric ON ric.retailer_id = l.retailer_id
    WHERE l.prev7 IS NOT NULL
      AND l.prev7 > 0
      AND l.rows < p_truncation_pct * l.prev7
      AND r.active AND ric.enabled
  LOOP
    v_trunc_found := v_trunc_found || jsonb_build_object(
      'retailer_id', rec.retailer_id, 'retailer', rec.retailer_name,
      'staged_rows', rec.rows, 'trailing_avg', round(rec.prev7, 0),
      'pct_of_avg', round(100.0 * rec.rows / rec.prev7, 1), 'on_day', rec.d
    );

    IF NOT p_dry_run THEN
      INSERT INTO feed_freeze_findings
        (retailer_id, kind, first_seen_on, last_seen_on, staged_rows, trailing_avg)
      VALUES
        (rec.retailer_id, 'truncation', rec.d, rec.d, rec.rows, round(rec.prev7, 0))
      ON CONFLICT (retailer_id, kind, COALESCE(frozen_bytes, -1)) WHERE resolved_at IS NULL
      DO UPDATE SET last_seen_on = EXCLUDED.last_seen_on,
                    staged_rows  = EXCLUDED.staged_rows,
                    trailing_avg = EXCLUDED.trailing_avg;
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  IF array_length(v_freeze_found, 1) > 0 THEN
    RAISE LOG 'fmb_detect_frozen_feeds: % frozen feed(s): %',
      array_length(v_freeze_found, 1), to_jsonb(v_freeze_found);
  END IF;
  IF array_length(v_trunc_found, 1) > 0 THEN
    RAISE LOG 'fmb_detect_frozen_feeds: % truncated feed(s): %',
      array_length(v_trunc_found, 1), to_jsonb(v_trunc_found);
  END IF;

  RETURN jsonb_build_object(
    'min_days', p_min_days,
    'truncation_pct', p_truncation_pct,
    'dry_run', p_dry_run,
    'rows_written', v_inserted,
    'frozen', COALESCE(to_jsonb(v_freeze_found), '[]'::jsonb),
    'truncated', COALESCE(to_jsonb(v_trunc_found), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fmb_detect_frozen_feeds(integer, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fmb_detect_frozen_feeds(integer, numeric, boolean) TO service_role;

-- ── NOT DONE HERE, ON PURPOSE ───────────────────────────────────────────────
-- Scheduling. To wire it up, after reviewing a dry run:
--   SELECT cron.schedule('detect-frozen-feeds', '30 11 * * *',
--                        $$SELECT public.fmb_detect_frozen_feeds();$$);
-- 11:30 UTC sits after the latest daily import (YesStyle, ~10:00) so a run is
-- never judged on a day whose import has not happened yet.
--
-- WHAT THIS DOES NOT CATCH — read docs/standing-rule-frozen-catalogue-state.md.
-- The short version: it proves a feed CHANGED, never that it is CORRECT. A feed
-- that updates daily with stale or wrong prices passes this check completely.
-- Content correctness needs a different mechanism and is not in scope.
