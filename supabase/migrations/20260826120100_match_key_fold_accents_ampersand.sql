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

-- ============================================================================
-- BACKFILL. Re-key the catalogue to the corrected rule.
--
-- This is the third part of ONE ACT: migration, backfill, then all three importer
-- deploys. The SQL half alone leaves every import writing old-style keys into a
-- catalogue that has just been re-keyed, so the gap would widen nightly.
--
-- MEASURED BEFORE APPLYING, folded against RECOMPUTED-UNFOLDED (never against the
-- stored key, which is stale on 5,344 rows and would attribute pre-existing drift
-- to this change -- see work-list item 374):
--   16,755 of 99,973 keys move
--   128 merge groups, 257 products, 125 fewer distinct keys
--   all 13 cross-brand and all 9 name-divergent groups read in full; every merge
--     correct, in three shapes and no fourth
--   quantity tokens changed by the fold: ZERO, across the whole catalogue
--
-- ── HELD PRODUCTS ARE SKIPPED, AND THE SKIP IS NOT A FIX ────────────────────────
--
-- guard_held_product_writes refuses any UPDATE that changes match_key on a product
-- with an open `held:` finding. Product 105424 is one, and its key WOULD change.
--
-- SKIPPING IS DELIBERATE AND LEAVES THE ROW EXACTLY AS WRONG AS IT IS TODAY, which
-- is the only option here that changes nothing:
--
--   stored             sweed le lipstick 90 039 s model
--   recomputed TODAY   sweed le lipstick 90 039pcs model    <- already corrupt
--   recomputed FOLDED  sweed le lipstick 90 and 039pcs model
--
-- `039pcs` is what TODAY's rule produces; COUNT_UNIT_RE reads `039's` as a pack
-- count with no folding involved. So:
--   RELEASING the hold would write a corruption we have now measured and named.
--   FIXING COUNT_UNIT_RE here would make one change prove two unrelated things.
--   SKIPPING leaves a row that is already miskeyed exactly as miskeyed as it was.
--
-- Item 237's hold was WRONG ABOUT THE MECHANISM -- it believed the entity shielded
-- the rule, when it only ever shielded the stored key -- and RIGHT ABOUT THE
-- CONCLUSION. Work-list items 375 and 376.
--
-- The exclusion reads standing_check_findings rather than naming an id, so it is the
-- same source the guard consults and cannot drift from it.
-- ============================================================================

-- ── BATCHED. A SINGLE STATEMENT FOR THIS DOES NOT RUN. ──────────────────────────
--
-- The first version re-keyed all ~16,755 rows in one UPDATE. Each row calls
-- fmb_build_match_key() twice (once in the predicate, once in SET) and fires a
-- BEFORE UPDATE trigger, and the statement exceeded the statement timeout. It
-- succeeded server-side after the client had already given up, which is a separate
-- hazard recorded at item 377 -- but as COMMITTED the file described an operation
-- that cannot complete.
--
-- A migration that times out for anyone replaying it is worse than one that is
-- merely stale: item 235's population is files that do not describe the database,
-- and a file describing an IMPOSSIBILITY is a different and worse thing. Batched so
-- the committed file matches something that actually runs.
DO $backfill$
DECLARE
  v_held  integer;
  v_batch integer;
  v_total integer := 0;
BEGIN
  SELECT count(*) INTO v_held
  FROM public.standing_check_findings
  WHERE status = 'open' AND finding_key LIKE 'held:%' AND detail ? 'product_id';

  LOOP
    WITH held AS (
      SELECT (detail->>'product_id')::int AS product_id
      FROM public.standing_check_findings
      WHERE status = 'open' AND finding_key LIKE 'held:%' AND detail ? 'product_id'
    ),
    batch AS (
      SELECT p.id
      FROM public.products p
      WHERE p.match_key IS DISTINCT FROM public.fmb_build_match_key(p.brand, p.name)
        AND p.id NOT IN (SELECT product_id FROM held)
      LIMIT 2000
    )
    UPDATE public.products p
       SET match_key = public.fmb_build_match_key(p.brand, p.name)
      FROM batch b
     WHERE p.id = b.id;

    GET DIAGNOSTICS v_batch = ROW_COUNT;
    EXIT WHEN v_batch = 0;
    v_total := v_total + v_batch;
    RAISE NOTICE 'match_key backfill: % rows so far', v_total;
  END LOOP;

  RAISE NOTICE 'match_key backfill complete: % rows re-keyed, % held product(s) skipped', v_total, v_held;
END
$backfill$;
