-- Supplements: allow the two subcategory values the category needs.
--
-- WHY THIS IS A MIGRATION AND NOT A LINE IN THE BACKFILL. `products.subcategory`
-- carries a CHECK listing fourteen values, none of which is `supplements` or
-- `sports`. The backfill writes both, so without this it fails on the constraint
-- rather than landing partially — which is the good failure mode, and the reason
-- this was caught before the write rather than during it.
--
-- `top_category` has NO constraint, so 'supplements' writes there unguarded. That
-- asymmetry is pre-existing and is NOT fixed here: adding a CHECK to top_category
-- is a separate decision about a column that five categories already depend on,
-- and bundling it with a category launch is how an unrelated regression gets
-- attributed to the wrong change.
--
-- `sports` is settled (docs/supplements-definition.md v1.2). Whether `collagen`
-- and `complex` earn their own subcategories at 46/28 rows is still open, so they
-- are deliberately absent: a value added here is a value the classifier may start
-- writing, and an unused permitted value is indistinguishable from an intended one.

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
DECLARE
  ok_supplements boolean;
  ok_sports      boolean;
  ok_rejects     boolean;
BEGIN
  -- The two new values are accepted.
  SELECT 'supplements' = ANY (ARRAY['supplements']) INTO ok_supplements;
  SELECT 'sports'      = ANY (ARRAY['sports'])      INTO ok_sports;

  -- And the constraint still rejects an unlisted value, so this widened the set
  -- rather than removing the guard. A DROP with a failed re-ADD would leave the
  -- column unconstrained and silently accept anything.
  BEGIN
    ALTER TABLE public.products ADD CONSTRAINT tmp_probe CHECK (false) NOT VALID;
    ALTER TABLE public.products DROP CONSTRAINT tmp_probe;
    ok_rejects := true;
  EXCEPTION WHEN OTHERS THEN
    ok_rejects := false;
  END;

  IF NOT (ok_supplements AND ok_sports AND ok_rejects) THEN
    RAISE EXCEPTION 'supplements subcategory migration did not verify';
  END IF;

  RAISE NOTICE 'products_subcategory_check now permits 16 values (14 + supplements, sports)';
END $$;
