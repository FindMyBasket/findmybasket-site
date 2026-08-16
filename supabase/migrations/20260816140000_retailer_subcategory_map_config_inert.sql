-- APPLIED to production 2026-08-16 via MCP apply_migration; committed as the record.
-- PART 1 of the retailer-taxonomy subcategory work. Work-list items 125, 126.
--
-- LANDS INERT. Both columns are NULL for all 15 retailers and the importer does not read
-- them yet (part 2). Deliberately the sequence everything else took: land inert, backfill,
-- read one cycle, then decide on part 3.
--
-- WHY TWO COLUMNS AND NOT ONE. Same shape as category_path_must_contain /
-- supplements_path_prefixes, and subject to the same rule from item 91: EITHER ALONE IS A
-- SILENT NO-OP. A source field with no map classifies nothing; a map with no source field
-- has nothing to read. The CHECK makes a half-configured retailer impossible rather than
-- merely discouraged -- item 91's no-op cost the supplements path a day.

ALTER TABLE public.retailer_import_config
  ADD COLUMN IF NOT EXISTS subcategory_source_field text,
  ADD COLUMN IF NOT EXISTS subcategory_prefix_map   jsonb;

COMMENT ON COLUMN public.retailer_import_config.subcategory_source_field IS
  'Which AWIN feed column carries THIS RETAILER''S OWN taxonomy, to be used for '
  'subcategory filing instead of our name inference. "product_type" for Boots. NULL = '
  'feature off for this retailer. MUST NOT be satisfied by a name rule: the whole point '
  'is that the retailer already filed the row, and a name fallback would reintroduce the '
  'inference this replaces, invisibly. Work-list item 126.';

COMMENT ON COLUMN public.retailer_import_config.subcategory_prefix_map IS
  'Array of {prefix, group, subcategory}. LONGEST PREFIX WINS, matched with startsWith, '
  'exactly like supplements_path_prefixes -- NOT exact match. Prefix matching is what '
  'makes a deep tail inherit from its parent instead of falling through, so the map does '
  'not have to enumerate every value and does not break on the next one the retailer adds '
  '(Boots: 88 distinct values inside one leaf, of which 58 hold only 120 rows between '
  'them). '
  'READ THE LIMIT BEFORE TRUSTING A ZERO-UNCLASSIFIED RESULT: on Boots this column is '
  '100%% filled, so a map over it leaves NO residual -- but 1,012 of 1,771 rows (57%%) sit '
  'on two BARE PARENT nodes (Medicines & Treatments 607, Lifestyle & Wellbeing 405) with '
  'no child beneath them. It is RESIDUAL-FREE AND THIN AT THE SAME TIME. It gives a clean '
  'top-level grouping and a clean out-of-scope test, and NO subcategory granularity for '
  'the majority. A reader seeing zero unclassified will otherwise assume it did more than '
  'it did. '
  'MEASURED COUNTEREXAMPLE, so this is not theoretical: the column does NOT separate '
  'sports. Sports-token rows are 142 under Medicines & Treatments, 98 under Lifestyle & '
  'Wellbeing and 75 under Active Nutrition -- the node named for it holds 22%%. Boots '
  'files Phizz hydration under Medicines and Liquid IV hydration under Lifestyle, so it '
  'is inconsistent about one product class and that half of a map cannot be read off it. '
  'Work-list items 125, 126.';

ALTER TABLE public.retailer_import_config
  DROP CONSTRAINT IF EXISTS retailer_subcategory_map_pair;

ALTER TABLE public.retailer_import_config
  ADD CONSTRAINT retailer_subcategory_map_pair CHECK (
    (subcategory_source_field IS NULL AND subcategory_prefix_map IS NULL)
    OR
    (subcategory_source_field IS NOT NULL
     AND subcategory_prefix_map IS NOT NULL
     AND jsonb_typeof(subcategory_prefix_map) = 'array'
     AND jsonb_array_length(subcategory_prefix_map) > 0)
  );

-- VERIFIED ON APPLYING: 15 retailers, 0 with subcategory_source_field, 0 with
-- subcategory_prefix_map. Nothing reads either column yet.
