-- Per-RPC statement_timeout for the PK-keyed bulk UPDATE RPCs the importers call
-- via service_role. All three inherit the 8s authenticator/authenticated default
-- (service_role has no override of its own). Under DB I/O pressure a chunk's
-- UPDATE can run past 8s and be cancelled ("canceling statement due to statement
-- timeout"), surfacing as intermittent import 500s / error_count>0.
--
-- This is a PRE-EXISTING inline-path defect: statement timeouts were observed on
-- the inline path (07:13, 07:13, 07:22 UTC on 2026-06-23) before any retailer was
-- flipped to storage_passthrough. The passthrough canary 2 forced multi-slice
-- test simply made it reliably reproducible.
--
-- Surgical fix: raise the cap for THESE THREE FUNCTIONS ONLY. We deliberately do
-- NOT touch the global authenticator/authenticated 8s default — the tight default
-- protects unrelated paths from silent slow-query regressions.
--
-- ALTER FUNCTION ... SET adds to proconfig, so bulk_update_product_descriptions
-- keeps its existing search_path=public setting.
--
-- Paired with the importer change reducing the image-update flush to
-- IMAGE_UPDATE_CHUNK=150; descriptions already chunk at 150 (DESC_FLUSH/DESC_CHUNK).
--
-- REVERSIBLE per-function: if any regression appears, run
--   alter function public.<fn>(<args>) set statement_timeout = '0';   -- (0 = inherit)
-- or `reset statement_timeout` in a follow-up migration to restore the 8s default.

alter function public.bulk_update_product_images(jsonb)
  set statement_timeout = '30s';

alter function public.bulk_update_product_descriptions(jsonb)
  set statement_timeout = '30s';

alter function public.bulk_update_retailer_prices(jsonb)
  set statement_timeout = '30s';
