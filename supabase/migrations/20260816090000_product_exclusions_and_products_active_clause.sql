-- APPLIED to production 2026-08-16 via MCP apply_migration; committed as the record.
-- (`supabase db push` remains blocked by history drift.)
--
-- Work-list item 122. Explicit per-product suppression, by id, never by a rule.
--
-- WHY THE VIEW AND NOT THE CALL SITES. products_active is the chokepoint Step A of the
-- Superdrug removal established, and Step C of that same work had to patch EIGHT separate
-- query sites for want of one. One clause here is honoured by the product page
-- (getProductById), the sitemap (lib/sitemap.ts), the listings, the brand pages and search,
-- without eight edits and without a ninth site being missed later.
--
-- THE PROPERTY THIS DESIGN RESTS ON, MEASURED RATHER THAN ASSUMED. The AWIN importer writes
-- `tags`, `top_category` and `subcategory` at CREATE ONLY:
--   * index.ts:2429  createActions.push({ ... tags: finalTags, top_category, subcategory ... })
--   * index.ts:2197  updateActions.push({ rp_id, product_id, price, url, in_stock, ean, mpn, image_url })
--   * index.ts:2315  linkActions.push({ product_id, ext_id, price, url, in_stock, ean, mpn, image_url })
-- The update and link paths carry NO categorisation fields. So a row-level edit to an
-- existing product SURVIVES the next import, and only DELETION is reversed - the feed still
-- carries the row, the next import finds no match, and it is recreated under a NEW id. That
-- asymmetry is why this is a table of ids rather than a delete, and why setting
-- `in_stock = false` would not work either (products_active ignores in_stock entirely).
--
-- WHY NOT THE EXISTING `cleanup_remove` TAG. It is filtered in ~20 query-layer call sites
-- but NOT in products_active, and both lib/sitemap.ts and getProductById read
-- products_active with no tag filter. A cleanup_remove product loses its listings and KEEPS
-- its live, indexed /product/{id} page with the price on it - which is the exact surface
-- that made this urgent.
--
-- THE VIEW IS PATCHED FROM ITS OWN LIVE DEFINITION, NOT RETYPED. pg_get_viewdef is read,
-- the clause is inserted at a guarded anchor, and the result is re-applied, so the 22-column
-- SELECT list is carried across verbatim. Same property the fmb_quality_snapshot_write patch
-- (20260815100400) relied on: an identical rendering is PROOF of fidelity rather than a
-- promise of it. The guard refuses to patch if the WHERE clause is not the exact expected
-- shape, because the insert prepends to a flat top-level AND chain and an OR appearing there
-- would silently change the meaning.
--
-- VERIFIED IMMEDIATELY AFTER APPLYING:
--   products_active   100,207 -> 100,201   (exactly -6)
--   column list       identical, all 22 in order
--   the six ids       0 visible in products_active
--   products rows     6 intact
--   retailer_prices   6 intact  <- prices keep updating; nothing is un-integrated
--   supplements       1,770 -> 1,764

CREATE TABLE IF NOT EXISTS public.product_exclusions (
  product_id  int PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  reason      text NOT NULL CHECK (reason IN ('medicine','device','veterinary','not_a_supplement','other')),
  note        text NOT NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  added_by    text NOT NULL
);

COMMENT ON TABLE public.product_exclusions IS
  'Explicit per-product suppression, read by the products_active view. ONE ROW PER '
  'DECISION, each carrying a reason and a note saying why THIS id. It is a LIST, not a '
  'rule: it covers exactly what is on it and nothing else, BY DESIGN. A rule written '
  'from the examples in hand is fitted to them, which is what the name-based supplement '
  'rule demonstrated and what a regex over the first 1,683 Boots supplements '
  'demonstrated again (two false positives, five missed). Do NOT replace this with a '
  'pattern. IT DOES NOT STOP TOMORROW''S MEDICINE - a new product gets a new id and is '
  'not on the list; the answer is to re-run the detection query after an import and '
  'curate, never to auto-exclude. Work-list item 122.';

COMMENT ON COLUMN public.product_exclusions.note IS
  'Why THIS product id, in words. Required: an unexplained id is the failure mode the '
  'Skin Cupid backup tables demonstrated (rows removed, no table comment, no document, '
  'and a second decision cycle spent rediscovering the first).';

DO $patch$
DECLARE
  v_def          text;
  v_new          text;
  v_expect_where constant text :=
    E'FROM products p\n  WHERE merged_into IS NULL AND parent_product_id IS NULL AND image_url IS NOT NULL AND image_url <> ''''::text AND (EXISTS ( SELECT 1';
  v_clause       constant text :=
    E'FROM products p\n  WHERE NOT (EXISTS ( SELECT 1\n           FROM product_exclusions x\n          WHERE x.product_id = p.id)) AND merged_into IS NULL AND parent_product_id IS NULL AND image_url IS NOT NULL AND image_url <> ''''::text AND (EXISTS ( SELECT 1';
BEGIN
  v_def := pg_get_viewdef('public.products_active'::regclass, true);

  IF position('product_exclusions' in v_def) > 0 THEN
    RAISE NOTICE 'products_active already carries the clause; nothing to do';
    RETURN;
  END IF;

  IF position(v_expect_where in v_def) = 0 THEN
    RAISE EXCEPTION 'products_active WHERE clause is not the expected shape - refusing to patch. Re-read the definition and update this migration.';
  END IF;

  v_new := replace(v_def, v_expect_where, v_clause);

  IF v_new = v_def THEN
    RAISE EXCEPTION 'patch produced no change - refusing';
  END IF;

  EXECUTE 'CREATE OR REPLACE VIEW public.products_active AS ' || v_new;
END
$patch$;

-- The six medicines. No judgement required on any of them, which is why they go first and
-- why the rest of the population waits for a human pass rather than a wider pattern.
INSERT INTO public.product_exclusions (product_id, reason, note, added_by) VALUES
  (149604, 'medicine', 'Viagra Connect Sildenafil 50mg, 4 tablets. P-medicine. Arrived on the Boots Vitamins & Supplements leaf via run 302, 16 Aug 04:30. The founding case of the categorisation harness, which the path-first rule relocated rather than prevented.', 'robbie'),
  (149605, 'medicine', 'Viagra Connect 50mg, 12 tablets. P-medicine. Same origin as 149604.', 'robbie'),
  (149607, 'medicine', 'Viagra Connect 50mg, 24 tablets. P-medicine. Same origin as 149604.', 'robbie'),
  (149409, 'medicine', 'Pirilieve Hayfever Relief 120mg film-coated tablets. Antihistamine, not a supplement. Not topical, so the SUPP_TOPICAL_FORM veto could not see it.', 'robbie'),
  (149880, 'medicine', 'Regaine For Men Extra Strength Scalp Foam 5%. Minoxidil, a licensed medicine.', 'robbie'),
  (150432, 'medicine', 'Balance Activ Dual Action Thrush & BV pessaries. Medicinal product.', 'robbie')
ON CONFLICT (product_id) DO NOTHING;
