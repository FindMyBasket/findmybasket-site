-- Phase 4 (Option C) — sliced / resumable import infrastructure.
-- See PHASE_4_SLICED_IMPORT_DESIGN.md. Design decisions locked 2026-06-15:
-- JSONL uncompressed slices; don't persist createdByMatchKey; pg_net self-POST;
-- SLICE_ROWS=9000 (knob→6000); no crash-resume in v1; per-retailer flag.

-- 1. Cross-slice state. meta row holds run_started_at / total_slices / next_slice /
--    creates_enqueued / counters; 'url' rows hold createdUrls (Tier-5 shade
--    suppression — the one accumulator that must persist, §5). seenEan/Mpn are
--    DB-covered (committed slices show in the ean/mpn_product_index views) and
--    createdByMatchKey is intentionally NOT persisted (benign link-vs-skip delta).
CREATE TABLE IF NOT EXISTS import_run_state (
  run_id      text        NOT NULL,
  retailer_id integer      NOT NULL,
  kind        text        NOT NULL,            -- 'meta' | 'url'
  key         text        NOT NULL DEFAULT '', -- url for kind='url'; '' for meta
  meta        jsonb,                            -- meta row payload only
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, kind, key)
);
CREATE INDEX IF NOT EXISTS idx_import_run_state_run ON import_run_state (run_id, kind);
-- Supports the monitor-feeds 24h orphan cleanup.
CREATE INDEX IF NOT EXISTS idx_import_run_state_created ON import_run_state (created_at);
GRANT ALL ON import_run_state TO service_role;

-- 2. Per-retailer opt-in (like streaming_enabled). Default false → every retailer
--    keeps the single-invocation path until explicitly promoted.
ALTER TABLE retailer_import_config
  ADD COLUMN IF NOT EXISTS sliced_import boolean NOT NULL DEFAULT false;

-- 3. Private Storage bucket for staged slice files (import-staging/<run_id>/slice_N.jsonl).
--    service_role bypasses storage RLS, so no bucket policies are needed for the
--    importer's own reads/writes.
INSERT INTO storage.buckets (id, name, public)
VALUES ('import-staging', 'import-staging', false)
ON CONFLICT (id) DO NOTHING;

-- 4. Self-trigger helper (pg_net). The importer calls this at the end of a slice to
--    fire the next slice (or it's used to kick slice 0 after staging). pg_net is
--    fire-and-forget from the DB, so the parent worker can return immediately —
--    this is what decouples slice lifetimes and avoids one long invocation. Mirrors
--    the existing refresh-* cron net.http_post pattern (vault service_role_key).
CREATE OR REPLACE FUNCTION fmb_invoke_import_slice(p_body jsonb)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT net.http_post(
    url := 'https://crtrjoescntlcjiwdtrt.supabase.co/functions/v1/import-awin-feed',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := p_body,
    timeout_milliseconds := 300000
  );
$$;
GRANT EXECUTE ON FUNCTION fmb_invoke_import_slice(jsonb) TO service_role;
