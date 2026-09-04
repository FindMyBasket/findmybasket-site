-- The Fragrance Shop (35) was the only ACTIVE retailer with absence_threshold_days = NULL.
--
-- THIS CHANGES NO BEHAVIOUR, AND THAT IS THE POINT. fmb_apply_absence_handling reads
-- COALESCE(absence_threshold_days, 30), so NULL was already 30 -- it was never "no deadline",
-- and 9999 (YesStyle, Boots-as-seeded) is the value that means never. Storing 30 makes the
-- effective value the stated one, so the column can be read as the answer instead of as a
-- question the function answers elsewhere.
--
-- 30 AND NOT 7, THOUGH 7 IS THE HOUSE MAJORITY (seven of thirteen active retailers).
-- Those values are CALIBRATED, not conventional: 20260721180000 set them by sampling how many
-- prices still matched after N days -- "Boots: calibrated value is 7 (fresh 1-5d held, 13d+
-- gone/wrong)", "YesStyle: calibrated value is 0 (0/13 matched even at 3 days)". THE FRAGRANCE
-- SHOP HAS ONE IMPORT AND NO SAMPLE, so 7 would be an uncalibrated number wearing the
-- authority of a calibrated one. Its fragrance peers sit at 21 (Escentual) and 30 (Perfume
-- Click). 30 asserts only what the code already does.
--
-- ── IT DOES NOT FIX THE DRIFT, AND SHOULD NOT BE READ AS HAVING FIXED IT ──────
--
-- fmb_apply_absence_handling is called from ONE place: supabase/functions/_shared/run-metrics.ts,
-- at the end of an import run. There is no scheduled sweep. So absence handling on a retailer
-- with no cron NEVER RUNS, whatever this column says. The Fragrance Shop's 3,199 rows are
-- stale because nothing refreshes them (item 578), not because this column was NULL, and this
-- migration moves that date by zero days.
--
-- WHAT IT DOES BUY is that the first scheduled run behaves as a reviewer would expect rather
-- than as an unstated default. And GUARD c_min_baseline = 3 means absence handling is SKIPPED
-- until three runs are logged, so the first refreshes cannot mass-flip a catalogue that has
-- gone 30+ days unseen. Calibrate against a real sample once those runs exist; until then this
-- value is a placeholder that is honest about being one.
update public.retailer_import_config
   set absence_threshold_days = 30,
       updated_at = now()
 where retailer_id = 35
   and absence_threshold_days is null;
