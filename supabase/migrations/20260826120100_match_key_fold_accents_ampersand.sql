-- ============================================================================
-- Fold accented characters and the ampersand BEFORE the alphanumeric strip.
--
-- MIRROR OF supabase/functions/_shared/match-key.ts. buildMatchKey() there and
-- fmb_build_match_key() here are kept byte-identical in output by contract; this
-- migration is the SQL half of one change and neither half is valid alone.
--
-- WHY. `[^a-z0-9]+ -> ' '` DELETED every character outside a-z0-9 rather than
-- folding it:
--
--     'Avène Thermal Water'  ->  'av ne thermal water'
--     'Avene Thermal Water'  ->  'avene thermal water'
--
-- Two spellings of one product, two keys, no match. And the ampersand is the same
-- defect in a different character -- '&' deleted while the word 'and' survived --
-- which left Boots Nail & Cuticle Oil and Boots Nail And Cuticle Oil as two
-- products, the dead twin outranking the live one on 281 impressions.
-- Work-list items 294, 370, 371.
--
-- '&' -> ' and ' rather than stripping the word 'and'. Both merge item 294's pair;
-- mapping was modelled and measured, stripping was not.
--
-- MEASURED BEFORE APPLYING, against a scratch copy of this function patched
-- mechanically from its own source:
--   16,754 of 99,967 keys move (16.76%)
--   128 merge groups, 257 products, net distinct-key reduction 125
--   all 13 cross-brand and all 9 name-divergent groups read in full; every merge
--   correct, in exactly three shapes and no fourth
--   75,926 rows carry a number and the fold alters the extracted number set on
--   ZERO of them
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fmb_fold_for_match(input text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(
           translate(coalesce(input, ''),
             'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸšŠžŽøØåÅßñÑ',
             'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYYsSzZoOaAsnN'),
           '&', ' and ');
$$;

COMMENT ON FUNCTION public.fmb_fold_for_match(text) IS
  $c$Folds accented letters to ASCII and maps & to " and ", BEFORE the [^a-z0-9] strip.

MIRROR of foldForMatch() in supabase/functions/_shared/match-key.ts. The two must agree
character for character; scripts/match-key-parity.mts asserts it over the whole catalogue
rather than over a fixture list. Work-list item 371.$c$;

CREATE OR REPLACE FUNCTION public.fmb_normalise_for_match(input text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace((lower(public.fmb_fold_for_match(coalesce(input, ''))) COLLATE "C"), '[^a-z0-9]+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.fmb_match_brand(input text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(
           regexp_replace(
             (lower(public.fmb_fold_for_match(coalesce(input, ''))) COLLATE "C"),
             '[^a-z0-9]+',
             ' ',
             'g'
           )
         );
$$;
