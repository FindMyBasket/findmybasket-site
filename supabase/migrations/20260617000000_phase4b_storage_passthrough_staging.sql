-- Phase 4b — storage-passthrough staging for very large gzipped feeds (Boots, #23).
-- See boots-staging-redesign plan. The Phase 4 inline stage 546s on Boots because
-- pako inflate + per-row CSV parse + JSON.stringify + many slice uploads all run in
-- ONE invocation. Phase 4b splits that into Phase A (mode='stage': ungzip once →
-- one inflated.txt blob) + Phase B (mode='split': byte-range read that blob in
-- bounded, self-chaining passes → slice files). Per-retailer opt-in, mirrors
-- sliced_import. Phase C (slice processing) is unchanged. No new infra table:
-- Phase A/B reuse import_run_state.meta (new keys: staging_mode, inflated_blob_path,
-- inflated_total_bytes, next_byte_offset, next_slice_write) and the existing
-- import-staging bucket + fmb_invoke_import_slice trigger.

-- 1. Per-retailer staging strategy. Default 'inline' → every sliced retailer keeps
--    the Phase 4 single-pass stage until explicitly promoted to 'storage_passthrough'.
ALTER TABLE retailer_import_config
  ADD COLUMN IF NOT EXISTS staging_mode text NOT NULL DEFAULT 'inline';

ALTER TABLE retailer_import_config
  DROP CONSTRAINT IF EXISTS retailer_import_config_staging_mode_chk;
ALTER TABLE retailer_import_config
  ADD CONSTRAINT retailer_import_config_staging_mode_chk
  CHECK (staging_mode IN ('inline', 'storage_passthrough'));

-- 2. Raise the staging bucket's per-file limit to 200MB: Phase A uploads the whole
--    inflated feed as one blob (Boots is tens of MB inflated), above the 50MB
--    project default. Slice files stay small; this only matters for inflated.txt.
UPDATE storage.buckets SET file_size_limit = 209715200 WHERE id = 'import-staging';
