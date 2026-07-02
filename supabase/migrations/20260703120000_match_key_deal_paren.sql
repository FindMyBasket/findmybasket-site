-- Extend fmb_build_match_key's promo-tag strip to the parenthesised "(Deal)" /
-- "(Sale)" forms, in addition to the bracketed "[Deal]" it already handled.
-- ~30 live rows carry a parenthesised flash-sale tag; without this they keep an
-- extra "deal" token in match_key and split off from the same product sold
-- without the tag.
--
-- PARITY: mirrors the JS PROMO_TAG_RE in supabase/functions/_shared/match-key.ts
--   /[\[(]\s*(?:deal|sale|new|hot|clearance|limited|gift|exclusive)\s*[\])]/gi
-- Either bracket style is accepted on each side (harmless, keeps it simple).
-- fmb_normalise_for_match is unchanged.

CREATE OR REPLACE FUNCTION fmb_build_match_key(brand text, name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH parts AS (
    SELECT
      fmb_normalise_for_match(brand) AS nb,
      -- name path: strip bracketed OR parenthesised promo tags on the RAW name
      -- (case-insensitive), normalise, then strip container nouns and re-collapse.
      btrim(regexp_replace(
        regexp_replace(
          fmb_normalise_for_match(
            regexp_replace(
              coalesce(name, ''),
              '[[(]\s*(deal|sale|new|hot|clearance|limited|gift|exclusive)\s*[])]',
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

-- Rebuild match_key for the rows the function change actually affects: those
-- whose name carries a parenthesised promo tag. Idempotent; scoped so it does
-- not churn the whole catalogue.
UPDATE products p
SET match_key = fmb_build_match_key(p.brand, p.name)
WHERE p.name ~* '[(]\s*(deal|sale|new|hot|clearance|limited|gift|exclusive)\s*[)]'
  AND p.match_key IS DISTINCT FROM fmb_build_match_key(p.brand, p.name);
