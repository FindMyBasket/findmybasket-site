-- Fix the Gorgeous Shop (r30) brand aliases — wrong canonical spelling.
--
-- THE BUG (mine, introduced in 20260720140000_gorgeous_shop_onboarding.sql):
-- I took the canonical spellings from the awin-feed-count diagnostic's
-- "spelling_collisions" output, which reports the catalogue brand already
-- lower-cased by its own normaliser. So I wrote canonical = 'skinchemists' and
-- 'studio10' when the catalogue actually stores 'skinChemists' and 'Studio10'.
--
-- The aliases DID fire — they were not inert. existing_brands_only compares the
-- NORMALISED brand (fmb_match_brand: lower + non-alnum -> space), and
-- 'skinchemists' normalises identically to 'skinChemists', so the gate passed
-- and 26 products were created. But the row was written with my lower-case
-- canonical as the DISPLAY brand, so the catalogue now holds both spellings:
--
--   skinChemists  26 products (pre-existing)   vs  skinchemists  24 (r30 import)
--   Studio10      24 products (pre-existing)   vs  studio10       2 (r30 import)
--
-- That is why the post-import check for these brands looked like "zero landed
-- rows": querying the correct spelling missed the rows, which had landed under
-- the lower-case duplicate.
--
-- Impact is display-level, not matching-level: match_key is built from the
-- normalised brand, which was already identical for both spellings, so no
-- match_keys change and no products merge or split as a result of this fix.
--
-- Also fixes the same mistake at source so the next import does not recreate the
-- duplicate spelling.

-- 1. Point the aliases at the catalogue's real spellings.
UPDATE public.brand_aliases
   SET canonical = 'skinChemists',
       notes     = '20Jul26 Gorgeous Shop (r30) onboarding — spacing variant. Canonical corrected from ''skinchemists'': the catalogue stores ''skinChemists''.'
 WHERE alias = 'skin chemists';

UPDATE public.brand_aliases
   SET canonical = 'Studio10',
       notes     = '20Jul26 Gorgeous Shop (r30) onboarding — spacing variant. Canonical corrected from ''studio10'': the catalogue stores ''Studio10''.'
 WHERE alias = 'studio 10';

-- 2. Re-spell the 26 product rows the bad canonical created.
--    Scoped to the exact lower-case strings so the pre-existing correctly-spelled
--    rows are untouched.
UPDATE public.products SET brand = 'skinChemists' WHERE brand = 'skinchemists';
UPDATE public.products SET brand = 'Studio10'     WHERE brand = 'studio10';

-- NOT FIXED HERE — pre-existing, unrelated to this onboarding, flagged only:
--   'skinChemists Professional' (45 products) and 'skinChemists professional'
--   (31 products) are a case-split of the same sub-brand, and
--   'skinChemists London' (41) is a third sub-brand. None of these were created
--   or touched by the r30 import. Worth a separate canonicalisation pass, but
--   merging them is a product decision (are London/Professional distinct lines?)
--   rather than a mechanical fix, so it is deliberately left alone.
