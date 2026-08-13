-- session_id stays a column with 406 and 769 NULLs, and the schema now says why.
--
-- WITHOUT THIS COMMENT THE NEXT PERSON PROPOSES POPULATING IT — which is exactly how
-- work-list item 82 started: a NULL column with an obvious-looking fix, an uncalled
-- writer sitting beside it, and a module header stating a capability that has never
-- worked. All three read as a defect. It is a decision.
--
-- The reasoning lives in the column comment rather than only in the work list, because
-- the person who reaches for this will be reading the schema (item 66's clause: a
-- control recorded where the failure will not travel is decoration). The RoutineBuilder
-- comment that already diagnosed this correctly, and sat where nobody would pass, is
-- the third instance of that shape — see item 82.
--
-- No behaviour changes. Comments only.

COMMENT ON COLUMN public.outbound_clicks.session_id IS
  'NULL on every row, BY DECISION rather than omission - see work-list item 82. The writer (ensureSessionId, a 180-day first-party cookie) was removed 13 Aug 2026 and will not return. A consented cookie would gate on the same analytics toggle GA4 does, so it would cover exactly the population GA4 already covers - and GA4 stitches sessions natively for those visitors. Its one distinguishing property, covering refusers, is precisely what the consent gate removes. With the consenting share at 65% -> 52% -> 34% over three weeks, a funnel visible only to that subset cannot separate a falling conversion rate from falling consent. For consenting visitors the funnel question is answered in GA4; for refusers it is not available by any means we would accept, which is a LIMIT and not a gap. NULL here means never recorded, not "no session". Do not propose populating this without reading item 82 and privacy.html section 2.2.';

COMMENT ON COLUMN public.search_events.session_id IS
  'NULL on every row, BY DECISION rather than omission - same reasoning as outbound_clicks.session_id and work-list item 82. Additionally: this table is written from app/search/page.tsx, an async SERVER component that logs during render, so a client-side identifier (sessionStorage) could never reach it anyway. That server/client split, not the privacy posture, was the deciding constraint against the sessionStorage option. NULL means never recorded, not "no session".';

-- --- Verification (convention 4: assert, do not assume) ----------------------
DO $$
DECLARE a text; b text;
BEGIN
  SELECT col_description('public.outbound_clicks'::regclass,
    (SELECT attnum FROM pg_attribute WHERE attrelid='public.outbound_clicks'::regclass AND attname='session_id')) INTO a;
  SELECT col_description('public.search_events'::regclass,
    (SELECT attnum FROM pg_attribute WHERE attrelid='public.search_events'::regclass AND attname='session_id')) INTO b;
  IF a IS NULL OR a NOT LIKE '%item 82%' THEN RAISE EXCEPTION 'outbound_clicks.session_id comment did not land'; END IF;
  IF b IS NULL OR b NOT LIKE '%SERVER component%' THEN RAISE EXCEPTION 'search_events.session_id comment did not land'; END IF;
  RAISE NOTICE 'session_id comments recorded on both tables';
END $$;
