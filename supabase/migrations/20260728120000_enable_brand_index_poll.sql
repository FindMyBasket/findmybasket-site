-- Enable the brand_search_index refresh poll.
--
-- The schedule below was written into 20260727200000_brand_search_index.sql as a
-- comment and deliberately left unexecuted, so that no rebuild churn could land
-- between arming and the 06:00 read on 2026-07-28. That read has passed, so the
-- poll is enabled here rather than by editing the applied migration.
--
-- WHY A POLL AND NOT A WINDOW
-- ===========================
-- Reproduced from the original design note, because the reasoning is the thing
-- most likely to be lost: this is deliberately NOT windowed to import hours. A
-- hardcoded window is one more dormant rule that breaks silently the day a
-- retailer is added or its cron is moved, which is the exact failure class this
-- index exists to avoid. The cron only polls; fmb_refresh_brand_index_if_stale
-- decides, by comparing the catalogue watermark to the index watermark. A poll
-- that finds nothing is a single indexed comparison, so running it around the
-- clock costs nothing worth optimising: 131 no-op polls a day against the ~14
-- real rebuilds the watermark actually triggers.
--
-- 11 minutes rather than 10 or 15 so the poll does not phase-lock with the
-- */5 watchdog or with the on-the-hour and on-the-half-hour importer crons.
--
-- STATE AT THE TIME OF ENABLING, read from brand_index_health
-- ===========================================================
--   index_watermark      2026-07-27 10:17
--   catalogue_watermark  2026-07-28 10:03
--   watermark_behind     true
--   brand_count_gap      1  (2054 catalogue brands, 2053 indexed)
--
-- The index is therefore ALREADY stale, and the first poll after this migration
-- will rebuild rather than no-op. That is intended: it is what makes the
-- enablement observable within 11 minutes instead of at the next import.
--
-- RUNS AS postgres, WHICH MATTERS AFTER THE TIER 2 REVOKES
-- ========================================================
-- 20260728110000 revoked EXECUTE on fmb_refresh_brand_index_if_stale from
-- PUBLIC, anon and authenticated. cron.schedule records the job against the role
-- that created it, postgres, which is the function owner and retains postgres=X,
-- so the revoke does not block this poll. If this migration is ever replayed by a
-- different role, check that role still holds EXECUTE before trusting the job.
--
-- IDEMPOTENT: cron.schedule upserts on job name, so re-running rebinds the same
-- job rather than creating a duplicate. Safe to re-run, on a branch, or after a
-- PITR restore, which is the case that matters most here: cron schedules live
-- only in the database, so a restore without this migration would silently leave
-- the index frozen with no error anywhere.

-- Outer block is tagged $mig$ rather than $$ because the scheduled command is
-- itself dollar-quoted; a bare $$ here would be closed by the inner one.
DO $mig$
DECLARE
  v_jobid    bigint;
  v_active   boolean;
  v_username text;
  v_command  text;
  v_count    int;
BEGIN
  PERFORM cron.schedule(
    'brand-index-refresh',
    '*/11 * * * *',
    $$SELECT public.fmb_refresh_brand_index_if_stale()$$
  );

  -- Verify rather than assume the schedule took, and that exactly one job owns
  -- this name. A duplicate would mean two rebuilds racing on the same rows.
  SELECT count(*) INTO v_count FROM cron.job WHERE jobname = 'brand-index-refresh';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 brand-index-refresh job, found %', v_count;
  END IF;

  SELECT jobid, active, username, command
    INTO v_jobid, v_active, v_username, v_command
    FROM cron.job WHERE jobname = 'brand-index-refresh';

  IF NOT v_active THEN
    RAISE EXCEPTION 'brand-index-refresh scheduled but INACTIVE (jobid %)', v_jobid;
  END IF;

  -- The poll is useless if the role it runs as cannot execute the function.
  -- Checked explicitly because the Tier 2 revoke landed shortly before this.
  IF NOT has_function_privilege(
       v_username, 'public.fmb_refresh_brand_index_if_stale()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION
      'job runs as % which lacks EXECUTE on fmb_refresh_brand_index_if_stale; '
      'the poll would fail silently every 11 minutes', v_username;
  END IF;

  RAISE NOTICE 'brand-index-refresh active: jobid %, as %, command %',
    v_jobid, v_username, v_command;
END
$mig$;
