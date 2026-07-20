-- Multipack-deeplink guard: opt-in per retailer.
--
-- Some merchants sell a "buy two" multipack under a product_name IDENTICAL to
-- the single item, with the multiplier appearing only in the deeplink URL and
-- on their own page title:
--
--   feed product_name : "Medik8 C Tetra Serum 30ml"
--   deeplink slug     : /medik8-double-c-tetra-serum-30ml
--   merchant title    : "Medik8 C Tetra Serum 30ml Double"
--
-- The match key comes from the name, so it never sees the multiplier and the
-- row lands on the SINGLE-item comparison page. On Gorgeous Shop (r30) this put
-- 84 multipack prices onto single-item pages; on 53 of them the multipack was
-- CHEAPER than peers, so the retailer would have won "best price" wrongly.
--
-- Off by default. It is a real behaviour change — rows that previously imported
-- now do not — so it should be switched on per retailer after checking that
-- merchant actually has this pattern, not applied blanket. A merchant whose
-- deeplinks legitimately contain "duo"/"double" in brand or product names would
-- lose rows for no reason.
--
-- Guard logic and its fixture: supabase/functions/_shared/multipack-guard.ts
-- and lib/__tests__/multipack-guard.test.ts (84 known-bad rows must be caught,
-- 226 genuine multi-item bundles must survive).

ALTER TABLE public.retailer_import_config
  ADD COLUMN IF NOT EXISTS multipack_deeplink_guard boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.retailer_import_config.multipack_deeplink_guard IS
  'When true, import-awin-feed skips a feed row whose deeplink advertises a multipack (duo/double/twin/trio/bundle/N-pack) while the product name describes a single item. Prevents a multipack price being attached to a single-item comparison page. See _shared/multipack-guard.ts.';

-- Enable for Gorgeous Shop (30), the retailer the defect was found on.
UPDATE public.retailer_import_config
   SET multipack_deeplink_guard = true
 WHERE retailer_id = 30;
