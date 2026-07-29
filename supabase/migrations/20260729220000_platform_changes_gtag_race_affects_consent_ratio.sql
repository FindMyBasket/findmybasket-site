-- platform_changes id 17: add consent_ratio to metrics_affected.
--
-- WHAT WAS WRONG. The build brief argued that the gtag hydration-race fix was
-- NOT a boundary on the measured-consent-rate series, on the grounds that the
-- stub "does not recover refusing visitors" so the numerator keeps its meaning.
-- Both halves of that are true. The conclusion still does not follow, because it
-- reasons about the wrong population.
--
-- The consent ratio is GA4 retailer_click (consenting visitors) over server-side
-- outbound_clicks (everyone), per ISO week. The group the argument omitted is the
-- visitor who has NOT YET ANSWERED the banner:
--
--   Before the fix, window.gtag was defined only inside loadAnalytics() in
--   public/fmb-cookie-banner.js, which runs ONLY on a grant. An undecided
--   visitor's retailer_click therefore met the `typeof gtag !== 'function'`
--   guard in lib/analytics.ts and was dropped, while sendOutboundBeacon fired
--   regardless. The denominator kept that click and the numerator lost it.
--
--   After the fix the same click queues in public/fmb-gtag-stub.js and REPLAYS
--   if the visitor subsequently accepts.
--
-- The replay survives the click only because every outbound path leaves the
-- originating page alive: ClickOutLink defaults to target = '_blank'
-- (components/ClickOutLink.tsx:34, a default parameter, which is why no call
-- site passes it and none of them read as new-tab links) and the optimiser uses
-- window.open(..., '_blank') (app/app/RoutineBuilder.tsx:663). Had those
-- navigated the current tab, the queue would have died on unload and the brief's
-- claim would have been right by accident. If anyone ever changes those to
-- same-tab, this boundary stops accumulating and that is a separate change of
-- meaning, not a bug fix.
--
-- DIRECTION: the ratio STEPS UP at the boundary instant. Magnitude unmeasured.
-- This is the flattering-boundary class: a rising consent rate reads as good
-- news and invites nobody to check it. It also matters more than most, because
-- this indicator is the correction factor for every other GA4 figure on the
-- dashboard AND the cross-check that separates "view_item is broken" from
-- "consent is low". Left unrecorded it would have made the five newly
-- un-suppressed metrics look better than they are, in the same week they came
-- back on screen.
--
-- WHY NOT A NEW ROW. It is the same event at the same instant, already recorded
-- with the deploy timestamp in 20260729200000. Only the affected-metric list was
-- incomplete. A second row would imply a second change and would render as a
-- second marker on every trend chart.
--
-- IDEMPOTENT: the target array is written as a hard-coded literal, not appended
-- to whatever is there. Replaying yields the identical array rather than
-- consent_ratio twice, and it cannot silently inherit a list edited elsewhere
-- (convention 3: a migration reproduces a known state, it does not compute one).
--
-- Keyed on title, which carries the UNIQUE constraint (convention 6). The id is
-- asserted, not used as the key: ids are not stable across a rebuild, and a
-- WHERE id = 17 matching nothing would update zero rows and report success.

UPDATE public.platform_changes
   SET metrics_affected = ARRAY[
         'view_item',
         'qualified_sessions',
         'comparison_views',
         'session_to_comparison_rate',
         'comparison_view_to_outbound_click_rate',
         'search_to_comparison_rate',
         'consent_ratio'
       ]
 WHERE title = 'GA4 gtag hydration race fix';

-- --- Verification (convention 4: assert, do not assume) --------------------
DO $$
DECLARE
  r record;
  n_consent_ratio int;
BEGIN
  SELECT id, status, changed_at, metrics_affected INTO r
  FROM public.platform_changes
  WHERE title = 'GA4 gtag hydration race fix';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'the gtag race boundary row is absent; the UPDATE matched nothing';
  END IF;

  IF NOT (r.metrics_affected @> ARRAY['consent_ratio']) THEN
    RAISE EXCEPTION 'consent_ratio missing from metrics_affected after the UPDATE: %', r.metrics_affected;
  END IF;

  -- Guard the idempotency claim directly rather than trusting the literal.
  -- An append-style rewrite would pass the containment check above on the
  -- second run while quietly duplicating the entry.
  SELECT count(*) INTO n_consent_ratio
  FROM unnest(r.metrics_affected) AS m
  WHERE m = 'consent_ratio';
  IF n_consent_ratio <> 1 THEN
    RAISE EXCEPTION 'consent_ratio appears % times in metrics_affected; the write is not idempotent', n_consent_ratio;
  END IF;

  -- The six original entries must all survive. A rewritten literal that dropped
  -- one would satisfy every check above.
  IF NOT (r.metrics_affected @> ARRAY[
            'view_item',
            'qualified_sessions',
            'comparison_views',
            'session_to_comparison_rate',
            'comparison_view_to_outbound_click_rate',
            'search_to_comparison_rate']) THEN
    RAISE EXCEPTION 'the six original metrics_affected entries did not all survive: %', r.metrics_affected;
  END IF;

  IF array_length(r.metrics_affected, 1) <> 7 THEN
    RAISE EXCEPTION 'expected exactly 7 metrics_affected entries, found %', array_length(r.metrics_affected, 1);
  END IF;

  -- This migration must not touch the boundary itself. Asserting what must NOT
  -- change is the other half of convention 4.
  IF r.status <> 'occurred'
     OR r.changed_at IS DISTINCT FROM TIMESTAMPTZ '2026-07-29 14:12:58+00' THEN
    RAISE EXCEPTION 'the boundary moved: status %, changed_at % (expected occurred at 2026-07-29 14:12:58+00)',
      r.status, r.changed_at;
  END IF;

  IF r.id <> 17 THEN
    RAISE NOTICE 'gtag race boundary is id % rather than the 17 recorded at insert time (expected only after a rebuild)', r.id;
  END IF;

  RAISE NOTICE 'OK: consent_ratio recorded against the gtag race boundary at %', r.changed_at;
END
$$;
