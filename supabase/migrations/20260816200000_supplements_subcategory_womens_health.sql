-- APPLIED to production 2026-08-16 via MCP apply_migration; committed as the record.
-- Work-list item 145. ONE new subcategory value.
--
-- WHY ONLY ONE, when a map over 88 taxonomy values produced eleven.
--
-- products.subcategory PUBLISHES A URL, and nothing downstream can decline a thin page:
--   * the sitemap has NO gate -- active_category_subcategories is a bare
--     `select distinct top_category, subcategory where subcategory is not null`;
--   * the page HAS a gate and it tests EXISTENCE -- getValidSubcategories returns every
--     distinct value any product carries, and SubcategoryPage 404s only on an absent slug
--     or zero products.
-- A gate that rejects zero and accepts one is not a floor. ONE PRODUCT CARRYING A VALUE
-- PASSES BOTH, renders a page and enters the sitemap. So the floor exists only at the
-- moment of writing the value, which makes THIS CONSTRAINT the enforcement point.
--
-- THE FLOOR IS 100 PRODUCTS, derived from the eighteen pages already live rather than
-- chosen: every deliberately-created subcategory holds at least 113 (bath_body/foot), and
-- the only two below it are classification leakage nobody chose (fragrance/body 156 --
-- fragrance filed as `body`; makeup/scent 59 -- makeup filed as `scent`). Of the eleven
-- values the Boots product_type map produced, `womens-health` alone clears it, at 130
-- mapped / 117 live.
--
-- THE OTHER TEN ARE ABSENT DELIBERATELY, and the 12 August version of this constraint said
-- why: "a value added here is a value the classifier may start writing, and an unused
-- permitted value is indistinguishable from an intended one." `beauty` (43),
-- `childrens` (32), `mens-health` (30), `multivitamins` (26), `joint-and-bone` (12),
-- `immunity` (10), `brain-and-eyes` (8), `weight-management` (7), `energy` (4) and
-- `sleep-and-calm` (4) are CORRECT CLASSIFICATIONS AND NOT PAGES. They stay in
-- scripts/boots-subcategory-map.ts, unwritten.
--
-- NO MERGE RESCUES THEM. The six small health values together reach 45; adding
-- mens-health, childrens and multivitamins reaches 133 -- but that bucket holds men's,
-- children's, joint health and sleep, and has no name that is not a synonym for
-- "supplements". A merge that clears the floor only by combining things a shopper would
-- not look for together has found a number, not a page.

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
    'supplements', 'sports',
    -- supplements, from the Boots product_type map (added 2026-08-16, item 145)
    'womens-health'
  ]));

-- --- Verification (convention 4: assert, do not assume) ----------------------
DO $$
DECLARE n_before int; n_after int;
BEGIN
  -- The constraint still REJECTS an unlisted value, so this widened the set rather than
  -- removing the guard. A DROP with a failed re-ADD leaves the column unconstrained and
  -- silently accepting anything, which is the failure this block exists to exclude.
  BEGIN
    INSERT INTO public.products (id, name, subcategory) VALUES (-999, 'probe', 'not-a-real-value');
    RAISE EXCEPTION 'products_subcategory_check did NOT reject an unlisted value';
  EXCEPTION
    WHEN check_violation THEN NULL;    -- expected
    WHEN not_null_violation THEN NULL; -- also fine: never reached the check, no probe row left
  END;

  SELECT count(*) INTO n_before FROM public.products WHERE subcategory = 'womens-health';
  IF n_before <> 0 THEN
    RAISE EXCEPTION 'womens-health already present on % rows before the backfill', n_before;
  END IF;

  SELECT count(*) INTO n_after FROM public.products WHERE id = -999;
  IF n_after <> 0 THEN
    RAISE EXCEPTION 'probe row leaked';
  END IF;
END $$;

-- --- The backfill that followed, recorded for the audit trail ----------------
--
-- Applied separately, as data rather than schema. 128 candidate ids from the Boots feed
-- (130 mapped, 2 with no stored catalogue row), guarded:
--
--   UPDATE public.products SET subcategory = 'womens-health'
--   WHERE id IN (...128 ids...)
--     AND top_category = 'supplements'
--     AND (subcategory IS NULL OR subcategory IN ('supplements','general'));
--
-- 125 written. THREE DECLINED, AND NONE WAS THEORETICAL:
--   148826, 149612  ORS Hydration electrolyte tablets, already `sports`. Item 128 as a
--                   collision: we decided hydration is sports, BOOTS FILES IT UNDER
--                   WOMEN'S HEALTH. Reading a retailer's taxonomy does not end the
--                   argument about where a row belongs; it gives it a second participant.
--   24682           Philip Kingsley Density Preserving Scalp Drops -- top_category `hair`,
--                   which Boots files under Women's Health (hair loss for women). Declined
--                   ONLY because `treatment` is a specific value. Had it been NULL this
--                   would have published /hair/womens-health.
--
-- WHICH IS WHY THE `top_category` GUARD IS THERE. The overwrite rule constrains the OLD
-- value and never looked at the category. A MAP SCOPED TO ONE CATEGORY MUST ASSERT THAT
-- SCOPE ON THE ROW rather than assume it from the feed it was built on.
--
-- VERIFIED AFTER: supplements 1,517 -> 1,400 · sports 202 -> 202, UNTOUCHED ·
--                 womens-health 117 live (125 written, 8 in product_exclusions).
