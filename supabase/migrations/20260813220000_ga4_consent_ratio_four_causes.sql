-- CORRECTION to platform_changes id 34, written the same day it was.
--
-- WHAT WAS WRONG. The row called the GA4-over-server-side figure "the consent-plus-blocker
-- rate" and named two causes. There are at least FOUR, and the row omitted that
-- platform_changes id 17 had already FORECAST THE OPPOSITE SIGN for this exact series and
-- that the forecast failed.
--
-- A boundary row that under-names its causes LICENSES THE READING IT EXISTS TO PREVENT. Its
-- whole job is to stop "GA4 under-counts" being read as "consent is falling"; naming two of
-- four causes leaves it half doing that, and the half it leaves open is the one someone will
-- reach for, because a consent rate is the only one of the four that sounds like a metric.
--
-- Keyed on title, which carries the UNIQUE constraint (convention 6). The id is asserted,
-- not used as the key: a WHERE id = 34 matching nothing would update zero rows and report
-- success (the same reasoning as 20260729220000).

UPDATE public.platform_changes
   SET description = $d$WHAT THE COLUMNS ARE. metrics_ga4_weekly.outbound_clicks_awin /
_rakuten / _amazon / _other come from GA4, which fires only after a visitor accepts
analytics consent AND after gtag actually loads and runs. The server-side table
public.outbound_clicks writes on every click regardless of either.

THE RATIO IS NOT A CONSENT RATE. It is the CONSENT-AND-BLOCKER-AND-CODE-AND-BOT rate. Four
inputs multiply into one number:

  1. Consent refusals            NEVER MEASURABLE. See below.
  2. Ad blockers stopping gtag   Not separable from (1): both are "gtag never ran".
  3. Client-capture regressions  Not separable from (1) or (2): same signature again.
  4. Bot traffic on the server   Inflates the denominator only. Partly detectable.

CONSENT IS THE ONLY ONE OF THE FOUR THAT HAS NEVER BEEN MEASURABLE, and that is a property
of the design rather than an oversight. Measured 13 August 2026: the only network call in
public/fmb-cookie-banner.js or public/fmb-gtag-stub.js is loading gtag.js itself, and that
fires ONLY ON A GRANT. Consent lives in localStorage under 'fmb-cookie-consent',
deliberately not a cookie "since cookies need consent". A REFUSAL IS A PURELY CLIENT-SIDE
EVENT AND REACHES NO SERVER, EVER. outbound_clicks carries no consent column, and its
session_id is NULL on all 406 rows, so there is no visitor denominator in either direction.

WHAT THE RATIO CAN SUPPORT: "client-side capture of outbound clicks fell relative to
server-side, materially, over three weeks." That is real and worth watching.
WHAT IT CANNOT SUPPORT: "consent acceptance is falling." Consent is one of four
indistinguishable inputs and the only one never recorded.

MEASURED 13 AUGUST 2026, AWIN clicks, GA4 against server-side for the same ISO weeks:

  week_start   GA4   server-side   ratio
  2026-07-20    78          120     65%
  2026-07-27    26           50     52%
  2026-08-03    17           50     34%

Amazon, same weeks: 6/7 (86%), 8/13 (62%), 12/17 (71%) — a separate component, higher and
steadier.

A FAILED FORECAST, RECORDED BECAUSE IT IS MORE INFORMATIVE THAN NONE. platform_changes id 17
(GA4 gtag hydration race fix, 29 July) predicted this series would STEP UP at that boundary,
with reasoning: before the fix an undecided visitor's retailer_click met the
`typeof gtag !== 'function'` guard and was dropped while the server-side beacon fired, so
the denominator kept the click and the numerator lost it; after the fix the click queues in
the stub and REPLAYS on a later accept. Id 17 files this under the "flattering boundary"
class — a rising consent rate reads as good news and invites nobody to check it.

THE RATIO FELL ACROSS THAT BOUNDARY: 52% -> 34%. The forecast was specific, reasoned, dated
and wrong. Either the fix did not have the predicted effect, or a larger effect ran the
other way. UNRESOLVED, and not resolvable from stored data, because all three candidate
causes share one signature.

CAUSES RULED OUT BY MEASUREMENT, so nobody re-derives them:
  Source mix. product_page is 97% / 88% / 94% of AWIN clicks across the three weeks. Stable;
    cannot move the ratio.
  GA4 sampling. 17-78 events per week. Sampling engages millions of events away.
  Retailer mix. Superdrug (r12, retired 27 Jul) and Branded Beauty (r6, closed 1 Aug) are
    both AWIN and both left inside the window. Server-side clicks: r12 = 3,0,0,0 and
    r6 = 2,2,1,0 across the four weeks from 13 July. Two clicks between them. All the
    movement is in other AWIN retailers, 118 -> 49.

PARTLY SUPPORTED, ONE WEEK ONLY: the 20 July week has a busiest hour of 30 clicks and an
hourly standard deviation of 10.3, against 8/2.6 and 13/5.2 either side. A burst signature,
consistent with automated or single-session activity. It supports 120 being an OUTLIER
rather than a level — the 13 July week was 43 — and explains nothing about 27 July to
3 August, where server-side held at exactly 50 while GA4 fell 26 -> 17.

WHAT TO DO WITH THE COLUMNS. Use them for TREND and MIX, not for volume. For a click count
use public.outbound_clicks, which has no consent gate. Quote the ratio only as
client-capture share, never as a consent rate, until the beacon records consent state —
which would make refusals separable from blockers for the first time.$d$
 WHERE title = 'GA4 outbound-click columns measure the consenting subset, not clicks';

-- The title itself asserted the wrong reading, so it changes too.
UPDATE public.platform_changes
   SET title = 'GA4 outbound-click columns are a client-capture ratio, not a consent rate'
 WHERE title = 'GA4 outbound-click columns measure the consenting subset, not clicks';

-- --- Verification (convention 4: assert, do not assume) ----------------------
DO $$
DECLARE n int; got_id int; d text;
BEGIN
  SELECT count(*), max(id) INTO n, got_id FROM public.platform_changes
   WHERE title = 'GA4 outbound-click columns are a client-capture ratio, not a consent rate';
  IF n <> 1 THEN
    RAISE EXCEPTION 'expected exactly one client-capture boundary row, found %', n;
  END IF;
  IF got_id <> 34 THEN
    RAISE EXCEPTION 'expected the corrected row to be id 34, got % — check the row was not duplicated', got_id;
  END IF;

  SELECT description INTO d FROM public.platform_changes WHERE id = 34;
  IF d NOT LIKE '%CONSENT-AND-BLOCKER-AND-CODE-AND-BOT%' THEN
    RAISE EXCEPTION 'the four-cause naming did not land';
  END IF;
  IF d NOT LIKE '%FAILED FORECAST%' THEN
    RAISE EXCEPTION 'the id 17 failed-forecast line did not land';
  END IF;
  IF d LIKE '%consent-plus-blocker%' THEN
    RAISE EXCEPTION 'the superseded two-cause wording is still present';
  END IF;

  RAISE NOTICE 'platform_changes id 34 corrected: four causes named, failed forecast recorded';
END $$;
