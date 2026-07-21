-- Durable absence handling for feed-absent rows.
--
-- Problem: when a SKU drops out of a retailer's affiliate feed, its price row
-- keeps in_stock=true at a frozen price forever. Most feeds never carry an OOS
-- row, so nothing flips it. ~20k rows currently claim in-stock at prices that
-- are often wrong (ended promo, delisted, moved), which sends users to a higher
-- price or a dead page.
--
-- Fix: after a PROVABLY COMPLETE import, mark rows that were not seen this run
-- (and are stale past the retailer's threshold) in_stock=false. Never delete —
-- the product is usually still live at the retailer, and if it returns to the
-- feed the importer re-stamps it in-stock, so the row self-heals.
--
-- The guards matter more than the flip. A run killed mid-way stamps only some
-- rows; firing blind after one would mass-OOS a live catalogue.

-- 1. Per-retailer staleness threshold.
--    Calibrated 2026-07-21 against live retailer pages. Retailer volatility
--    discriminates far better than one global age cutoff: YesStyle was wrong at
--    3 days (0/13 sampled prices still matched), Debenhams still right at 30
--    (5/7). A single cutoff would over-flip Debenhams and under-flip YesStyle.
ALTER TABLE public.retailer_import_config
  ADD COLUMN IF NOT EXISTS absence_threshold_days integer;

COMMENT ON COLUMN public.retailer_import_config.absence_threshold_days IS
  'Days a row may go unseen in the feed before absence handling flips it out of stock. 0 = flip as soon as it is missed. NULL = use the conservative default (30).';

-- NOTE: Boots and YesStyle are seeded PARKED at 9999 (effectively never), not
-- at their calibrated 7/0. Between them they account for ~18k of the ~20k
-- backlog, and almost all of those rows are their product's only offer — so
-- arming them empties ~18k pages in a single cycle. They stay parked until
-- Search Console coverage has been watched through the small-retailer wave.
-- Lower them to the calibrated values (Boots 7, YesStyle 0) to arm.
UPDATE public.retailer_import_config SET absence_threshold_days = v.days
FROM (VALUES
  (25, 9999), -- YesStyle: PARKED. Calibrated value is 0 (0/13 matched even at 3 days)
  (23, 9999), -- Boots: PARKED. Calibrated value is 7 (fresh 1-5d held, 13d+ gone/wrong)
  (8,  21),  -- Escentual: mid volatility, calibrate as data accrues
  (11, 21),  -- Stylevana: mid
  (28, 30),  -- Debenhams: stable, 5/7 still matched at 30 days
  (6,  30),  -- Branded Beauty: stable
  (26, 7),   -- Beauty Bay      \
  (27, 7),   -- Beauty Flash     | Group A: near-full-rewrite feeds (93%+ touch
  (24, 7),   -- Organic Pharmacy | rate), so an untouched row genuinely means
  (29, 7),   -- Atelier De Glow  | absent and a short threshold is safe
  (30, 7)    -- Gorgeous Shop   /
) AS v(rid, days)
WHERE retailer_import_config.retailer_id = v.rid;

-- 2. The absence-handling step itself.
--    Returns a jsonb report and, unless p_dry_run, applies the flip. Always
--    safe to call: every failure mode returns skipped=true with a reason rather
--    than touching data.
CREATE OR REPLACE FUNCTION public.fmb_apply_absence_handling(
  p_retailer_id    integer,
  p_run_started_at timestamptz,
  p_dry_run        boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Buffer on the run-start comparison. A row written mid-run must never look
  -- older than the run. Comparing against run START (not last_imported_at)
  -- already avoids the classic error, where a row stamped 04:30:32 reads as
  -- older than a run marked 04:31:07 and tens of thousands of live rows get
  -- flagged. The buffer is belt-and-braces on top of that.
  c_buffer         CONSTANT interval := interval '90 minutes';
  -- A completed run that wrote far less than usual is presumed partial.
  c_row_tolerance  CONSTANT numeric  := 0.80;
  -- A jump in exclusions means the in-scope filter definition moved, so rows
  -- dropped by the filter would masquerade as absent.
  c_excl_tolerance CONSTANT numeric  := 1.25;
  c_min_baseline   CONSTANT integer  := 3;

  v_status        text;
  v_threshold     integer;
  v_cutoff        timestamptz;
  v_this_matched  integer;
  v_this_excluded integer;
  v_base_matched  numeric;
  v_base_excluded numeric;
  v_base_runs     integer;
  v_candidates    integer := 0;
  v_flipped       integer := 0;
  v_log_id        bigint;
  v_skip          text := NULL;
BEGIN
  SELECT last_import_status, COALESCE(absence_threshold_days, 30)
    INTO v_status, v_threshold
  FROM public.retailer_import_config
  WHERE retailer_id = p_retailer_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no retailer_import_config row');
  END IF;

  -- GUARD 1: complete run only.
  -- last_import_status is stamped 'running' at apply-start and only 'ok' at
  -- finalisation, so a crashed run (546 worker kill) leaves 'running' and is
  -- excluded here. This is the single most important guard.
  IF v_status IS DISTINCT FROM 'ok' THEN
    v_skip := 'run not complete (last_import_status=' || COALESCE(v_status, 'null') || ')';
  END IF;

  -- Metrics for this run and the trailing baseline, from scrape_log.
  SELECT id, matched_count, COALESCE((details->>'excluded_total')::int, 0)
    INTO v_log_id, v_this_matched, v_this_excluded
  FROM public.scrape_log
  WHERE retailer_id = p_retailer_id
  ORDER BY started_at DESC NULLS LAST, id DESC
  LIMIT 1;

  SELECT COUNT(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY matched_count),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY COALESCE((details->>'excluded_total')::int, 0))
    INTO v_base_runs, v_base_matched, v_base_excluded
  FROM (
    SELECT matched_count, details
    FROM public.scrape_log
    WHERE retailer_id = p_retailer_id
      AND status = 'success'
      AND (v_log_id IS NULL OR id <> v_log_id)
      AND matched_count IS NOT NULL
    ORDER BY started_at DESC NULLS LAST, id DESC
    LIMIT 5
  ) prior;

  -- GUARD 2: row-count tolerance vs the trailing baseline.
  -- Until enough history exists we refuse rather than guess — a brand-new
  -- baseline cannot tell a normal run from a truncated one.
  IF v_skip IS NULL THEN
    IF v_base_runs < c_min_baseline THEN
      v_skip := 'insufficient baseline (' || v_base_runs || ' prior successful runs, need ' || c_min_baseline || ')';
    ELSIF v_this_matched IS NULL THEN
      v_skip := 'this run wrote no matched_count to scrape_log';
    ELSIF v_this_matched < c_row_tolerance * v_base_matched THEN
      v_skip := 'row count ' || v_this_matched || ' below ' || round(c_row_tolerance * 100) ||
                '% of baseline ' || round(v_base_matched) || ' — presumed partial run';
    END IF;
  END IF;

  -- GUARD 3: filter-change confound.
  -- If a category/brand exclusion changed, still-in-feed rows are dropped by
  -- the filter and look absent. A jump in the excluded count is the tell.
  IF v_skip IS NULL AND v_base_excluded IS NOT NULL AND v_base_excluded > 0
     AND v_this_excluded > c_excl_tolerance * v_base_excluded THEN
    v_skip := 'exclusion count ' || v_this_excluded || ' exceeds ' || round(c_excl_tolerance * 100) ||
              '% of baseline ' || round(v_base_excluded) || ' — in-scope filter likely changed';
  END IF;

  -- A row must be BOTH unseen this run AND stale past the retailer threshold,
  -- so the cutoff is the earlier of the two.
  v_cutoff := LEAST(p_run_started_at - c_buffer,
                    now() - make_interval(days => v_threshold));

  SELECT COUNT(*) INTO v_candidates
  FROM public.retailer_prices
  WHERE retailer_id = p_retailer_id AND in_stock AND last_updated < v_cutoff;

  IF v_skip IS NULL AND NOT p_dry_run THEN
    UPDATE public.retailer_prices
       SET in_stock = false
     WHERE retailer_id = p_retailer_id AND in_stock AND last_updated < v_cutoff;
    GET DIAGNOSTICS v_flipped = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'skipped',          v_skip IS NOT NULL,
    'reason',           v_skip,
    'dry_run',          p_dry_run,
    'retailer_id',      p_retailer_id,
    'threshold_days',   v_threshold,
    'cutoff',           v_cutoff,
    'candidates',       v_candidates,
    'flipped',          v_flipped,
    'this_matched',     v_this_matched,
    'baseline_matched', round(COALESCE(v_base_matched, 0)),
    'baseline_runs',    v_base_runs,
    'this_excluded',    v_this_excluded,
    'baseline_excluded', round(COALESCE(v_base_excluded, 0))
  );
END;
$$;

COMMENT ON FUNCTION public.fmb_apply_absence_handling(integer, timestamptz, boolean) IS
  'Post-import step: marks feed-absent rows out of stock (never deletes). Gated on a complete run, a row-count baseline, and a filter-change check. Safe to call at any time — it returns skipped=true with a reason instead of touching data when a guard fails.';

REVOKE ALL ON FUNCTION public.fmb_apply_absence_handling(integer, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fmb_apply_absence_handling(integer, timestamptz, boolean) TO service_role;
