-- platform_changes: flip the gtag hydration race fix from expected to occurred.
--
-- THE TIMESTAMP IS THE DEPLOY, NOT THE MERGE. PR #146 squash-merged to main as
-- 4c9aa0a. The Vercel production deployment for that commit reported ready at
-- 2026-07-29T14:12:58Z (GitHub deployment 5659006579, state=success), and that
-- is the instant the first browser could receive the stub. The merge happened
-- minutes earlier and moved no data. The previous migration
-- (20260729180000_platform_changes_gtag_race_fix_boundary.sql) said this in its
-- header before the deploy existed; this file is that promise being kept.
--
-- Getting this wrong in the merge direction would date the boundary earlier than
-- the correction, putting a window of still-broken data on the trusted side of
-- the line. That is the direction that flatters: it makes the pre-fix days look
-- like they belong to the corrected series.
--
-- PRODUCTION WAS CONFIRMED SERVING THE STUB BEFORE THIS RAN, not merely built:
--   GET https://www.findmybasket.co.uk/fmb-gtag-stub.js  -> 200 (was 404)
--   the rendered <head> carries <script src="/fmb-gtag-stub.js"> with no defer
--   or async, ahead of <script src="/fmb-cookie-banner.js" defer>, on both the
--   home page and a runtime-rendered search page.
-- "Vercel says success" is not the same claim: a green build with the file still
-- 404ing at the edge is exactly the state this row would have mislabelled.
--
-- WHAT THIS DOES NOT DO. It does not un-suppress the five affected metrics on
-- the dashboard, and it does not make the earlier series comparable. It marks
-- where the series changes meaning. Everything before 2026-07-29 14:12:58Z is
-- biased low by an unknown factor; everything after is trustworthy. Do not
-- compare across the line, and read any jump here as a correction, not growth.
--
-- IDEMPOTENT BY CONSTRUCTION: the timestamp is a hard-coded literal, never
-- now(). Replaying this on a PITR restore writes the same instant it wrote the
-- first time. Do not "improve" this by substituting now() or CURRENT_TIMESTAMP;
-- that would re-date the boundary to the restore, silently.
--
-- Keyed on title, which carries the UNIQUE constraint (convention 6). The id is
-- asserted rather than used as the key, because ids are not stable across a
-- rebuild and a WHERE id = 17 that matches nothing would update zero rows and
-- report success.

UPDATE public.platform_changes
   SET status     = 'occurred',
       changed_at = TIMESTAMPTZ '2026-07-29 14:12:58+00'
 WHERE title = 'GA4 gtag hydration race fix';

-- --- Verification (convention 4: assert, do not assume) --------------------
DO $$
DECLARE
  r record;
  n_other_occurred int;
  n_still_expected int;
BEGIN
  SELECT id, changed_at, status INTO r
  FROM public.platform_changes
  WHERE title = 'GA4 gtag hydration race fix';

  -- An UPDATE whose WHERE matches nothing succeeds and reports success. This is
  -- the only thing standing between that and a boundary that was never flipped.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the gtag race boundary row is absent; the UPDATE matched nothing';
  END IF;

  IF r.status <> 'occurred' THEN
    RAISE EXCEPTION 'gtag race boundary still reads status %, expected ''occurred''', r.status;
  END IF;
  IF r.changed_at IS DISTINCT FROM TIMESTAMPTZ '2026-07-29 14:12:58+00' THEN
    RAISE EXCEPTION 'gtag race boundary carries changed_at %, expected the deploy instant 2026-07-29 14:12:58+00', r.changed_at;
  END IF;
  IF r.id <> 17 THEN
    RAISE NOTICE 'gtag race boundary is id % rather than the 17 recorded at insert time (expected only after a rebuild)', r.id;
  END IF;

  -- The other six boundaries must not have moved. A flip that also disturbed a
  -- neighbouring row would be invisible in the check above. Named explicitly
  -- rather than counted by a predicate (convention 3): the first draft of this
  -- file asserted "2 other occurred rows", inferred from a truncated listing
  -- that hid id 1, and convention 5's dry run is what caught it.
  SELECT count(*) INTO n_other_occurred
  FROM public.platform_changes
  WHERE status = 'occurred'
    AND title IN ('Savings and catalogue baseline reset',
                  'GA4 by-network series start',
                  'Server-side event logging start');
  IF n_other_occurred <> 3 THEN
    RAISE EXCEPTION 'expected the 3 pre-existing occurred boundaries (ids 1, 7, 12) intact, found %', n_other_occurred;
  END IF;

  SELECT count(*) INTO n_still_expected
  FROM public.platform_changes
  WHERE status = 'expected' AND changed_at IS NULL
    AND title IN ('Browse search total_count cutover',
                  'AWIN product_GTIN importer fix',
                  'Niche Beauty retailer go-live');
  IF n_still_expected <> 3 THEN
    RAISE EXCEPTION 'expected the 3 undated boundaries (ids 2, 3, 4) untouched, found %', n_still_expected;
  END IF;

  RAISE NOTICE 'OK: gtag race boundary occurred at % (deploy of 4c9aa0a)', r.changed_at;
END
$$;
