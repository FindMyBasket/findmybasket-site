-- retailer_import_config.supplements_path_prefixes — the signal for path-first
-- supplements classification (work-list items 71, 72).
--
-- WHY CONFIG RATHER THAN A CODE CONSTANT. The path allowlist already lives on this
-- table as `category_path_must_contain`, so this sits beside it and changes without
-- a deploy. The alternative is a retailer-id constant in the importer, and
-- DEBENHAMS_RETAILER_ID / BEAUTY_FLASH_RETAILER_ID show how those proliferate.
--
-- DEFAULT '{}' IS THE WHOLE SAFETY ARGUMENT. With no retailer configured, no row is
-- ever on a supplements path, the new branch in inferCategorisationForImport is
-- unreachable, and classification is unchanged for every retailer. THE DEPLOY IS
-- INERT BY CONSTRUCTION — which is why the deploy and the activation are separable:
--
--   1. Ship the code and this column. Nothing changes. Confirm a clean import cycle
--      with no movement in any retailer's link total.
--   2. THEN write the path prefix into Boots' row. That is the change that carries
--      risk, and it gets its own baseline and its own read.
--
-- "Inert" is a claim until it is measured. lib/__tests__/supplements-path.test.ts
-- direction A is the measurement: the two-argument form byte-identical across the
-- corpus. Do not treat step 1 as safe on the strength of this comment alone.
--
-- NOT POPULATED HERE, DELIBERATELY. Adding the column and setting it are two acts.

ALTER TABLE public.retailer_import_config
  ADD COLUMN IF NOT EXISTS supplements_path_prefixes text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.retailer_import_config.supplements_path_prefixes IS
  'Feed category-path prefixes whose rows classify as top_category=supplements, '
  'bypassing the excludeChecks supplement denylist. Empty for every retailer until '
  'deliberately set; an empty array makes the classifier branch unreachable, so the '
  'deploy is inert. Boots'' intended value is the single leaf '
  '"Health & Beauty > Health Care > Fitness & Nutrition > Vitamins & Supplements" — '
  'NOT the Health Care subtree, which would admit 2,179 non-supplement rows, and NOT '
  'Medicine & Drugs, whose 113 supplement-shaped rows are an accepted loss. '
  'See work-list items 71, 72 and 79.';

-- --- Verification (convention 4: assert, do not assume) ----------------------
DO $$
DECLARE
  n_rows      int;
  n_nonempty  int;
  col_default text;
BEGIN
  SELECT count(*) INTO n_rows FROM public.retailer_import_config;
  SELECT count(*) INTO n_nonempty FROM public.retailer_import_config
    WHERE cardinality(supplements_path_prefixes) > 0;

  -- Every existing row must have defaulted to empty. A non-empty row here would
  -- mean the column arrived already active, which is the one thing this migration
  -- must not do.
  IF n_nonempty <> 0 THEN
    RAISE EXCEPTION 'supplements_path_prefixes is non-empty on % row(s); the deploy would not be inert', n_nonempty;
  END IF;

  SELECT column_default INTO col_default FROM information_schema.columns
   WHERE table_schema='public' AND table_name='retailer_import_config'
     AND column_name='supplements_path_prefixes';
  IF col_default IS NULL THEN
    RAISE EXCEPTION 'supplements_path_prefixes has no default; a new retailer row would be NULL rather than empty';
  END IF;

  RAISE NOTICE 'supplements_path_prefixes added to % config rows, all empty, default %', n_rows, col_default;
END $$;
