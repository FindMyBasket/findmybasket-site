-- Applied via MCP apply_migration 2026-07-03 (supabase db push blocked by
-- migration-history drift; file kept for the record / parity with the DB).
--
-- Mirror the JS normaliseCountUnits() (supabase/functions/_shared/match-key.ts).
-- Canonicalise a count unit-word attached to a number
-- (pcs/pc/pieces/piece/pads/pad/patches/patch/sheets/sheet/ea/bare-S -> "<n>pcs")
-- and singularise the standalone nouns pad(s)/patch(es)/piece(s)/sheet(s). The
-- NUMBER is never altered, so "70 pads"=="70 pcs" but "70 pads"<>"30 pads". Applied
-- to nn_raw BEFORE fmb_strip_leading_brand_repetition, matching the JS pipeline.
-- SQL<->JS parity verified: 14 targeted cases + broad sample (only drift, no logic
-- divergence). Invariant audit (same key => same numbers) clean over 95k products.
CREATE OR REPLACE FUNCTION fmb_build_match_key(brand text, name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH parts AS (
    SELECT
      fmb_normalise_for_match(brand) AS nb,
      btrim(regexp_replace(
        regexp_replace(                                   -- (4) singularise standalone nouns
          regexp_replace(                                 -- (3) canonicalise number-attached units
            regexp_replace(                               -- (2) strip container nouns
              fmb_normalise_for_match(                    -- (1) promo-strip + normalise
                regexp_replace(
                  coalesce(name, ''),
                  '[[(]\s*(deal|sale|new|hot|clearance|limited|gift|exclusive)\s*[])]',
                  ' ', 'gi'
                )
              ),
              '\y(tube|bottle|jar|pump)\y', ' ', 'g'
            ),
            '\y([0-9]+(\.[0-9]+)?)\s*(pcs|pc|pieces|piece|pads|pad|patches|patch|sheets|sheet|ea|s)\y', '\1pcs', 'g'
          ),
          '\y(pad|patch|piece|sheet)(e?s)\y', '\1', 'g'
        ),
        '\s+', ' ', 'g'
      )) AS nn_raw
  ),
  stripped AS (
    SELECT nb, fmb_strip_leading_brand_repetition(nn_raw, nb) AS nn FROM parts
  )
  SELECT CASE
    WHEN nb <> '' AND nn = nb                                THEN nb
    WHEN nb <> '' AND left(nn, length(nb) + 1) = nb || ' '   THEN nn
    WHEN nb =  ''                                            THEN nn
    ELSE btrim(nb || ' ' || nn)
  END
  FROM stripped;
$$;
