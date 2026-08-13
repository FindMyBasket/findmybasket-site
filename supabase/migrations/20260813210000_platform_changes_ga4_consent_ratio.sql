-- platform_changes: metrics_ga4_weekly's outbound-click columns measure the CONSENTING
-- SUBSET of visitors, not clicks.
--
-- WRITTEN ALONGSIDE THE ARMING OF ga4-weekly-pull.yml, deliberately in the same PR. The
-- series starts accumulating on the next Monday; this row is what stops the column being
-- read as a click count from the first week onward rather than after someone notices.

-- `id` is GENERATED ALWAYS, so it is NOT supplied here: forcing a value would either
-- be rejected or, with OVERRIDING SYSTEM VALUE, desync the identity sequence and make
-- the next insert collide. The row lands as id 34 because the sequence is at 33; the
-- verification block below reads the id back rather than assuming it.
INSERT INTO public.platform_changes (changed_at, status, title, description)
VALUES (
  '2026-08-13'::timestamptz,
  'occurred',
  'GA4 outbound-click columns measure the consenting subset, not clicks',
$d$WHAT THE COLUMNS ARE. metrics_ga4_weekly.outbound_clicks_awin / _rakuten / _amazon /
_other come from GA4, which fires only after a visitor accepts analytics consent. The
server-side table public.outbound_clicks writes on every click regardless of consent, and
regardless of whether an ad blocker prevented gtag from loading at all.

SO GA4 OVER SERVER-SIDE IS THE CONSENT-PLUS-BLOCKER RATE. It is a fact about visitors, not
a fault in the instrument.

MEASURED 13 AUGUST 2026, AWIN clicks, GA4 against server-side for the same ISO weeks:

  week_start   GA4   server-side   consenting share
  2026-07-20    78          120          65%
  2026-07-27    26           50          52%
  2026-08-03    17           50          34%

Amazon, same weeks: 6/7 (86%), 8/13 (62%), 12/17 (71%). The Amazon links are a separate
component and their rate is both higher and steadier, which is itself worth a look.

THE READING THAT IS WRONG. "GA4 under-counts AWIN clicks by a widening margin" and "the
consenting share of visitors is falling" are the SAME NUMBERS and DIFFERENT FINDINGS. Only
the second is actionable, and only the second is true. The instrument is behaving exactly
as designed.

THE READING THAT IS ALSO WRONG. GA4 AWIN clicks fell 78 -> 26 -> 17 across these weeks
while sessions stayed flat (135/159/145) and qualified_sessions and comparison_views ROSE.
That is not a collapse in outbound clicking. Server-side AWIN clicks went 120 -> 50 -> 50:
one real fall from an unusually high week, then FLAT. The 13 July week was 43, so 120 is
the outlier and 50 is the level.

RETAILER MIX IS NOT THE CAUSE, and the timing was suggestive enough to check. Superdrug
(r12) retired 27 July and Branded Beauty (r6) closed 1 August, both AWIN, both inside the
window. Server-side clicks across the four weeks from 13 July: r12 = 3, 0, 0, 0 and
r6 = 2, 2, 1, 0. Between them, two clicks in the window that matters. All of the movement
is in other AWIN retailers: 118 -> 49.

OPEN, AND NOT BLOCKING. platform_changes id 17 (GA4 gtag hydration race fix, 29 July) sits
exactly between the 27 July and 3 August weeks and predicts the OPPOSITE SIGN: a fix that
rescues dropped events should RAISE capture, and capture fell 52% -> 34% across it. Either
the fix regressed something or a second effect swamped it. The leading hypothesis is the
consent gate itself — the stub queues events and discards them outright on refusal, so a
falling capture rate is a falling ACCEPTANCE rate, which is a visitor-behaviour question
rather than a code one.

WHAT TO DO WITH THE COLUMNS. Use them for TREND and MIX, not for volume. For a click count,
use public.outbound_clicks, which has no consent gate. Where both are quoted, quote the
ratio too, because the ratio is the only proxy this project currently has for consent
acceptance.$d$
);

-- --- Verification (convention 4: assert, do not assume) ----------------------
DO $$
DECLARE n int; got_id int;
BEGIN
  SELECT count(*), max(id) INTO n, got_id FROM public.platform_changes
   WHERE title = 'GA4 outbound-click columns measure the consenting subset, not clicks';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one consent-ratio boundary row, found %', n;
  END IF;
  RAISE NOTICE 'consent-ratio boundary row recorded as platform_changes id %', got_id;
END $$;
