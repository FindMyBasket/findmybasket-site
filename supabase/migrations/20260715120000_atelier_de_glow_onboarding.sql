-- Atelier De Glow onboarding — retailer 29 (AWIN Darwin / google_shopping feed).
--
-- What it is (diagnosed read-only, see scripts/atelier-feed-diag.mts):
--   Multi-brand K-BEAUTY SKINCARE retailer (Skin Cupid / Stylevana pattern, NOT a
--   single-brand direct seller). 690 products, 106 brands, top brand 7.4% share,
--   ~95% skincare, zero fragrance. 315 products deepen a LIVE comparison page
--   (match_key-only floor; GTIN matching should lift it), 195 of those pages
--   currently list Superdrug (12) — this backfills the weekend Superdrug removal.
--
-- Feed transport mirrors Branded Beauty (6): the edge runtime can't reliably
-- gunzip the Darwin feed, so .github/workflows/sync-adg-feed.yml downloads +
-- decompresses the F1207 Darwin URL and stages plain CSV to Supabase Storage;
-- the importer reads feed_url = storage://awin-feeds/atelier-de-glow.csv.
--
-- STAGED, NOT LIVE: retailers.active = false so imported prices do NOT surface on
-- product pages yet. Import first, verify tier-A landing vs the 315 estimate, then
-- flip active = true (a one-line UPDATE) right before the Superdrug removal.
--
-- Config decisions (feed inspected):
--   existing_brands_only = false  — curated 690-row K-beauty specialist, not a
--     marketplace flood; the 91 net-new brands are wanted new K-beauty lines.
--   top_category_default = 'skincare' — mirrors BB's "default = dominant category"
--     (BB uses 'makeup'); Atelier is ~95% skincare. Only fires when inference can't
--     decide; de-risks the feed's category noise (below) surfacing as uncategorised.
--   category_excludes — drop the non-beauty junk the full histogram surfaced:
--     'Vitamins & Supplements' (11 ingestible collagen/glutathione sticks),
--     'Gift Cards' (4 Atelier gift cards),
--     'Hardware' (2 ClearDea shower head + cartridge, filed under Hardware>Plumbing).
--     NOT excluding 'Lighting Accessories' — its 2 rows are real House of Hur
--     "Glow Ampoule Tint" beauty products the feed miscategorised; the categoriser
--     routes them by name.
--   category_path_must_contain = [] — keep makeup (~30) and haircare (~16) too; we
--     carry both. (Contrast Stylevana's skincare-only must_contain scoping.)
--   match_column = 'merchant_product_id', staging_mode = 'inline', sliced_import =
--     false (690 rows is tiny), streaming_enabled = false — all per BB precedent.
--
-- NOTE ON ARRAY LITERALS: category_excludes/name_excludes/category_path_must_contain
-- are written below as jsonb. If your schema defines them as text[] (check BB's
-- row), replace each `'[...]'::jsonb` with `ARRAY[...]::text[]` (or '{}'::text[]).

-- 1. Retailer row (staged inactive; name/base_url from feed advertiser + link domain).
INSERT INTO retailers (id, name, base_url, active)
VALUES (29, 'Atelier De Glow', 'https://atelierdeglow.com', false)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      base_url = EXCLUDED.base_url;
      -- deliberately NOT touching active on conflict, so a re-run never un-lives it.

-- 2. Import config (google_shopping / storage-staged, per BB precedent).
INSERT INTO retailer_import_config (
  retailer_id, feed_format, feed_url, awin_feed_id, awin_merchant_id,
  match_column, existing_brands_only, top_category_default,
  category_excludes, name_excludes, category_path_must_contain,
  sliced_import, staging_mode, streaming_enabled, enabled
) VALUES (
  29,
  'google_shopping',
  'storage://awin-feeds/atelier-de-glow.csv',
  '119037',                 -- AWIN datafeed id (reference; fetch uses the F1207 URL)
  '119037',                 -- awinmid in the aw_deep_link (unused for google_shopping)
  'merchant_product_id',
  false,
  'skincare',
  '["Vitamins & Supplements","Gift Cards","Hardware"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  false,
  'inline',
  false,
  true                      -- enabled=true so the real import writes prices; frontend
                            -- stays dark via retailers.active=false until we flip it.
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
