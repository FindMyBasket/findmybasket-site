-- Gorgeous Shop — retailer 30. AWIN feed id rotation: 110188 -> 116876.
--
-- Symptom: import failed 404 Not Found on fid 110188. Last successful run
-- 1 Aug 2026 06:15; the ~06:15 run on 2 Aug 2026 failed and was caught by the
-- 09:00 monitor (~3h detection, the loud-failure class — the silent-kill class
-- runs 26h+ before anyone notices). 6,710 in-stock rows were left stale.
--
-- Cause: AWIN reissued the datafeed under a new id. The programme is LIVE, so
-- this is a config change only — no retailer closure sequence.
--
-- awin_merchant_id (advertiser 53379) is unchanged: only the datafeed id moved.
-- feed_url stays NULL — the importer builds the URL from awin_feed_id via
-- buildFeedUrl() in supabase/functions/import-awin-feed/index.ts.
--
-- NOTE: 20260720140000_gorgeous_shop_onboarding.sql still carries the literal
-- '110188' in an ON CONFLICT (retailer_id) DO UPDATE. Re-running that migration
-- would revert this change. This migration must win by ordering.

UPDATE retailer_import_config
   SET awin_feed_id = '116876'
 WHERE retailer_id = 30
   AND awin_feed_id = '110188';
