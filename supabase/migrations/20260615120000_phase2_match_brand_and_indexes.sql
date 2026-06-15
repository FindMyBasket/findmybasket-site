-- Phase 2 (chunked apply) — prerequisite DDL: option A1 from PHASE_2_CHUNKED_APPLY.md §3.1.
--
-- WHY: the per-chunk catalogue lookup filters products by brand. The importer's
-- JS match key is built from normaliseForMatch(brand), which strips apostrophes
-- AND accents to spaces. products.normalised_brand is just lower(brand), which
-- KEEPS them. So `WHERE normalised_brand = ANY(<normaliseForMatch(brand)>)` would
-- miss exactly the accented/apostrophe brands beauty is full of (L'Oréal, Kiehl's,
-- Estée Lauder, …) and the importer would CREATE DUPLICATES instead of linking.
--
-- A1 closes the gap with a generated column that mirrors normaliseForMatch in SQL,
-- so the per-chunk filter becomes `WHERE match_brand = ANY($1)` with exact parity.
--
-- ┌─ TypeScript source being mirrored (import-awin-feed/index.ts:762) ───────────┐
-- │ function normaliseForMatch(s: string): string {                             │
-- │   return String(s || "")                                                    │
-- │     .toLowerCase()                                                           │
-- │     .replace(/[‘’“”]/g, "'")  // smart quotes → '        │
-- │     .replace(/[^a-z0-9]+/g, " ")                  // non-alnum → space       │
-- │     .trim()                                                                  │
-- │     .replace(/\s+/g, " ");                        // collapse runs           │
-- │ }                                                                            │
-- └──────────────────────────────────────────────────────────────────────────────┘
--
-- Parity notes:
--   * The smart-quote step is OMITTED here because it is output-neutral: a smart
--     quote (U+2018/19/1C/1D) is non-[a-z0-9], so it becomes a space in the next
--     step regardless of whether it was first rewritten to a straight apostrophe.
--     "L'Oréal" → "l or al" either way.
--   * COLLATE "C" forces the regex character range [a-z] to be interpreted as the
--     ASCII byte range. Without it, range matching under a UTF-8 collation can
--     treat accented letters as "in range" and KEEP them, breaking parity — the
--     very failure mode A1 exists to prevent. lower() runs under the default
--     collation (ASCII A-Z lowercase identically); any accented char is stripped
--     in the regex step anyway, so the result is identical to the JS output.
--   * `[^a-z0-9]+` (with 'g') already collapses runs to a single space, so the JS
--     trim()+\s+ collapse reduces to a single btrim() here.

CREATE OR REPLACE FUNCTION fmb_match_brand(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE              -- REQUIRED: a STORED generated column's expression must be
PARALLEL SAFE          -- immutable. lower/regexp_replace/btrim are all immutable.
AS $$
  SELECT btrim(
           regexp_replace(
             (lower(coalesce(input, '')) COLLATE "C"),
             '[^a-z0-9]+',
             ' ',
             'g'
           )
         );
$$;

-- Generated, STORED, automatically backfilled by Postgres on ADD. No manual
-- backfill script (unlike the wider, mostly-empty match_key column the plan said
-- to avoid). NOTE: adding a STORED generated column REWRITES the products table
-- under an ACCESS EXCLUSIVE lock and rebuilds every existing index (incl. the two
-- GIN indexes). On 91,982 rows / ~40 MB heap this is on the order of ~10-30s, so
-- run it in a low-traffic window with no importer mid-run (it blocks all reads
-- and writes to products for the duration).
ALTER TABLE products
  ADD COLUMN match_brand text
  GENERATED ALWAYS AS (fmb_match_brand(brand)) STORED;

-- Supports the per-chunk `WHERE match_brand = ANY($1)` lookup (§4A).
CREATE INDEX idx_products_match_brand ON products (match_brand);

-- §5 prerequisite (separate from A1 but same Phase-2 DDL batch): the per-chunk
-- Tier-5 URL lookup needs an index on (retailer_id, url); none exists today.
CREATE INDEX idx_retailer_prices_retailer_url ON retailer_prices (retailer_id, url);

-- §5 note (no DDL): ean_product_index / mpn_product_index are VIEWS over
-- retailer_prices (SELECT DISTINCT ean_normalised AS ean, product_id ...). A
-- per-chunk `WHERE ean = ANY($1)` pushes the predicate down to the existing
-- idx_retailer_prices_ean_normalised / idx_retailer_prices_mpn_normalised base
-- indexes, so no extra index is required for them.
