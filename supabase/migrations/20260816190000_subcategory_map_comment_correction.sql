-- PART 2 of the retailer-taxonomy subcategory work. Work-list items 140, 142.
--
-- COMMENT-ONLY. No schema change, no data change. Corrects figures written into
-- subcategory_prefix_map's comment on 16 August from a TOP-30 view of Boots'
-- product_type values, now that all 88 have been enumerated.
--
-- ALSO FIXES A LITERAL '%%' IN THE LIVE COMMENT. Part 1's migration doubled every percent
-- sign, a habit from format()/printf where '%' is a placeholder. COMMENT ON takes a plain
-- string literal, so Postgres stored the doubling verbatim and the live comment reads
-- "100%% filled". Same class as everything else today: a convention applied in a context
-- where the thing it protects against does not exist.
--
-- WHY A MIGRATION FOR A COMMENT: the old comment carries the safety argument for a name
-- rule, and that argument has been WITHDRAWN (item 140). A withdrawn argument left in a
-- column comment is item 135 trap 2 -- it presents as reasoning and is nothing of the
-- sort, and it sits in the one place a future reader of this column will definitely look.

COMMENT ON COLUMN public.retailer_import_config.subcategory_prefix_map IS
  'Array of {prefix, subcategory}. LONGEST PREFIX WINS, matched with startsWith, exactly '
  'like supplements_path_prefixes -- NOT exact match. Prefix matching is what makes a deep '
  'tail inherit from its parent instead of falling through, so the map does not have to '
  'enumerate every value and does not break on the next one the retailer adds (Boots: 88 '
  'distinct values inside one leaf, of which 58 hold only 120 rows between them). '
  'A NULL subcategory on an entry means DELIBERATELY OUT OF SCOPE. The importer COUNTS AND '
  'REPORTS those rows and does nothing else to them -- it does not exclude them. Excluding '
  'is a separate decision (part 3). '
  'READ THE LIMIT BEFORE TRUSTING A ZERO-UNCLASSIFIED RESULT: on Boots this column is '
  '100% filled, so a map over it leaves NO residual -- but 1,012 of 1,771 rows (57.1%) sit '
  'on two BARE PARENT nodes (Medicines & Treatments 607, Lifestyle & Wellbeing 405) with no '
  'child beneath them. It is RESIDUAL-FREE AND THIN AT THE SAME TIME. A reader seeing zero '
  'unclassified will otherwise assume it did more than it did. '
  'AND 57% IS THE CEILING, NOT THE DELIVERY. Measured against all 88 values, the group A '
  'map files 306 rows (17%) to a SPECIFIC subcategory, 1,330 (75%) to `general` because '
  'unmapped children inherit their bare parent, and 133 (8%) to a null out-of-scope entry. '
  'The column''s discriminating power and the map''s output are different numbers -- the '
  'map is bounded by the subcategory vocabulary on the other side of it. Item 142. '
  'WITHDRAWN, AND THE PREVIOUS VERSION OF THIS COMMENT ASSERTED IT: that a sports name rule '
  'is safe because it is bounded by the Active Nutrition node. It is not. Of 353 '
  'sports-token rows, Active Nutrition and its two children hold 80 (23%); 142 are under '
  'Medicines & Treatments and 98 under Lifestyle & Wellbeing, so 68% sit in the two bare '
  'parents and the bound is the whole 1,771-row leaf. A NODE NAMED FOR A CLASS IS NOT '
  'EVIDENCE THAT IT CONTAINS THE CLASS. Boots files Phizz hydration under Medicines and '
  'Liquid IV hydration under Lifestyle: it is inconsistent about one product class, and '
  'that half of a map cannot be read off this column at all. Work-list items 140, 142.';

COMMENT ON COLUMN public.retailer_import_config.subcategory_source_field IS
  'Which AWIN feed column carries THIS RETAILER''S OWN taxonomy, to be used for subcategory '
  'filing instead of our name inference. "product_type" for Boots. NULL = feature off for '
  'this retailer. MUST NOT be satisfied by a name rule: the whole point is that the retailer '
  'already filed the row, and a name fallback would reintroduce the inference this replaces, '
  'invisibly. If the named column is absent from the feed the importer turns the feature OFF '
  'and says so -- it does not fall back. '
  'RESOLVED BY NAME AGAINST THE HEADER ROW, NEVER THROUGH coalesceField. product_type is '
  'ALREADY parsed by the importer as `category_name_alt`, the fallback for category_name -- '
  'and on Boots category_name is 100% filled with the single constant "Health", so that '
  'fallback is UNREACHABLE BY CONSTRUCTION. coalesceField ranks by PRESENCE, not by '
  'INFORMATION. Routing this column through it would reproduce the shadowing and return a '
  'clean zero. Work-list items 126, 142.';
