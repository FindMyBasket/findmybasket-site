-- APPLIED to production 2026-08-16 via MCP apply_migration; committed as the record.
-- REVERTS 20260816200000. Work-list items 149, 150.
--
-- `womens-health` is removed from the permitted set and its 125 rows are back on
-- `supplements`. PARTS 1 AND 2 OF THE TAXONOMY WORK BUY ZERO SUBCATEGORY PAGES.
--
-- WHY. The value was published for 117 live products, of which 37 had NO GENDER SIGNAL AT
-- ALL -- turmeric, glucosamine, quercetin, reishi, shilajit, taurine, NAC, omega-3, vitamin
-- C, vitamin D3, elderberry, astaxanthin, magnesium, fibre. The mechanism was BRAND
-- SHELVING, not classification: Boots files GP Nutrition's ENTIRE eleven-product range under
-- Women's Health, and a chunk of New Leaf's range including a TESTOSTERONE BOOSTER.
--
-- A CATEGORY PAGE ON THIS SITE IS A CLAIM ABOUT WHAT PRODUCTS ARE, NOT ABOUT WHERE ONE
-- RETAILER SHELVES THEM. Every other subcategory inherits its meaning from our own
-- classifier. This would have been the exception establishing that shelves are acceptable,
-- on the day the shelf included a testosterone booster.
--
-- AND NARROWING WAS NOT AVAILABLE. Every honest definition falls below the 100-product floor
-- set the same afternoon: explicitly women's is 75, the intersection of the retailer's
-- taxonomy and a name rule is 68. THE PAGE QUALIFIED ONLY AT ITS WIDEST AND LEAST ACCURATE
-- DEFINITION. Narrowing it and keeping it were not compatible options.
--
-- THE FLOOR IS NOT AT FAULT AND IS NOT MOVED. It was derived from eighteen shipped pages and
-- it answers "is this page big enough". It has no way to ask "IS THIS PAGE WHAT IT SAYS IT
-- IS", which is a different test that did not exist until this case needed it. Moving the
-- floor to fit the first case that failed it would have left it meaning nothing.
--
-- ORDER MATTERS AND IS NOT OPTIONAL: the data revert runs FIRST. ADD CONSTRAINT validates
-- existing rows, so narrowing the CHECK while 125 rows still carried the value would fail
-- the migration -- correctly, but after a DROP CONSTRAINT has already run.

-- Step 1, applied as data:
--   UPDATE public.products SET subcategory = 'supplements' WHERE subcategory = 'womens-health';
--   -> 125 rows, 0 of them outside top_category = 'supplements'.
--   All 125 had been 'supplements' before the backfill: the write guard only ever
--   overwrote NULL / 'supplements' / 'general', so the revert is exact rather than
--   approximate. Nothing needs to remember what each row used to be.

-- Step 2, the constraint:

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_subcategory_check;

ALTER TABLE public.products ADD CONSTRAINT products_subcategory_check
  CHECK (subcategory = ANY (ARRAY[
    -- skincare / bath_body
    'face', 'body', 'both', 'hand', 'foot',
    -- makeup
    'lips', 'eyes', 'nails',
    -- hair
    'cleanse', 'condition', 'treatment', 'style', 'colour',
    -- fragrance
    'scent',
    -- supplements (added 2026-08-12)
    'supplements', 'sports'
  ]));

-- --- Verification (convention 4: assert, do not assume) ----------------------
DO $$
DECLARE n_wh int; n_supp int; n_sport int;
BEGIN
  SELECT count(*) INTO n_wh FROM public.products WHERE subcategory = 'womens-health';
  IF n_wh <> 0 THEN
    RAISE EXCEPTION 'womens-health still on % rows; data must be reverted before the constraint', n_wh;
  END IF;

  -- The pre-backfill state, restored EXACTLY. 1,517 and 202 are the figures measured before
  -- the 16 August backfill ran, asserted here rather than eyeballed.
  SELECT count(*) INTO n_supp  FROM public.products_active WHERE top_category='supplements' AND subcategory='supplements';
  SELECT count(*) INTO n_sport FROM public.products_active WHERE top_category='supplements' AND subcategory='sports';
  IF n_supp <> 1517 OR n_sport <> 202 THEN
    RAISE EXCEPTION 'unexpected post-revert state: supplements=%, sports=% (expected 1517, 202)', n_supp, n_sport;
  END IF;

  -- And the constraint still REJECTS the removed value, so this narrowed the set rather
  -- than removing the guard.
  BEGIN
    INSERT INTO public.products (id, name, subcategory) VALUES (-998, 'probe', 'womens-health');
    RAISE EXCEPTION 'products_subcategory_check did NOT reject womens-health after narrowing';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN not_null_violation THEN NULL;
  END;
END $$;

-- NO ROUTE TO DROP. app/supplements/[subcategory]/page.tsx is dynamic and generic; the page
-- stops existing because getValidSubcategories no longer returns the value. Likewise the
-- sitemap: active_category_subcategories is a view over products_active and the URL leaves
-- it as soon as no product carries the value. Both surfaces are ISR-cached and lag by up to
-- an hour -- SEE ITEM 146, which is the same lag observed from the other side.
