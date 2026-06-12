-- Streaming importer rollout feature flag.
--
-- When true, import-awin-feed processes the feed via the streaming I/O pipeline
-- (incremental fetch -> incremental gzip inflate -> streaming CSV parse) instead
-- of loading the whole decompressed feed into memory. Default false so every
-- retailer stays on the proven legacy path until explicitly promoted, one
-- `UPDATE retailer_import_config SET streaming_enabled = true WHERE retailer_id = N`
-- at a time. Flipping back to false is the per-retailer rollback.
--
-- Mirrors the existing existing_brands_only boolean (NOT NULL, default false).
alter table retailer_import_config
  add column if not exists streaming_enabled boolean not null default false;

comment on column retailer_import_config.streaming_enabled is
  'When true, import-awin-feed uses the streaming I/O pipeline (bounded memory) instead of the legacy load-whole-feed path. Rollout flag; default false.';
