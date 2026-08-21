-- Correct the amazon_asin_map comment: it described a gate that does not exist for
-- 93% of published rows. Work-list item 235-adjacent; the defect shape is item 233's.
--
-- WHAT WAS WRONG. The comment read "promotion from this table into that column is a
-- separate deliberate step gated on human_verified". Measured 21 August 2026 against
-- the 484 published ASINs (item 219's table):
--
--     449  match_state = 'matched' with a matched_ean   -> promoted on the BARCODE
--      28  match_state = 'matched_by_name'              -> promoted on human_verified
--       7  identifier_conflict / legacy_unconfirmed     -> no promotable candidate
--
-- So human_verified gated 28 of 484. For the other 449 the comment described a gate
-- that NO CODE ENFORCES and that practice never applied.
--
-- THE PRACTICE IS RIGHT AND THE COMMENT WAS OVERSTATED, which is why this changes the
-- comment and not the behaviour. Item 219 states the reasoning already: matched_by_name
-- "was a different tier with a different justification -- a human verified the name",
-- because item 186's E1 requires a shared barcode which a name match by definition
-- lacks. Two tiers, two justifications. The comment collapsed them into one.
--
-- ITEM 233's SHAPE: `kind='coverage'` was "documentation in a column -- written
-- correctly and read by no code that runs". This is the mirror image: a GATE described
-- in a column comment and enforced by no code that runs. The hazard is the same and it
-- is not cosmetic -- the Solgar review on 21 August read this comment, concluded that
-- zero rows were promotable because human_verified was false on all 100, and would have
-- been wrong about why. A comment is what the next reader plans against.

COMMENT ON TABLE public.amazon_asin_map IS
  'Harvested Amazon ASIN to catalogue mapping (work-list item 60). NOTHING READS THIS. '
  'products.amazon_asin is the consumption point and promotion into it is a separate, '
  'deliberate step -- harvesting and publishing are never one act. '
  'PROMOTION HAS TWO TIERS WITH TWO DIFFERENT JUSTIFICATIONS, and human_verified gates '
  'only the second: '
  '(1) BARCODE TIER -- match_state = matched with a matched_ean. The shared barcode IS '
  'the verification; these are promoted without human_verified and are re-derivable from '
  'stored data (item 186 E1, item 219). 449 of the 484 published rows are this tier. '
  '(2) NAME TIER -- match_state = matched_by_name. No shared barcode exists, so a human '
  'verifies the name and human_verified records it. 28 published rows, none re-derivable '
  '-- inability to re-derive a decision is not evidence it was wrong. '
  'A BARCODE MATCH IS NEVER OVERWRITTEN BY A NAME MATCH (item 179; note that rule is '
  'one-directional and a symmetric write-if-absent guard silently reverses it). '
  'Reloadable from scripts/amazon-asin-map.mjs.';

COMMENT ON COLUMN public.amazon_asin_map.human_verified IS
  'Gates the NAME tier only (match_state = matched_by_name), where no shared barcode '
  'exists and a person confirmed the match. NOT a precondition for promoting a barcode '
  'match: 449 of 484 published ASINs carry human_verified = false by design, because the '
  'barcode is the verification. Do not read false as "unreviewed" or as "not promotable" '
  '-- check match_state first. Corrected 21 August 2026, when the table comment still '
  'described this as gating all promotion.';
