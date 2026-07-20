-- Gorgeous Shop onboarding — retailer 30 (AWIN LEGACY CSV feed).
--
-- What it is (diagnosed read-only via .github/workflows/feed-diag.yml,
-- run 29741600071, fid 110188):
--   UK multi-brand beauty retailer. 11,337 products, 277 brands, top brand
--   bareMinerals at only 4.0% share, so no dominance risk. Character is
--   salon/professional Western beauty: haircare (Kerastase 422, Redken 278,
--   L'Oreal Professionnel 277, Schwarzkopf 246, Joico 243, Goldwell 217),
--   makeup (bareMinerals 459, Stila 271, Urban Decay 181), salon skincare
--   (Dermalogica 231, Guinot 205, Mary Cohr 153). Real K-beauty overlap too:
--   rom&nd 82, COSRX 51, Beauty of Joseon 24, Anua 10, Medicube 10.
--
--   Overlap tiering against our catalogue:
--     A. deepen a LIVE comparison (match_key hits products_active):  6,062 (53.5%)
--     B. match a hidden/merged row:                                     152
--     C. same-brand NEW sku:                                          2,459
--     D. net-new brand:                                               2,664
--   184 of 277 feed brands are already carried live.
--
--   6,062 tier-A is ~19x Atelier De Glow's 315. That is the reason for the
--   staging discipline below.
--
-- Feed transport: LEGACY AWIN CSV. feed_url is deliberately left NULL so the
-- importer falls through to buildFeedUrl(apiKey, awin_feed_id) — see
-- import-awin-feed/index.ts:818. This is simpler than Atelier, which needed a
-- GitHub Action to stage a Darwin feed to Storage because the edge runtime
-- could not reliably gunzip it. Nothing to stage here.
--
-- STAGED, NOT LIVE: retailers.active = false. Prices import but do NOT surface.
--   Atelier went live from the start at 315 tier-A, which was low risk. Flipping
--   this one changes pricing and comparison depth on 6,062 live pages AT ONCE,
--   on the core comparison surface. Bad URLs, prices or stock would be wrong on
--   6,062 pages simultaneously. So: import invisible, verify against the DB,
--   then flip active = true as a separate one-line UPDATE.
--
-- Freshness: AWIN reports Last Imported 07-19, Last Checked 07-20. Note the feed
-- is 100% in-stock — this is NORMAL for AWIN (feeds omit OOS rows rather than
-- flagging them; Boots and Stylevana are nightly-fresh and also report 100%).
-- It is NOT a frozen-feed signal.
--
-- Config decisions:
--   existing_brands_only = true — 277 brands with 93 net-new is closer to a
--     marketplace flood than Atelier's curated 690-row K-beauty specialist
--     (which used false). This drops tier D, so ~8,673 of 11,337 rows land and
--     the 2,664 net-new-brand rows are skipped. Deliberate: the value here is
--     deepening existing comparisons, not breadth on unknown brands.
--   top_category_default = NULL — Atelier set 'skincare' because it was ~95%
--     skincare. Gorgeous Shop has NO dominant category (heavy haircare AND
--     makeup AND skincare), so any default would actively miscategorise the
--     other two thirds. Better to let inference decide and leave the residue
--     uncategorised where it can be seen.
--   category_excludes = [] — SEE THE WARNING BELOW.
--   match_column = 'merchant_product_id' — per Atelier/BB precedent.
--   staging_mode = 'storage_passthrough', sliced_import = true — CORRECTED
--     after the fact. This was first written as inline/false on the reasoning
--     that 11,337 rows is modest, and it 546'd WORKER_RESOURCE_LIMIT twice.
--     The row count was the wrong thing to reason from: every large feed that
--     works has sliced_import = true, so follow that precedent rather than
--     guessing from size. streaming_enabled stays false.
--   enabled = true so the import actually writes prices; the frontend stays dark
--     via retailers.active = false.
--
-- WARNING — category_excludes and name_excludes are EMPTY and UNVERIFIED.
--   The diagnostic could not read this feed's category mix: the feed populates
--   merchant_product_category_path as an empty string on all 11,337 rows, and
--   the harness picked that column because it EXISTS rather than because it has
--   data (category_name may carry the real values). So unlike Atelier — where
--   the full category histogram surfaced gift cards, supplements and plumbing
--   to exclude — no equivalent junk sweep has been done here. Non-beauty rows
--   may import. Fragrance is 7.3% (830 rows), measured from product names, and
--   is gated off at the categoriser, so it imports without surfacing.
--   RESOLVED post-import (2026-07-20): the histogram of what actually landed is
--   entirely legitimate beauty — hair 2,382, skincare 2,351, makeup 1,191,
--   bath_body 545, fragrance 262. Zero junk, so category_excludes stays empty.
--   existing_brands_only had already filtered the junk out by brand. No action.

-- 1. Retailer row (staged inactive).
--    Domain confirmed by DNS (gorgeousshop.co.uk resolves; thegorgeousshop.co.uk
--    does not). Direct HTTP from the build environment is egress-filtered, so
--    this was not confirmed by fetching the page.
INSERT INTO retailers (id, name, base_url, active)
VALUES (30, 'Gorgeous Shop', 'https://www.gorgeousshop.com', false)  -- .com, not .co.uk: see 20260720170000
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      base_url = EXCLUDED.base_url;
      -- deliberately NOT touching active on conflict, so a re-run never un-lives it.

-- 2. Import config (LEGACY awin; feed_url NULL so buildFeedUrl is used).
INSERT INTO retailer_import_config (
  retailer_id, feed_format, feed_url, awin_feed_id, awin_merchant_id,
  match_column, existing_brands_only, top_category_default,
  category_excludes, name_excludes, category_path_must_contain,
  sliced_import, staging_mode, streaming_enabled, enabled
) VALUES (
  30,
  'awin',
  NULL,                     -- NULL on purpose: importer builds the URL from awin_feed_id
  '110188',                 -- AWIN datafeed id
  '53379',                  -- AWIN advertiser id (awinmid in aw_deep_link)
  'merchant_product_id',
  true,
  NULL,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  true,                     -- sliced_import: required, inline 546'd twice
  'storage_passthrough',
  false,
  true
)
ON CONFLICT (retailer_id) DO UPDATE SET
  feed_format                = EXCLUDED.feed_format,
  feed_url                   = EXCLUDED.feed_url,
  awin_feed_id               = EXCLUDED.awin_feed_id,
  awin_merchant_id           = EXCLUDED.awin_merchant_id,
  match_column               = EXCLUDED.match_column,
  existing_brands_only       = EXCLUDED.existing_brands_only,
  top_category_default       = EXCLUDED.top_category_default,
  category_excludes          = EXCLUDED.category_excludes,
  name_excludes              = EXCLUDED.name_excludes,
  category_path_must_contain = EXCLUDED.category_path_must_contain,
  sliced_import              = EXCLUDED.sliced_import,
  staging_mode               = EXCLUDED.staging_mode,
  streaming_enabled          = EXCLUDED.streaming_enabled,
  enabled                    = EXCLUDED.enabled;

-- 3. Brand aliases — MUST land before the first import.
--    existing_brands_only = true tests the feed brand against our catalogue. Both
--    of these fail that test on punctuation/spacing alone, so without the aliases
--    27 in-stock rows would be dropped SILENTLY on the first run and would then
--    need a backfill to recover. Seeding them here means they match from run one.
--    Aliases are stored lowercase to match the table convention and PK.
--    CANONICAL SPELLINGS CORRECTED — see 20260720160000_fix_gorgeous_shop_alias_casing.sql.
--    These were first written as 'skinchemists'/'studio10', taken from the
--    diagnostic's output, which reports the catalogue brand already lower-cased.
--    The catalogue actually stores 'skinChemists' and 'Studio10', so the original
--    values created duplicate lower-case brand spellings.
INSERT INTO public.brand_aliases (alias, canonical, notes) VALUES
  ('skin chemists', 'skinChemists', '20Jul26 Gorgeous Shop (r30) onboarding — spacing variant, 25 in-stock feed rows'),
  ('studio 10',     'Studio10',     '20Jul26 Gorgeous Shop (r30) onboarding — spacing variant, 2 in-stock feed rows')
ON CONFLICT (alias) DO UPDATE
  SET canonical = EXCLUDED.canonical,
      notes     = EXCLUDED.notes;
