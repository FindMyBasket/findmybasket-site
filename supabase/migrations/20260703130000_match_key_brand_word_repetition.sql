-- Applied via MCP apply_migration 2026-07-03 (supabase db push is blocked by
-- migration-history drift; file kept for the record / parity with the DB).
--
-- Mirror the JS stripLeadingBrandRepetition() (supabase/functions/_shared/match-key.ts)
-- into SQL so a freshly-imported row and a SQL-backfilled row produce the same
-- products.match_key. Handles (1) whole-brand repeats (Goodal Goodal…, Dr. Althea
-- Dr Althea…, FULLY Fully…) and (2) partial-brand prefix on multi-word brands
-- (PURITO… under "Purito Seoul"), with the guards: never strip to empty
-- (Douvall's), and shape-2 only when the full brand is absent (Bondi Sands Bondi
-- Babe kept distinct). Verified byte-identical to the JS on 13 FP-class cases.

CREATE OR REPLACE FUNCTION fmb_strip_leading_brand_repetition(norm_name text, norm_brand text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  bt text[]; nt text[];
  n int; ln int; i int; j int; k int;
  matched boolean;
  remaining text;
BEGIN
  IF norm_brand IS NULL OR norm_brand = '' OR norm_name IS NULL OR norm_name = '' THEN
    RETURN norm_name;
  END IF;
  bt := string_to_array(norm_brand, ' ');
  nt := string_to_array(norm_name, ' ');
  n  := array_length(bt, 1);
  ln := array_length(nt, 1);
  i  := 0;

  -- (1) consume consecutive full-brand copies
  LOOP
    matched := (i + n <= ln);
    IF matched THEN
      FOR j IN 1..n LOOP
        IF nt[i + j] IS DISTINCT FROM bt[j] THEN matched := false; EXIT; END IF;
      END LOOP;
    END IF;
    EXIT WHEN NOT matched;
    i := i + n;
  END LOOP;

  -- (2) partial-brand prefix (only if no full copy consumed and multi-word brand)
  IF i = 0 AND n >= 2 THEN
    k := 0;
    WHILE k < n AND (k + 1) <= ln AND nt[k + 1] IS NOT DISTINCT FROM bt[k + 1] LOOP
      k := k + 1;
    END LOOP;
    IF k >= 1 AND k < n THEN i := k; END IF;
  END IF;

  IF i = 0 THEN RETURN norm_name; END IF;
  IF i >= ln THEN RETURN norm_name; END IF;                 -- guard: never strip to empty
  remaining := array_to_string(nt[i + 1 : ln], ' ');
  IF remaining = '' THEN RETURN norm_name; END IF;
  RETURN remaining;
END;
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
      btrim(regexp_replace(
        regexp_replace(
          fmb_normalise_for_match(
            regexp_replace(
              coalesce(name, ''),
              '[[(]\s*(deal|sale|new|hot|clearance|limited|gift|exclusive)\s*[])]',
              ' ', 'gi'
            )
          ),
          '\y(tube|bottle|jar|pump)\y', ' ', 'g'
        ),
        '\s+', ' ', 'g'
      )) AS nn_raw
  ),
  stripped AS (
    SELECT nb, fmb_strip_leading_brand_repetition(nn_raw, nb) AS nn FROM parts
  )
  SELECT CASE
    WHEN nb <> '' AND nn = nb                                THEN nb   -- name IS the brand
    WHEN nb <> '' AND left(nn, length(nb) + 1) = nb || ' '   THEN nn   -- brand already prefixes name
    WHEN nb =  ''                                            THEN nn
    ELSE btrim(nb || ' ' || nn)
  END
  FROM stripped;
$$;
