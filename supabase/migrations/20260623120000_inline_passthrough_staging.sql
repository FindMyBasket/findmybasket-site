





-- Inline → storage_passthrough staging migration (large-feed resilience track).
--
-- Moves six inline AWIN retailers onto the storage_passthrough staging path
-- (Phase A stage → Phase B split → Phase C process) that Boots (23) has run
-- clean since 2026-06-17. Two motivations:
--   1. Large feeds stop 546-ing on the inline single-pass (parse+lookups+write
--      in one isolate); passthrough bounds each phase.
--   2. These retailers come under fmb_watchdog_stalled_imports coverage. The
--      watchdog only re-fires sliced/passthrough runs tracked in
--      import_run_state; inline retailers have no such row, so a stalled inline
--      import (e.g. Debenhams 28, 2026-06-23) is invisible to it today.
--
-- Config-only: the passthrough code path is already generic and gated per
-- retailer by these two columns. No schema DDL, no function change. The value
-- 'storage_passthrough' is already in use by Boots (23), so it satisfies the
-- existing staging_mode constraint.
--
-- ROLLOUT IS A CANARY, NOT A BIG-BANG. Apply + validate one retailer at a time,
-- smallest feed first, in the order below — see the PR body for the runbook.
-- Each flip is independently reversible: set staging_mode back to 'inline'.
-- sliced_import is set true for all six (Phase C is the sliced processor and is
-- incoherent without it); it is already true for 11/25/27 and is flipped for
-- 8/24/28.

-- 1. The Organic Pharmacy (24) — 75 rows, degenerate single slice. First canary:
--    proves the path end-to-end with the least risk (validates the Beauty Bay
--    1-slice case for an AWIN retailer).
update retailer_import_config
  set staging_mode = 'storage_passthrough', sliced_import = true
  where retailer_id = 24;

-- 2. Escentual (8) — ~5k catalog, sliced_import was false.
update retailer_import_config
  set staging_mode = 'storage_passthrough', sliced_import = true
  where retailer_id = 8;

-- 3. Beauty Flash (27) — ~6.6k catalog, already sliced.
update retailer_import_config
  set staging_mode = 'storage_passthrough', sliced_import = true
  where retailer_id = 27;

-- 4. Debenhams (28) — awin format + storage:// feed source, sliced_import was
--    false. Phase A handles storage:// identically (explicit storage download
--    branch + content-sniffed gzip decode); verified config-only, no code change.
update retailer_import_config
  set staging_mode = 'storage_passthrough', sliced_import = true
  where retailer_id = 28;

-- 5. Stylevana (11) — ~10.6k catalog, actively 546-prone. A primary beneficiary.
update retailer_import_config
  set staging_mode = 'storage_passthrough', sliced_import = true
  where retailer_id = 11;

-- 6. YesStyle (25) — ~11.3k catalog, actively 546/500-prone. A primary beneficiary.
update retailer_import_config
  set staging_mode = 'storage_passthrough', sliced_import = true
  where retailer_id = 25;

-- Branded Beauty (6) is intentionally NOT migrated here. It is google_shopping
-- (not awin) fed from storage://; Phase A's ungzip/parse is unproven for that
-- shape. It is handled as a separate spike.
