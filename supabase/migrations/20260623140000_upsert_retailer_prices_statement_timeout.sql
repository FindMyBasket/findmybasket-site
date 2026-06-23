-- Follow-up to 20260623130000. Extends the per-RPC statement_timeout headroom to
-- upsert_retailer_prices_lowest, the link-flush upsert the importers call via
-- service_role. Surfaced by the PR #38 canary 2 investigation (2026-06-23): it is
-- the same risk shape as the three RPCs already raised in 20260623130000 — a
-- single bulk `INSERT ... ON CONFLICT (product_id, retailer_id) DO UPDATE`, keyed
-- on the unique index retailer_prices_product_retailer_uniq, run by service_role
-- through PostgREST under the inherited 8s authenticator cap. Under DB I/O
-- pressure its UPDATE can exceed 8s and be cancelled, the same failure class.
--
-- match_chunk_lookups was evaluated and deliberately EXCLUDED:
--   * it is a STABLE read (SELECT building jsonb), not a PK-keyed UPDATE;
--   * its match_brand and external_product_id lookups are index-covered
--     (idx_products_match_brand, idx_rp_external_product_id);
--   * its ean/mpn lookups resolve through the ean_product_index /
--     mpn_product_index VIEWS (not directly-indexable base tables);
--   * it shows no timeout-pattern evidence in pg_stat_statements (absent from
--     the >5s tail).
-- No change for it.
--
-- The global authenticator/authenticated 8s default is intentionally untouched so
-- unrelated paths keep the tight cap. Reversible per-function:
--   alter function public.upsert_retailer_prices_lowest(jsonb, timestamp without time zone)
--     reset statement_timeout;

alter function public.upsert_retailer_prices_lowest(jsonb, timestamp without time zone)
  set statement_timeout = '30s';
