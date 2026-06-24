-- Frontend product-query performance indexes. Two composite PARTIAL indexes on
-- products, scoped to the products_active view predicates
-- (merged_into IS NULL AND parent_product_id IS NULL). Surfaced by the PR #38
-- canary 2 investigation (frontend PostgREST queries hitting the 8s statement
-- timeout at an ongoing rate).
--
-- (1) idx_products_brand_producttype: serves the related-products query on
--     product detail pages. pg_stat_statements showed 768k calls with max
--     latency pinned at ~7.9s. Before: idx_products_product_type only, then a
--     heap filter on brand. After: direct index scan on (brand, product_type).
--     Verified empirically: 49 -> 8 shared buffers on Bluesky|Nail Polish, with
--     a far larger win for common product_types where the brand heap-filter
--     scans thousands of rows.
--
-- (2) idx_products_topcat_subcat: serves the category/subcategory products-side
--     filter (replaces a bitmap-AND of two single-column indexes) and supports
--     the embed-inversion query rewrites in this PR's second commit.
--
-- APPLY OUTSIDE A TRANSACTION. CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block, so apply this non-transactionally (the MCP execute_sql path
-- runs statements in autocommit and was verified to build these online without
-- locking products; do NOT wrap in begin/commit or run through a transactional
-- migration runner). IF NOT EXISTS makes re-runs safe.
-- Reversible: drop index concurrently if exists <name>;

create index concurrently if not exists idx_products_brand_producttype
  on products (brand, product_type)
  where merged_into is null and parent_product_id is null;

create index concurrently if not exists idx_products_topcat_subcat
  on products (top_category, subcategory)
  where merged_into is null and parent_product_id is null;
