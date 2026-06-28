-- Match-key tokenisation, mirrored from the importer JS (buildMatchKey).
-- These IMMUTABLE helpers let the backfill regenerate products.match_key with
-- byte-identical output to what the awin/rakuten/shopify importers now write on
-- insert, so a freshly imported row and a backfilled row for the same product
-- carry the same key. Kept aligned with fmb_match_brand for the brand path.
--
-- JS reference (supabase/functions/import-awin-feed/index.ts):
--   normaliseForMatch: lower -> [^a-z0-9]+ to space -> trim/collapse
--   stripPromoTags(name): remove bracketed [Deal]/[Sale]/... before normalising
--   stripContainerNouns(norm): remove tube|bottle|jar|pump (NOT pack/set)
--   buildMatchKey: brand-prefix dedup, else "brand name"

CREATE OR REPLACE FUNCTION fmb_normalise_for_match(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- Same shape as fmb_match_brand: C collation so [^a-z0-9] is ASCII-only and
  -- the JS [^a-z0-9] behaviour is reproduced exactly. The '+' collapses runs of
  -- non-alphanumerics to a single space; btrim removes the edges.
  SELECT btrim(regexp_replace((lower(coalesce(input, '')) COLLATE "C"), '[^a-z0-9]+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION fmb_build_match_key(brand text, name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH parts AS (
    SELECT
      fmb_normalise_for_match(brand) AS nb,
      -- name path: strip bracketed promo tags on the RAW name (case-insensitive),
      -- normalise, then strip container nouns and re-collapse the spaces.
      btrim(regexp_replace(
        regexp_replace(
          fmb_normalise_for_match(
            regexp_replace(
              coalesce(name, ''),
              '\[\s*(deal|sale|new|hot|clearance|limited|gift|exclusive)\s*\]',
              ' ',
              'gi'
            )
          ),
          '\y(tube|bottle|jar|pump)\y',
          ' ',
          'g'
        ),
        '\s+', ' ', 'g'
      )) AS nn
  )
  SELECT CASE
    WHEN nb <> '' AND left(nn, length(nb) + 1) = nb || ' ' THEN nn  -- brand already prefixes name
    WHEN nb <> '' AND nn = nb                                THEN nb  -- name IS the brand
    ELSE btrim(nb || ' ' || nn)
  END
  FROM parts;
$$;
