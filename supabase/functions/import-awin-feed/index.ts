// Edge function: import-awin-feed (v6.20)
//
// Generic, retailer-agnostic AWIN datafeed importer.
//
// v6.20 changes (streaming I/O path, feature-flagged):
//   - New retailer_import_config.streaming_enabled flag (default false). When
//     true, the feed is fetched, gzip-inflated and CSV-parsed as a STREAM
//     (_streaming-fetcher.ts + _streaming-csv.ts) instead of loading the whole
//     decompressed feed (4.85GB uncompressed for Debenhams) into memory. This
//     removes the ~256MB edge-runtime OOM ceiling on feed size.
//   - Memory note: the three action buckets (update/link/create) are NOT the
//     OOM — they are already bounded (updates <= existing retailer rows, links
//     deduped to <= catalogue size, creates <= the 20k safety cap). So this
//     change streams ONLY the I/O; action accumulation and the entire apply
//     phase are byte-for-byte unchanged. Link price-dedup, the 20k cap, and
//     dry-run derived stats all keep working exactly as before.
//   - gzip stays on pako (Deno's DecompressionStream still fails on large feeds,
//     see v6.5/v6.6) but is now driven incrementally via pako.Inflate push mode.
//   - STORAGE BYPASS: streaming is gated to HTTP feeds only (streamingActive =
//     streaming_enabled && !storage://). A storage:// object is already fully
//     buffered by supabase-js .download(), so streaming it gains no memory
//     benefit; the flag is a no-op there and the legacy buffered path runs.
//     (Empirically the HTTP streaming path is 10/10 reliable across retailers;
//     storage:// imports are memory-marginal and flakily 546 on BOTH legacy and
//     streaming — a pre-existing condition, not introduced here. Debenhams gets
//     streaming when its feed_url is switched off storage:// to a direct AWIN
//     fid, which is exactly when streaming is needed and reliable.)
//   - PERF: the fetcher yields BATCHES of rows (one per source chunk), not one
//     row at a time. Per-row async yields (~7.7k awaits) alone flakily tripped
//     the edge resource limit; batching drops awaits to ~one-per-chunk and the
//     consumer loops each batch synchronously.
//   - The streaming CSV parser is correct for embedded newlines in quoted
//     fields (legacy split-on-\n shattered those rows); on a feed containing
//     such rows the streaming action counts can legitimately differ there.
//   - The <50-row safeguard runs post-stream (pre-apply) on the streaming path
//     since the row count is not known up front.
//   - Known floor (separate future spec): the in-memory catalogue lookup maps
//     (~92k products) are independent of feed size and set the real memory
//     floor; streaming does not address them.
//
// v6.19 changes (chunk all bulk-apply RPCs):
//   - bulk_update_retailer_prices and bulk_update_product_images were each sent
//     as a single statement over the whole update batch. On large feeds
//     (~6,800 rows for Debenhams) that exceeds the Postgres statement timeout
//     and the statement is cancelled, silently dropping the entire batch — the
//     price RPC was losing most of Boots's daily writes, the image RPC dropped
//     the whole update-path image backfill (4,234 Debenhams products left with
//     no image_url). v6.18's monitoring surfaced the image timeout.
//   - All three (prices, update-image, link-image) now chunk at INSERT_CHUNK
//     (500), matching the link/create upserts. updatesApplied accumulates with
//     += across chunks instead of being overwritten.
//
// v6.18 changes (dry_run bypasses enabled gate):
//   - The config.enabled gate now only blocks writes (dry_run=false); dry-runs
//     are always allowed so disabled retailers can still be inspected.
//
// v6.17 changes (Categorisation — deploy v55):
//   - Hair-brand whitelist now includes davines and schwarzkopf (were dropped
//     from the v54 whitelist, leaving brand-only hair products misfiled as
//     skincare, e.g. "Davines OI All in One Milk", "Got2B Curlz Defining Jelly").
//   - inferCategorisation bails out of hair detection for brow/eyebrow products
//     BEFORE the brand-whitelist branch, so brow makeup from a hair brand
//     (Schwarzkopf Got2B "Brows & Edges", "Brow Lift") routes to makeup, not
//     hair. \bbrow\b does not match "brown", so hair-dye shades are unaffected.
//   - Makeup brow detection broadened to plural "brows" / "brow lift".
//   - Comfort Zone / Sacred Nature (Davines' skincare sister line) stays skincare.
//
// v6.16 changes (Stream B — canonical_size):
//   - New extractCanonicalSize() pulls a size string (e.g. "50ml", "30g",
//     "1.5oz") from the raw product name. Operates on the unnormalised
//     name to preserve decimals.
//   - createActions now carries canonical_size; productRows insert writes
//     it. Backwards compat: null on rows where extraction is uncertain.
//   - New diagnostic counter canonical_size_extracted_on_new shows hit
//     rate in dry-run output.
//
// v6.15 changes (Boots Clinique fixes):
//   - Makeup detector extended to catch brand-line names that don't use
//     standard product-type descriptors:
//     • 'quickliner' / 'kohl' → Eyeliner (Clinique Quickliner For Eye)
//     • 'face powder' / 'pressed powder' / 'loose powder' / 'superpowder' → Powder
//     • '<descriptor> makeup' (superbalanced/sheer/matte/liquid/cream/stick)
//       → Foundation (Clinique Superbalanced Makeup)
//     • Generic '\\bmakeup\\b' as last resort, with 'makeup remover' guard
//
// v6.14 changes (Boots fine-tuning):
//   - Eyebrow makeup detection extended: now matches "eyebrow enhancer/gel/
//     definer/fixer/sculptor" not just "eyebrow pencil". Routes E.L.F. Wow
//     Eyebrow Enhancer Gel and similar products correctly to makeup/Brow/eyes.
//   - Fragrance denylist now skipped when product name contains a clear
//     haircare/body-care indicator (shampoo, conditioner, body lotion, etc.).
//     Fixes Batiste Dry Shampoo "Floral Fragrance" and similar scent-descriptor
//     false positives. Still catches real fragrance products.
//
// v6.13 changes (Boots scope investigation):
//   - Response now includes category_path_breakdown: top 100 unique
//     category paths with row counts, sorted desc. Used to design
//     category_path_must_contain filters per retailer.
//
// v6.12 changes (Boots scaling):
//   - Safety cap raised from 10000 to 20000 new products in one run, to
//     accommodate Boots's large multi-vertical catalogue (42K feed rows).
//   - Safety cap response now returns status 200 (was 400) so the breakdown
//     payload is visible in Supabase UI when triggered. Error field still
//     present in body to indicate the cap fired and writes were aborted.
//
// v6.11 changes (post-Escentual dry-run cleanup, round 2):
//   - Fragrance denylist now catches 'Parfum Spray', 'Parfum Refill', and
//     'Parfum NNml' (Acqua di Gio, Mitsouko etc.) while preserving 'Perfumed'
//     and 'Perfuming' forms used in scented skincare body products.
//
// v6.10 changes (post-Escentual dry-run cleanup):
//   - Aftershave fragrance regex now distinguishes splash vs balm/lotion.
//     "After Shave 100ml" or "After Shave Spray" → fragrance (excluded).
//     "After Shave Balm/Lotion/Cream" → kept (skincare, men's grooming).
//   - Hair-tool denylist extended: catches Mason Pearson Brushes brand
//     and bristle/paddle/boar bristle brush descriptors that would otherwise
//     fall into skincare catchall.
//
// v6.9 changes (post first-import-dry-run cleanup):
//   - Lip cream/paint/colour/color/liquid lip/matte lip now route to makeup
//     (previously fell through to skincare Moisturiser/Lip Care)
//   - Contouring/highlighting/strobing variants now route to Blush/Bronzer
//     (previously matched as skincare via the generic 'cream' or fell to
//     'Skincare' catchall)
//   - 'baby' denylist tightened to actual infant products. The Maybelline
//     "Baby Lips" line was being incorrectly excluded.
//   - 'shake' removed from supplement denylist — too many cosmetic product
//     names use it as a noun (Shake Things Up, Pink Shake, etc.). Replaced
//     with explicit 'protein shake|meal replacement'.
//
// v6.8 changes:
//   - Add support for storage:// URL scheme. When config.feed_url is
//     "storage://bucket/path", the function reads from Supabase Storage using
//     the service role key. Used for Darwin format feeds where the edge
//     function runtime can't decompress the gzipped Darwin feed reliably.
//     A separate process (GitHub Action) is responsible for keeping the
//     file in storage fresh.
//
// v6.7 changes:
//   - Add Accept-Encoding: identity header to fetch(). Deno was reporting
//     "invalid distance too far back" when decompressing the AWIN file, with
//     bytes matching at the start but pako finding corrupted data mid-stream.
//     Most likely cause: AWIN's CDN sometimes applies transport-level gzip
//     to an already-gzipped file, and Deno's auto-decompression mishandles
//     the double-encoded result.
//
// v6.6 changes:
//   - Replace Deno's DecompressionStream("gzip") with pako library for gzip
//     decompression. The native API was failing with "failed to write whole
//     buffer" on feeds ~1.5MB+ regardless of streaming pattern.
//
// v6.5 changes:
//   - Replace Response().text() decompression pattern with explicit
//     ReadableStream + reader chunk drain. The Response.text() path was
//     failing on ~1.5MB gzipped bodies with "failed to write whole buffer".
//     This buffered approach handles the full file reliably.
//
// v6.4 changes:
//   - Move decompression diagnostics to console.log instead of response body
//     (Supabase test panel truncates long response bodies).
//
// v6.3 changes:
//   - Wrap gzip decompression in try/catch with diagnostic response so we can
//     see the actual response bytes/headers when AWIN returns something
//     unexpected.
//
// v6.2 changes:
//   - Auto-detect whether feed body is gzipped (magic bytes 1f 8b) before
//     attempting decompression. Some endpoints set Content-Encoding: gzip
//     causing Deno's fetch to auto-decompress, which broke the unconditional
//     DecompressionStream call.
//
// v6.1 changes:
//   - Added Google Shopping format support (AWIN's new "Darwin" datafeed format
//     that all advertisers are migrating to). Selected via config.feed_format.
//   - Optional config.feed_url override — if set, function fetches this URL
//     directly instead of building one from feed_id. Required for Darwin feeds
//     because their download URLs include a per-feed token, not the API key.
//   - Existing AWIN-format retailers (Boots, Escentual, Stylevana) unchanged
//     because feed_format defaults to 'awin' and feed_url is null.
//
// v6 changes:
//   - Replaced inferCategory() with inferCategorisation() — returns
//     {top_category, product_type, subcategory, tags, excluded?}
//   - Products matching v6 denylist (fragrance, deodorant, period_care,
//     supplements, oral_care, shaving, hair_tool, makeup_tool, bath_set,
//     baby, accessory) are now excluded at import time
//   - Per-retailer top_category_default override via retailer_import_config
//   - Newly-inserted products receive: category, product_type, top_category,
//     subcategory, tags
//   - New diagnostic counters: v6_excluded, v6_top_category_breakdown,
//     v6_sample_excluded
//
// IMPORTANT — pre-deployment requirement:
//   After deploying this function, run:
//     ALTER TABLE products ALTER COLUMN subcategory DROP DEFAULT;
//   This forces this code to be the source of truth for subcategory.
//   Order matters — do this AFTER deploying, not before.
//
// Purpose:
//   - Pull AWIN datafeed for a retailer
//   - Match feed rows against existing products in DB
//   - INSERT new products that don't exist yet
//   - INSERT new retailer_prices rows linking products to this retailer
//   - Update prices/URLs/stock for existing rows
//   - Filter by CATEGORY (configurable per retailer in retailer_import_config)
//   - Filter by v6 inference denylist (built into inferCategorisation)
//
// What this function does NOT do:
//   - Mark products out of stock when missing from feed (let refresh-awin-feed do that on its weekly run)
//
// Modes:
//   - dry_run = true (default): report what WOULD happen, no writes
//   - dry_run = false: apply changes
//
// Required env vars:
//   - AWIN_API_KEY (Edge Function secret)
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto)
//
// Required tables:
//   - retailer_import_config (per-retailer settings)
//   - retailers, products, retailer_prices (existing)
//
// Safeguards (abort if):
//   - Feed returns < 50 rows total (likely AWIN incident or bad feed ID)
//   - Would create > 20000 new products in one run (sanity cap)
//   - AWIN_API_KEY missing
//
// Call:
//   POST /functions/v1/import-awin-feed
//   body: { "retailer_id": 11, "dry_run": true }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// pako: pure-JS gzip library. Deno's built-in DecompressionStream("gzip") fails
// with "failed to write whole buffer" on ~1.5MB+ feeds in the edge function
// runtime. pako handles the same input reliably as a single ungzip() call.
import pako from "https://esm.sh/pako@2.1.0";

// Streaming I/O pipeline (used when retailer_import_config.streaming_enabled is
// true). Incremental fetch -> incremental gzip inflate -> streaming CSV parse,
// so feed size is no longer bounded by the edge runtime memory ceiling. The
// legacy load-whole-feed path remains the default until a retailer is promoted.
import { streamFeedRowBatches, FeedFetchError } from "./_streaming-fetcher.ts";

const AWIN_PUBLISHER_ID = "2841268";

// AWIN columns we need. merchant_product_category_path and category_name are
// what we filter on. brand_name and product_name go into products table.
function buildFeedUrl(apiKey: string, feedId: string): string {
  const cols = [
    "aw_deep_link",
    "product_name",
    "aw_product_id",
    "merchant_product_id",
    "search_price",
    "store_price",
    "merchant_deep_link",
    "brand_name",
    "rrp_price",
    "in_stock",
    "merchant_product_category_path",
    "category_name",
    // Path 1 / EAN-first matching: barcode + manufacturer part number.
    // Coverage observed: ~99.7% gtin, 100% mpn in real AWIN feeds.
    // ean in CSV column maps to <ean> in XML feeds; mpn maps to <mpn>.
    "ean",
    "mpn",
    // Image URL - feed includes a merchant-hosted image for the product.
    // Used for catalogue display.
    "merchant_image_url",
  ].join("%2C");
  return `https://productdata.awin.com/datafeed/download/apikey/${apiKey}/fid/${feedId}/format/csv/language/en/delimiter/%2C/compression/gzip/adultcontent/1/columns/${cols}/`;
}

function buildCreadUrl(awinMid: string, awinAffid: string, merchantUrl: string): string {
  const clean = merchantUrl.split("?")[0];
  return `https://www.awin1.com/cread.php?awinmid=${awinMid}&awinaffid=${awinAffid}&ued=${encodeURIComponent(clean)}`;
}

// CSV row parser — handles quoted fields with embedded commas and escaped quotes
function parseRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) { out.push(cur); cur = ""; }
    else { cur += ch; }
  }
  out.push(cur);
  return out;
}

// Category filter: returns true if any exclude string appears (case-insensitive)
// anywhere in the combined category text.
function isExcludedCategory(categoryPath: string, categoryName: string, excludes: string[]): { excluded: boolean; matched_term?: string } {
  const haystack = `${categoryPath} ${categoryName}`.toLowerCase();
  for (const term of excludes) {
    if (haystack.includes(term.toLowerCase())) {
      return { excluded: true, matched_term: term };
    }
  }
  return { excluded: false };
}

// Path include-filter: if mustContain is non-empty, the row's category_path
// must contain at least one of these substrings (case-insensitive). Used for
// retailers like Boots whose feed includes everything they sell — we only want
// the rows whose category path identifies them as in-scope (e.g. "Skin Care").
// Empty mustContain array means no include-filter, all rows pass this stage.
function isPathIncluded(categoryPath: string, mustContain: string[]): { included: boolean; reason?: string } {
  if (mustContain.length === 0) return { included: true };
  const haystack = categoryPath.toLowerCase();
  for (const term of mustContain) {
    if (haystack.includes(term.toLowerCase())) {
      return { included: true };
    }
  }
  return { included: false, reason: "path_not_in_scope" };
}

// Name filter: returns true if any exclude string appears (case-insensitive)
// in the product name. Used for retailers whose feeds don't populate
// merchant_product_category_path (e.g. Stylevana).
function isExcludedName(name: string, excludes: string[]): { excluded: boolean; matched_term?: string } {
  if (excludes.length === 0) return { excluded: false };
  const haystack = name.toLowerCase();
  for (const term of excludes) {
    if (haystack.includes(term.toLowerCase())) {
      return { excluded: true, matched_term: term };
    }
  }
  return { excluded: false };
}

// ============================================================================
// inferCategorisation — v6 replacement for inferCategory()
// ============================================================================
//
// Returns a structured object with top_category, product_type, subcategory,
// tags, and an optional excluded reason.
//
// Inference order (matters for ambiguity resolution):
//   1. Excluded categories (fragrance, supplements, etc.) — fast exit
//   2. Hair detection (run before skincare so "hair oil" doesn't go to skincare/Oil)
//   3. Makeup detection (lipstick, mascara, foundation, etc.)
//   4. Skincare detection (existing logic, catchall)
//   5. Subcategory derivation (different vocabulary per top_category)
//   6. Tag derivation (cross-cutting flags)
//
// Returns:
//   - excluded set: caller skips this row, increments excluded counter
//   - excluded unset: caller imports with these category fields
// ============================================================================

type TopCategory = "skincare" | "makeup" | "hair";

type Categorisation = {
  top_category: TopCategory | null;
  product_type: string;
  subcategory: string;
  tags: string[];
  excluded?: string;
};

function inferCategorisation(name: string, brand: string = ""): Categorisation {
  // Insert a space between a letter and an adjacent digit so size/qualifier
  // tokens fused onto a keyword still tokenise, e.g. "Shampoo250ml" →
  // "shampoo 250ml" and "SPF50" → "spf 50". Without this the \b-anchored
  // keyword checks below miss the keyword entirely (no word boundary exists
  // between a letter and a digit).
  const t = String(name || "").toLowerCase().replace(/([a-z])(\d)/g, "$1 $2");
  const b = String(brand || "").toLowerCase();

  // ─── Step 1: Excluded categories (denylist) ──────────────────────────────
  const excludeChecks: Array<[string, RegExp]> = [
    // Aftershave: tricky — "Aftershave Balm/Lotion/Cream" is skincare we want.
    // "After Shave 100ml" (no balm/lotion qualifier) is the alcohol splash form,
    // a fragrance product we exclude. Match the latter precisely.
    // Parfum: distinct from "perfumed" (scented). "Parfum Spray", "Parfum Refill",
    // and "Parfum 50ml" are fragrance. Match those, skip the -ed/-ing forms.
    // 'parfum' on its own is matched: it only ever appears in fragrance product
    // NAMES (never skincare/makeup names — the cosmetic ingredient "parfum"
    // lives in ingredient lists, not titles). Debenhams' newer feed format moves
    // size into a separate "| Size: 50ml" field, so designer perfumes now read
    // "...Le Parfum"/"...Parfum Intense" with no adjacent "50ml" — the old
    // size-anchored parfum arm missed them. "parfumed" is unaffected (\b after).
    ["fragrance", /\b(fragrance|perfume|cologne|parfum|eau de (parfum|toilette)|edt|edp|aftershave splash|aftershave spray|aftershave cologne|after.?shave \d+\s*(ml|oz)\b|after.?shave (splash|spray|cologne))\b/],
    ["supplement", /\b(supplement|vitamin tablet|capsule|gummies|protein shake|meal replacement|powder drink|fish oil|cod liver oil|effervescent tablet)\b/],
    ["oral_care", /\b(toothpaste|toothbrush|mouthwash|dental floss|whitening strip)\b/],
    ["period_care", /\b(tampons?|sanitary pads?|menstrual|period care|panty liner|pantyliner)\b/],
    ["deodorant", /\b(deodorant|antiperspirant|body spray)\b/],
    ["shaving", /\b(razor|shaving foam|shave gel|shave cream|epilator|wax strip)\b/],
    // appliance: electric grooming devices (men's trimmers, clippers, electric
    // shavers, laser caps). Debenhams' AWIN feed leaves category_path empty for
    // these (or labels them "Haircare Appliances"), so the path/category
    // excludes can't catch them — they fall through to the skincare catchall.
    // Match on the device noun in the name instead. 'shaver' is distinct from
    // the 'shaving' wet-shave consumables above (foam/gel/razor).
    ["appliance", /\b(trimmer|clippers?|electric shaver|shaver|groomer|laser ?cap)\b/],
    // eyewear: sunglasses/optical frames. Same feed gap — these arrive with an
    // empty category and a model-code name ("BOSS 1743/S", "CK19137S", "FT0995")
    // rather than the word "Sunglasses", so name_excludes ("Sunglasses") and the
    // category excludes both miss them and they default to skincare/face. Catch
    // via (a) eyewear vocabulary, (b) a frame-shape word paired with a sunglasses
    // model suffix (digits + "/" + letter, the "/S" sun convention), or (c) the
    // designer eyewear SKU patterns present in the feed (CK#####, FT####, SY####).
    // \b before "ck"/"ft" prevents matching inside soft/black/gift etc.
    ["eyewear", /\b(sunglasses?|eyewear|eyeglasses|spectacles|aviator|wayfarer|clubmaster|polari[sz]ed|anti.?reflective|oleophobic)\b|\b(rectangle|round|square|wrap|cat.?eye|oval|pilot|browline|rimless)\b.*\b\d{3,4}\s?\/\s?[a-z]\b|\b(ck\s?\d{4,5}s?|ft\s?\d{3,4}|sy\s?\d{4,5}|gg\s?\d{3,4}\s?s[a-z]?)\b/],
    // apparel / footwear / bags: clothing and accessories that arrive with an
    // empty category_path (the well-categorised ones are already dropped by the
    // config category excludes "Clothing"/"Footwear"/"Bags & Wallets"). These
    // leak the same way eyewear does. Match on garment/footwear/bag nouns that
    // don't occur in beauty product names. Deliberately omits collision-prone
    // words: "top"/"coat" (top coat, base coat), "cap" (laser cap, bottle cap),
    // "boots" (Boots the brand/retailer), "shorts" ("short sleeve").
    ["apparel", /\b(trunks?|boxers|briefs|jockstrap|jumper|hoodie|sweatshirt|sweater|cardigan|joggers?|jeans?|trousers?|chinos?|leggings?|shorts?|pants?|cargo|fleece|shirt|t-shirt|tee|polo|blouse|jacket|blazer|gilet|waistcoat|parka|robe|kimono|pyjamas?|pajamas?|dungarees?|beanie|scarf|belt|sneakers?|trainers?|loafers?|brogues?|espadrilles?|sandals?|flip ?flop|cupsole|lace[-\s]?up|low top|rucksack|backpack|duffle|holdall|satchel|crossbody|commuter|wash ?bag|dopp|wallet|billfold|card holder|cardholder|card case)\b/],
    // hair_tool: extended to catch hair brushes by brand (Mason Pearson) and
    // by descriptor patterns (bristle brush, boar bristle, paddle brush etc.)
    ["hair_tool", /\b(hair dryer|straightener|curling iron|curling wand|hair brush|paddle brush|bristle brush|boar bristle|comb|hair clip|hair tie|scrunchie|mason pearson)\b/],
    ["makeup_tool", /\b(makeup brush|beauty blender|sponge|eyelash curler|brush set|brush cleaner)\b/],
    // device: electronic skincare appliances that carry the word "mask" (LED /
    // light-therapy / photon / EMS face masks). They'd otherwise land in the
    // skincare Mask bucket. Require an LED/therapy signal alongside "mask" so
    // sheet/clay/sleeping masks are unaffected.
    ["device", /\b(led|light therapy|photon)\b.*\bmask\b|\bmask\b.*\b(led|light therapy|photon)\b/],
    ["bath_set", /\b(gift set|bath set|body care set|grooming set|skincare set)\b/],
    // 'baby' must NOT match the Maybelline "Baby Lips" line (mainstream lip balm).
    // Match only when 'baby' clearly indicates infant/child product, not when it's
    // a brand line name used in adult cosmetics.
    ["baby", /\b(baby (cream|lotion|wash|shampoo|wipes?|powder|oil|bath|skincare|sunscreen|sun cream)|babies|infant|newborn|toddler|nappy|diaper)\b/],
    ["accessory", /\b(headband|hair tie|spatula|applicator only|case only|bag only|pouch)\b/],
  ];
  // Pre-check: identify clear-cut hair/body-care contexts where 'fragrance'
  // appears as a scent descriptor rather than as the product type.
  // Examples: "Batiste Dry Shampoo... Floral Fragrance Hair Shampoo".
  // When this fires, we skip the fragrance denylist entry but still apply
  // the rest of the denylist normally.
  // ...but a hard fragrance product form (Eau de Toilette/Parfum/Cologne, EDT,
  // EDP, "Parfum Spray/Refill/Nml") is unambiguously a fragrance product even
  // when the name also bundles a shower gel / aftershave balm (gift sets like
  // "...Eau de Toilette Spray 125ml After Shave Balm 100ml Shower Gel 100ml").
  // Don't let the body-care descriptor bypass rescue those — keep excluding.
  const hasHardFragranceForm = (
    /\b(eau de (parfum|toilette|cologne)|edt|edp|parfum (spray|refill|refillable)|parfum \d+\s*(ml|oz))\b/.test(t)
  );
  const fragranceIsScentDescriptor = (
    /\b(shampoo|conditioner|hair mask|hair oil|hair serum|hair spray|hairspray|dry shampoo|body wash|body lotion|body cream|body butter|hand cream|shower gel|bubble bath)\b/.test(t)
    && !hasHardFragranceForm
  );
  // Pre-check: "body spray" matches the deodorant denylist, but sunscreen and
  // oil body sprays (e.g. "SPF30 Sunscreen Body Spray", "Dry Oil Body Spray")
  // are skincare. Skip the deodorant entry for those — unless the name actually
  // says deodorant/antiperspirant (then it really is one, keep excluding).
  const bodySprayIsSkincare = (
    /\b(spf|sunscreen|sun cream|self.?tan|tanning|dry oil|body oil|moistur)\b/.test(t) &&
    !/\b(deodorant|antiperspirant)\b/.test(t)
  );

  for (const [reason, re] of excludeChecks) {
    // Skip fragrance denylist when the name is clearly haircare/body care
    // and 'fragrance' appears as a scent descriptor.
    if (reason === "fragrance" && fragranceIsScentDescriptor) continue;
    // Skip deodorant denylist for sunscreen/oil body sprays (see above).
    if (reason === "deodorant" && bodySprayIsSkincare) continue;
    if (re.test(t)) {
      return {
        top_category: null,
        product_type: "",
        subcategory: "",
        tags: [],
        excluded: reason,
      };
    }
  }

  // ─── Step 2: Hair detection ──────────────────────────────────────────────
  // Run BEFORE skincare so "hair oil" or "hair mask" goes to hair, not skincare.
  // Beard products are facial men's-grooming (skincare), not hair — even from
  // hair-only brands like American Crew. Detect them first and let them fall
  // through to skincare below. (Beard tools — comb/brush — are denylisted in
  // Step 1 already, so this only sees beard care products.)
  const beardGrooming = /\bbeard\b/.test(t);
  const hairCheck = (() => {
    if (beardGrooming) return false;
    // Brow/eyebrow products are makeup, not hair — even when they come from a
    // whitelisted hair brand (e.g. Schwarzkopf Got2B "Glued 4 Brows & Edges",
    // "Brow Lift Styling Wax"). Bail here so they fall through to the makeup
    // detector below. \bbrow\b does NOT match "brown" (no word boundary between
    // "brow" and "n"), so hair-dye shades like "Dark Brown" are unaffected.
    if (/\b(eyebrows?|brows?)\b/.test(t)) return false;
    // Davines' sister skincare line (Comfort Zone / Sacred Nature) can ship
    // under the Davines brand — keep it skincare, don't let the brand whitelist
    // sweep it into hair.
    if (/\bcomfort zone\b/.test(t) || /\bcomfort zone\b/.test(b)) return false;
    if (/\b(shampoo|conditioner|co-?wash|leave-?in)\b/.test(t)) return true;
    if (/\b(hair (mask|oil|serum|spray|cream|gel|mousse|wax|balm|treatment|tonic|perfector|repair|food|primer))\b/.test(t)) return true;
    if (/\b(scalp (treatment|serum|oil|scrub|tonic|massage))\b/.test(t)) return true;
    if (/\b(hair (colour|color|dye|toner|bleach))\b/.test(t)) return true;
    if (/\b(dry shampoo|hair perfume|root touch.?up|heat protect|frizz control)\b/.test(t)) return true;
    if (/\b(hairspray|hair spray|hair lacquer|setting spray hair)\b/.test(t)) return true;
    // Standalone styling keywords: unambiguous hair-styling product types that
    // don't carry a "hair" prefix. 'clay'/'paste'/'wax'/'cream' are too generic
    // alone (clay mask, body wax, hand cream) so they're only matched when paired
    // with a styling qualifier (molding/styling/texture/grooming).
    //   - Gate on !brow/eyebrow/concealer: "brow pomade", "concealer pomade" and
    //     "brow styling wax/cream" are makeup, not hair.
    //   - 'sculpting' and 'matte' are intentionally NOT qualifiers — they collide
    //     with skincare "(micro-)sculpting cream" and makeup "matte/sculpting powder".
    if (!/\b(brow|eyebrow|concealer)\b/.test(t) &&
        /\b(pomade|(mo(u)?lding|styling|texturi[sz]ing|texture|grooming) (clay|paste|cream|wax|mud|powder|spray)|sea salt spray|surf spray|edge control)\b/.test(t)) return true;
    // Brand-name signals: brands whose entire range is hair (low risk of false
    // positives), so products with no hair keyword in the name still route to
    // hair (e.g. "Forming Cream", "Surf Infusion", "Full Dry Volume Blast").
    const hairBrand = /\b(olaplex|kerastase|kérastase|moroccanoil|oribe|virtue labs|american crew|bumble and bumble|bumble & bumble|living proof|redken|paul mitchell|pureology|color wow|colour wow|sachajuan|label\.?m|tigi|davines|schwarzkopf|amika|lee stafford|tresemm[eé]|ogx|briogeo|umberto giannini)\b/;
    if (hairBrand.test(t)) return true;
    if (hairBrand.test(b)) return true;
    // 'Matrix' is a hair brand but also a common English word, so trust it only
    // in the brand field — never when it merely appears in a product name
    // (e.g. "Pro-Collagen Overnight Matrix", "Matrix Gel" nail polish).
    if (/\bmatrix\b/.test(b)) return true;
    return false;
  })();

  if (hairCheck) {
    let product_type = "Hair Care";
    let subcategory = "";

    if (/\b(shampoo|co-?wash|cleansing (shampoo|conditioner)|clarifying)\b/.test(t)) {
      product_type = "Shampoo";
      subcategory = "cleanse";
    } else if (/\b(conditioner|leave-?in|detangler)\b/.test(t) && !/\bshampoo\b/.test(t)) {
      product_type = "Conditioner";
      subcategory = "condition";
    } else if (/\b(hair colour|hair color|hair dye|hair toner|hair bleach|root touch.?up)\b/.test(t)) {
      product_type = "Hair Colour";
      subcategory = "colour";
    } else if (/\b(hair (mask|treatment|repair|reconstruct|perfector)|mask|masque|treatment mask|repair mask|bond (builder|repair|maintenance)|protein treatment|deep condition(ing)? treatment)\b/.test(t) || /\bolaplex\b/.test(t)) {
      // In-context bare "mask"/"masque"/"treatment" → Hair Treatment. We only
      // reach here for products already routed to hair (Step 2), so a hair brand's
      // "Repair Mask"/"Toning Treatment Mask" resolves to a treatment, not Hair Care.
      product_type = "Hair Treatment";
      subcategory = "treatment";
    } else if (/\b(hair (oil|serum|tonic))|scalp (oil|tonic|serum|treatment)\b/.test(t)) {
      product_type = "Hair Treatment";
      subcategory = "treatment";
    } else if (/\b(hair (spray|gel|mousse|wax|balm|cream|pomade|paste|fiber|fibre)|hairspray|edge control|pomade|(mo(u)?lding|styling|texturi[sz]ing|texture|grooming) (clay|paste|cream|wax|mud|powder|spray)|sea salt spray|surf spray)\b/.test(t)) {
      product_type = "Hair Styling";
      subcategory = "style";
    } else {
      product_type = "Hair Care";
      subcategory = "treatment";
    }

    return {
      top_category: "hair",
      product_type,
      subcategory,
      tags: ["hair", subcategory].filter(Boolean),
    };
  }

  // ─── Step 3: Makeup detection ────────────────────────────────────────────
  const makeupCheck = (() => {
    // Cushion foundations are unambiguous makeup, but their names commonly also
    // contain skincare-trigger keywords (Mask Fit, SPF, Sun Protection) that
    // would otherwise trip skincare detection (mask/peel/pack, SPF) first. Gate
    // this before any other makeup check so cushions route to makeup regardless.
    // Guard against cushion-related ACCESSORIES (pad/case/puff/sponge) — those
    // are makeup_tools, denylisted in Step 1, not cushion foundations.
    if (/\bcushion\b/.test(t) && !/\b(cushion (pad|case|puff|sponge)|refill only)\b/.test(t)) {
      return true;
    }
    if (/\b(lipstick|lip gloss|lip stain|lip lacquer|lip pencil|lip liner|lip tint|lip plumper|lip cream|lip paint|lip color|lip colour|lip shine|lip crayon|color balm|colour balm|liquid lip|matte lip|cream lip)\b/.test(t)) return true;
    if (/\b(mascara|eyeliner|eye liner|eye shadow|eyeshadow|eyebrows?|brows?)\b/.test(t)) return true;
    // Clinique 'Quickliner For Eye' brand-line pattern
    if (/\b(quickliner|kohl)\b/.test(t)) return true;
    if (/\b(foundation|concealer|colour corrector|color corrector|primer)\b/.test(t)) return true;
    if (/\b(blush|bronzer|highlighter|highlighting|contour|contouring|illuminator|strobing|strobe)\b/.test(t)) return true;
    // 'bronze' standalone is risky (skincare body products use it) — only treat
    // as makeup when paired with a powder/shimmer cosmetic descriptor.
    if (/\bbronze\b.*\b(powder|palette|stick|shimmer|glow palette)\b/.test(t)) return true;
    if (/\b(setting (spray|powder)|finishing powder|fixing spray|fixing mist)\b/.test(t)) return true;
    // Face powder variants (Clinique Superpowder, Sheer Pressed Powder, etc.)
    if (/\b(face powder|pressed powder|loose powder|compact powder|superpowder|powder makeup)\b/.test(t)) return true;
    if (/\b(nail (polish|colour|color|lacquer|varnish|enamel)|nail (treatment|strengthener)|cuticle (oil|cream)|nail base|base coat|top coat|nail file)\b/.test(t)) return true;
    if (/\bfalse (lashes|eyelashes)|lash (extension|adhesive|glue)\b/.test(t)) return true;
    // Generic 'makeup' as a noun (Clinique 'Superbalanced Makeup' brand line).
    // Excludes 'makeup remover' (denylisted earlier) and 'makeup brush' (in
    // makeup_tool denylist run before this detector). Must come last so that
    // more specific product-type detection above takes precedence for routing.
    if (/\bmakeup\b/.test(t) && !/\bmakeup (remover|removal|wipe)\b/.test(t)) return true;
    return false;
  })();

  if (makeupCheck) {
    let product_type = "Makeup";
    let subcategory = "";

    // Eyes
    if (/\b(mascara)\b/.test(t)) {
      product_type = "Mascara";
      subcategory = "eyes";
    } else if (/\b(eyeliner|eye liner|quickliner|kohl)\b/.test(t)) {
      product_type = "Eyeliner";
      subcategory = "eyes";
    } else if (/\b(eyeshadow|eye shadow)\b/.test(t)) {
      product_type = "Eyeshadow";
      subcategory = "eyes";
    } else if (/\b(eyebrows?|brows?)\b/.test(t)) {
      product_type = "Brow";
      subcategory = "eyes";
    } else if (/\bfalse (lashes|eyelashes)|lash (extension|adhesive|glue)\b/.test(t)) {
      product_type = "Lashes";
      subcategory = "eyes";
    }
    // Lips — order matters: most specific first so 'matte lip liner' doesn't
    // get matched as a Lipstick before the Lip Liner check.
    else if (/\b(lip pencil|lip liner)\b/.test(t)) {
      product_type = "Lip Liner";
      subcategory = "lips";
    } else if (/\b(lip gloss|lip stain|lip lacquer|lip tint|lip plumper|lip paint|lip color|lip colour|lip shine)\b/.test(t)) {
      product_type = "Lip Colour";
      subcategory = "lips";
    } else if (/\b(lipstick|liquid lip|matte lip|cream lip|lip cream|color balm|colour balm|lip crayon)\b/.test(t)) {
      product_type = "Lipstick";
      subcategory = "lips";
    }
    // Face
    else if (/\bcushion\b/.test(t)) {
      // Cushion foundations: most don't carry the word "foundation" in the name
      // (TirTir Mask Fit, Clio Kill Cover, Unleashia, Missha, etc.), so resolve
      // them to Foundation before the keyword-based Foundation branch below.
      product_type = "Foundation";
      subcategory = "face";
    } else if (/\b(foundation|bb cream|cc cream|skin tint|tinted moisturiser|tinted moisturizer)\b/.test(t)) {
      product_type = "Foundation";
      subcategory = "face";
    } else if (/\b(concealer|colour corrector|color corrector)\b/.test(t)) {
      product_type = "Concealer";
      subcategory = "face";
    } else if (/\bprimer\b/.test(t)) {
      product_type = "Primer";
      subcategory = "face";
    } else if (/\b(setting (powder|spray)|finishing powder|fixing (spray|mist))\b/.test(t)) {
      product_type = "Setting";
      subcategory = "face";
    } else if (/\b(face powder|pressed powder|loose powder|compact powder|superpowder|powder makeup|sheer.{0,10}powder)\b/.test(t)) {
      product_type = "Powder";
      subcategory = "face";
    } else if (/\b(blush|bronzer|highlighter|highlighting|contour|contouring|illuminator|strobing|strobe|cheek (colour|color|tint|stick))\b/.test(t)) {
      product_type = "Blush/Bronzer";
      subcategory = "face";
    } else if (/\bbronze\b.*\b(powder|palette|stick|shimmer)\b/.test(t)) {
      product_type = "Blush/Bronzer";
      subcategory = "face";
    }
    // Nails
    else if (/\b(nail (polish|colour|color|lacquer|varnish|enamel))\b/.test(t)) {
      product_type = "Nail Polish";
      subcategory = "nails";
    } else if (/\b(nail (treatment|strengthener|oil)|cuticle (oil|cream))\b/.test(t)) {
      product_type = "Nail Treatment";
      subcategory = "nails";
    } else if (/\b(superbalanced|sheer|matte|liquid|cream|stick) makeup\b/.test(t)) {
      // Brand-line generic makeup products without a specific descriptor
      // (e.g. Clinique Superbalanced Makeup) are most often foundation.
      product_type = "Foundation";
      subcategory = "face";
    } else {
      product_type = "Makeup";
      subcategory = "face";
    }

    return {
      top_category: "makeup",
      product_type,
      subcategory,
      tags: ["makeup", subcategory].filter(Boolean),
    };
  }

  // ─── Step 4: Skincare detection (existing logic, extended) ────────────────
  // Lip detection MUST run before generic balm/cream/lotion match,
  // otherwise "Lip Balm" gets classified as Moisturiser.
  // Mask over-tagging guard: a coincidental "mask"/"peel"/"pack" token must not
  // steal a product whose primary type is eye / acne-patch / peel-exfoliant /
  // cleanser / toner-pad. These gates run BEFORE the Mask classifier, which then
  // only fires on a genuine face-mask form. (Hair masks are handled upstream in
  // Step 2 via the hair-brand whitelist.) Same precedence approach as the Step 3
  // cushion gate.
  let skincare_product_type = "";
  // Lip first, so "lip mask" → Lip Care not Mask.
  if (/\blip (balm|oil|treatment|mask|scrub|butter|conditioner)\b/.test(t)) skincare_product_type = "Lip Care";
  // Eye context — creams/serums AND under-eye gel/hydrogel patches & pads → Eye Care.
  else if (/\b(eye cream|eye serum|eye gel|eye mask|eye balm|under.?eye|eye (patch|patches|pad|pads)|(gel|hydrogel) (patch|patches))\b/.test(t)) skincare_product_type = "Eye Care";
  // Acne/blemish hydrocolloid patches (spot stickers) → Treatment, NOT Mask.
  else if (/\b(spot|acne|pimple|blemish|hydrocolloid|mighty)\b.{0,20}\b(patch|patches|sticker|stickers|dot|dots|star|stars)\b/.test(t) || /\bpimple patch(es)?\b/.test(t)) skincare_product_type = "Treatment";
  // Peels are exfoliants — but a "peel-off" mask is a mask (caught below).
  else if (/\b(peel|peeling)\b/.test(t) && !/\bpeel[- ]?off\b/.test(t)) skincare_product_type = "Exfoliator";
  // Cleanser forms that collide with the Korean "pack" mask token (e.g.
  // "Pore Pack Foam Cleanser") — claim them as Cleanser before the Mask branch.
  else if (/\b(foam cleanser|cleansing foam|foaming cleanser|gel cleanser|cleansing gel|oil cleanser|cleansing oil|cleansing balm|cleansing water|micellar|face wash|facial wash|cleansing milk|milk cleanser)\b/.test(t)) skincare_product_type = "Cleanser";
  // Toner-soaked pads → Toner. Ampoule/essence/serum pads fall through to Serum;
  // exfoliating/peel pads were already claimed above. (Eye pads handled above.)
  else if (/\b(toner pad|toning pad)\b/.test(t) || (/\b(pad|pads)\b/.test(t) && !/\b(ampoule|essence|serum|cotton|cushion|exfoliat|scrub|peel)\b/.test(t))) skincare_product_type = "Toner";
  // Genuine face-mask forms only: the word "mask", or a real Korean "pack" mask.
  // Bare "peel" and bare quantity "pack" ("3 Pack", "Pack of 100") no longer match.
  else if (/\bmask\b/.test(t) || /\b(sleeping (gel |water |mask )?pack|wash[- ]?off pack|modell?ing pack|clay pack|nose pack|pore pack|peel[- ]?off pack|rubber (mask|pack)|hydrogel pack|jelly pack|zombie pack)\b/.test(t)) skincare_product_type = "Mask";
  else if (/\b(cleanser|cleansing|wash|foam)\b/.test(t)) skincare_product_type = "Cleanser";
  else if (/\btoner\b/.test(t)) skincare_product_type = "Toner";
  else if (/\b(serum|ampoule|essence)\b/.test(t)) skincare_product_type = "Serum";
  else if (/\b(sun|spf|uv|sunscreen)\b/.test(t)) skincare_product_type = "SPF";
  else if (/\b(moistur|cream|lotion|emulsion|balm)\b/.test(t)) skincare_product_type = "Moisturiser";
  else if (/\bsalve\b/.test(t)) skincare_product_type = "Moisturiser";
  else if (/\beye\b/.test(t)) skincare_product_type = "Eye Care";
  else if (/\blip\b/.test(t)) skincare_product_type = "Lip Care";
  else if (/\boil\b/.test(t)) skincare_product_type = "Oil";
  else if (/\bmist\b/.test(t)) skincare_product_type = "Mist";
  else if (/\b(exfoliat|scrub)\b/.test(t)) skincare_product_type = "Exfoliator";
  else skincare_product_type = "Skincare"; // catchall

  // Skincare subcategory: detect from body location keywords. Default 'face'.
  let skin_subcategory = "face";
  if (/\b(hand (cream|lotion|sanit|wash|soap|mask|salve|balm|butter|serum)|hand & nail)\b/.test(t)) {
    skin_subcategory = "hand";
  } else if (/\b(foot (cream|lotion|mask|soak|scrub|balm|serum)|heel balm|heel cream|cracked heel)\b/.test(t)) {
    skin_subcategory = "foot";
  } else if (/\b(body (lotion|cream|butter|oil|wash|scrub|mask|milk|mist|balm|sunscreen|serum)|after.?sun|tanning lotion|self.?tan|stretch mark)\b/.test(t)) {
    skin_subcategory = "body";
  } else if (/\b(face & body|body & face|all over)\b/.test(t)) {
    skin_subcategory = "both";
  } else if (/\b(face cream|face wash|face oil|face mask|facial)\b/.test(t)) {
    skin_subcategory = "face";
  }

  // Skincare tags: include the top_category, the subcategory, and any
  // cross-cutting markers (lip products dual-tagged with 'lips' and 'lip_care').
  const skin_tags: string[] = ["skincare", skin_subcategory];
  if (skincare_product_type === "Lip Care" || /\blip (balm|oil|treatment|mask)\b/.test(t)) {
    if (!skin_tags.includes("lips")) skin_tags.push("lips");
    skin_tags.push("lip_care");
  }
  if (/\b(men|men's|for men|mens|beard)\b/.test(t) || /\b(men|men's|for men|mens)\b/.test(b)) {
    skin_tags.push("mens");
  }

  return {
    top_category: "skincare",
    product_type: skincare_product_type,
    subcategory: skin_subcategory,
    tags: skin_tags,
  };
}

// Normalised name for fuzzy matching (lowercase, alphanumeric only, single spaces)
function normaliseForMatch(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
// Build a match key from brand + name, deduplicating when name starts with brand.
// Handles the case where some retailers put the brand in both the brand field
// AND at the start of the name field (Stylevana and some others),
// while other retailers only put it in the brand field. Without this, the
// matcher creates duplicate products because match keys differ:
//   Retailer A: "mixsoon mixsoon bifida ferment essence 100ml"  (brand in name)
//   Retailer B: "mixsoon bifida ferment essence 100ml"          (brand not in name)
function buildMatchKey(brand: string, name: string): string {
  const normBrand = normaliseForMatch(brand);
  const normName = normaliseForMatch(name);
  if (normBrand && normName.startsWith(normBrand + " ")) {
    return normName;  // Brand already at start of name; don't prepend
  }
  if (normBrand && normName === normBrand) {
    return normBrand;  // Name IS the brand (rare)
  }
  return `${normBrand} ${normName}`.trim();
}
// Normalise EAN/GTIN/UPC for matching: strip non-digits, strip leading zeros.
// Same logic as the SQL generated column ean_normalised on retailer_prices.
// Returns null if the result is shorter than 8 digits (rejects junk codes
// like Superdrug's internal "00000001164169" which strips to "1164169").
// This guarantees JS-side lookups produce keys that match the view's
// normalised values 1:1.
function normaliseEan(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digitsOnly = String(raw).replace(/[^0-9]/g, "");
  const stripped = digitsOnly.replace(/^0+/, "");
  if (stripped.length < 8) return null;
  return stripped;
}

// Normalise MPN: trim + uppercase. Same logic as the SQL generated column.
function normaliseMpn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

// Strip trailing size/count tokens like "100ml", "30 ml", "x 24", "(24pcs)" so
// "cosrx pimple patch 24pcs" and "cosrx pimple patch" can match.
function stripSize(normalised: string): string {
  return normalised
    .replace(/\b\d+\s*(ml|g|kg|oz|pcs|pc|ea|pack|count|ct|sheets?)\b.*$/g, "")
    .replace(/\bx\s*\d+\s*$/g, "")
    .trim();
}

// Extract a canonical size string ("50ml", "30g", "1.5oz") from a raw product
// name. Returns null if no confident size found. Used to populate the
// canonical_size field on new product rows.
//
// Differs from extractSize(): operates on the raw name (precision-preserving,
// decimals intact) and is conservative — requires a clear unit suffix to avoid
// false positives like shade numbers, SPF values, model numbers.
function extractCanonicalSize(rawName: string): string | null {
  if (!rawName) return null;
  const s = String(rawName);
  // Match: optional decimal + optional whitespace + unit (ml/g/kg/oz)
  // (?<!\w) before the digits prevents matching "SPF30ml" (preceded by F)
  // \b after the unit prevents matching "ml" inside other tokens
  const SIZE_REGEX = /(?<!\w)(\d+(?:\.\d+)?)\s*(ml|g|kg|oz|fl\.?\s*oz)\b/gi;
  const matches = [...s.matchAll(SIZE_REGEX)];
  if (matches.length === 0) return null;
  // Take the LAST match — sizes usually appear at end of name, after shade,
  // SPF, model number etc. "Foundation SPF15 30ml" → "30ml".
  const last = matches[matches.length - 1];
  const value = last[1];
  const unitRaw = last[2].toLowerCase().replace(/\s+/g, "").replace("floz", "fl oz");
  return `${value}${unitRaw}`;
}

// Extract a shade name from a raw product name. Returns null if no confident
// shade found. Conservative: ~12% hit rate with ~95% precision.
//
// Patterns matched:
//   1. "... - <Shade>" at end of string (e.g. "Lipstick 3.5g - Cypher")
//   2. "... <Shade>, <size>" (e.g. "NYX Lip Cream Cabo, 14g")
//
// Guards:
//   - Strip trailing size unit from candidate
//   - Length 2-35 chars, must contain a letter, no commas
//   - Max 4 words
//   - Reject product types (Eyeliner, Foundation, Cream, etc.)
//   - Reject skin types (Dry Skin, Oily Skin, etc.)
//   - Reject pack/promo terms (Mini, Set, Kit, etc.)
const SHADE_DENYLIST_EXACT = /^(eyeliner|eyeshadow|mascara|lipstick|lip gloss|lip balm|lip liner|foundation|concealer|powder|blush|bronzer|highlighter|primer|setting spray|setting powder|cleanser|toner|serum|moisturiser|moisturizer|cream|lotion|oil|mask|mist|sunscreen|body wash|shampoo|conditioner|treatment|refill|spray|stick|pen|pencil|brush|sponge|set|mini|travel|sample|trial|gift|bundle|duo|trio|kit|dry skin|oily skin|combination skin|sensitive skin|dehydrated skin|normal skin|mature skin|all skin types)$/i;
const SHADE_DENYLIST_SUFFIX = /\s(eyeliner|eyeshadow|mascara|lipstick|lip gloss|lip balm|lip liner|foundation|concealer|cream|lotion|serum|mask|skin|mist|set|mini|kit|cleanser|toner|essence|ampoule|balm|foam|wash|oil|tissue|pad|patch|sheet|tonic|treatment|fluid|gel|jelly|spray|stick|powder|emulsion|solution|complex|booster|primer|moisturiser|moisturizer|sunscreen|sun cream|hand cream|eye cream|body cream|night cream|day cream|face cream|toothpaste|shampoo|conditioner|deodorant|antiperspirant|fragrance|perfume|tincture|water|milk|drops?|elixir|essence water|mineral water|toner mist|setting mist|face mist|hair mist|body mist)\s*$/i;
function extractShade(rawName: string): string | null {
  if (!rawName) return null;
  const s = String(rawName);

  const cleanCandidate = (raw: string): string | null => {
    let candidate = raw.trim();
    candidate = candidate.replace(/\s+\d+(?:\.\d+)?\s*(ml|g|kg|oz|pcs?|fl\s*oz)\s*$/i, "").trim();
    if (!candidate) return null;
    if (candidate.length < 2 || candidate.length > 35) return null;
    if (!/[A-Za-z]/.test(candidate)) return null;
    if (candidate.includes(",")) return null;
    // Allow up to 6 words if candidate contains a numeric or hash signal (coded shade names),
    // otherwise stick to 4 words max
    const wordCount = candidate.split(/\s+/).length;
    if (wordCount > 6) return null;
    if (wordCount > 4 && !/[#\d]/.test(candidate)) return null;
    if (/^\d+(?:\.\d+)?\s*(ml|g|kg|oz|pcs?|fl\s*oz)?\s*$/i.test(candidate)) return null;
    if (/^(ml|g|kg|oz|pcs|fl\s*oz)$/i.test(candidate)) return null;
    if (SHADE_DENYLIST_EXACT.test(candidate)) return null;
    if (SHADE_DENYLIST_SUFFIX.test(candidate)) return null;
    // Reject pack-quantity patterns like "20g x 10 sheets", "1.5ml x 6 sticks"
    if (/\d+\s*(?:ml|g|kg|oz|pcs?)\s*x\s*\d+/i.test(candidate)) return null;
    // Reject candidate starting with quantity-like patterns "5 sheets", "30 pcs", etc.
    if (/^\d+\s*(?:sheets?|sticks?|pads?|patches|pcs?|tablets?|capsules?|wipes?|sachets?)\b/i.test(candidate)) return null;
    return candidate;
  };

  // Pattern 1: trailing " - <Shade>" at end of string
  const dashMatch = s.match(/\s-\s([^-]+?)\s*$/);
  if (dashMatch) {
    const result = cleanCandidate(dashMatch[1]);
    if (result) return result;
  }

  // Pattern 2: "<Shade>, <size>" where size is at the end
  const commaMatch = s.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s*,\s*\d+(?:\.\d+)?\s*(?:ml|g|kg|oz|pcs?)\b/);
  if (commaMatch) {
    const result = cleanCandidate(commaMatch[1]);
    if (result) return result;
  }

  return null;
}
// Extract a canonical size token from a normalised name.
// Returns "50ml", "10pcs", "65g", or "" if no size detectable.
// Used to verify that two products being matched via stripped key actually share
// the same size — preventing 7ml samples being matched to 50ml full-size products,
// or 1pc masks being matched to 10pc multi-packs.
function extractSize(normalised: string): string {
  // Volume/weight units: 50ml, 30 ml, 65g, 1.7oz, 1kg
  const volMatch = normalised.match(/\b(\d+(?:\.\d+)?)\s*(ml|g|kg|oz)\b/);
  if (volMatch) return `${volMatch[1]}${volMatch[2]}`;
  // Count units: 10pcs, 1pc, 4ea, 24 sheets, 30 ct
  const countMatch = normalised.match(/\b(\d+)\s*(pcs|pc|ea|count|ct|sheets?|pack)\b/);
  if (countMatch) {
    let unit = countMatch[2];
    if (unit === "sheet" || unit === "sheets") unit = "pcs";
    if (unit === "pc") unit = "pcs";
    if (unit === "count" || unit === "ct") unit = "pcs";
    if (unit === "pack") unit = "pcs";
    return `${countMatch[1]}${unit}`;
  }
  // x-multiplier: "x 24" -> "24pcs"
  const xMatch = normalised.match(/\bx\s*(\d+)\s*$/);
  if (xMatch) return `${xMatch[1]}pcs`;
  return "";
}

// Records the outcome of an import attempt on the retailer's config row so that
// monitor-retailer-feeds can alert on failures immediately (instead of waiting
// for the 48h staleness backstop). Best-effort: never throws — a failure to
// write status must not change the import's own success/failure.
async function recordImportStatus(
  supa: any,
  retailerId: number,
  status: "ok" | "error" | "running",
  errorMsg: string | null,
): Promise<void> {
  try {
    await supa
      .from("retailer_import_config")
      .update({
        last_attempt_at: new Date().toISOString(),
        last_import_status: status,
        last_import_error: errorMsg ? errorMsg.slice(0, 1000) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("retailer_id", retailerId);
  } catch (e) {
    console.error("recordImportStatus failed", String(e));
  }
}

// Brand → URL slug. MUST mirror brandSlug() in lib/queries.ts exactly, or the
// revalidation will miss the cached brand route.
function brandSlugify(brand: string): string {
  return brand
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// On-import ISR revalidation (downstream optimisation — NEVER fails the import).
// Finds the brands + top categories whose products got a price for this retailer
// during this run (last_updated >= run start), then POSTs their pathnames to the
// site's /api/revalidate so the brand/category pages refresh without waiting for
// the 1h ISR window. Wrapped so any failure is logged and swallowed.
async function triggerRevalidation(supa: any, retailerId: number, sinceIso: string): Promise<void> {
  try {
    const secret = Deno.env.get("REVALIDATE_SECRET");
    if (!secret) { console.warn("REVALIDATE_SECRET unset — skipping ISR revalidation"); return; }
    const slugs = new Set<string>();
    const cats = new Set<string>();
    let from = 0;
    while (true) {
      const { data, error } = await supa
        .from("retailer_prices")
        .select("products!inner(normalised_brand, top_category)")
        .eq("retailer_id", retailerId)
        .gte("last_updated", sinceIso)
        .range(from, from + 999);
      if (error) { console.warn(`revalidation: brand query failed: ${error.message}`); break; }
      if (!data || data.length === 0) break;
      for (const r of data) {
        const nb = (r as any).products?.normalised_brand;
        const tc = (r as any).products?.top_category;
        if (nb) slugs.add(brandSlugify(String(nb)));
        if (tc) cats.add(String(tc).toLowerCase());
      }
      if (data.length < 1000) break;
      from += 1000;
    }
    const paths = [
      ...Array.from(slugs).filter(Boolean).map((s) => `/brands/${s}`),
      ...Array.from(cats).filter((c) => c === "skincare" || c === "makeup" || c === "hair").map((c) => `/${c}`),
    ];
    if (paths.length === 0) return;
    const resp = await fetch("https://www.findmybasket.co.uk/api/revalidate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-revalidate-secret": secret },
      body: JSON.stringify({ paths }),
    });
    if (!resp.ok) console.warn(`revalidation POST failed: ${resp.status} ${resp.statusText}`);
    else console.log(`revalidation triggered for ${paths.length} path(s) (retailer ${retailerId})`);
  } catch (e) {
    console.warn(`revalidation skipped (error): ${String(e instanceof Error ? e.message : e)}`);
  }
}

serve(async (req) => {
  const startTime = Date.now();

  let body: any = {};
  try { body = await req.json(); } catch {}

  const retailerId = body.retailer_id;
  const dryRun = body.dry_run !== false; // default true

  if (!retailerId || typeof retailerId !== "number") {
    return new Response(JSON.stringify({
      error: "retailer_id (number) required in request body",
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const apiKey = Deno.env.get("AWIN_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "AWIN_API_KEY not set" }), { status: 500 });
  }

  const supa = createClient(supabaseUrl, serviceKey);

  // Step 1: Load retailer config
  const { data: config, error: configErr } = await supa
    .from("retailer_import_config")
    .select("*")
    .eq("retailer_id", retailerId)
    .single();

  if (configErr || !config) {
    return new Response(JSON.stringify({
      error: "No retailer_import_config row for this retailer_id",
      retailer_id: retailerId,
    }), { status: 404, headers: { "Content-Type": "application/json" } });
  }

  if (!config.enabled && !dryRun) {
    return new Response(JSON.stringify({
      error: "Retailer import is disabled (config.enabled = false). Dry-runs (dry_run=true) are permitted for inspection.",
      retailer_id: retailerId,
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // §7 silent-staleness fix: stamp 'running' at the very top of a real apply,
  // before any fetch/decompress/parse work. A hard worker kill (HTTP 546 OOM)
  // terminates the process before the final status write, so without this the
  // row would keep the previous run's 'ok' and the failure stays invisible.
  // Leaving 'running' behind lets monitor-retailer-feeds flag a run that died
  // mid-flight. Gated to real applies — a dry_run returns before the apply
  // phase and must not clobber the last real outcome or strand a 'running'.
  if (!dryRun) {
    await recordImportStatus(supa, retailerId, "running", null);
  }

  const categoryExcludes: string[] = Array.isArray(config.category_excludes)
    ? config.category_excludes
    : [];
  const nameExcludes: string[] = Array.isArray(config.name_excludes)
    ? config.name_excludes
    : [];
  const categoryPathMustContain: string[] = Array.isArray(config.category_path_must_contain)
    ? config.category_path_must_contain
    : [];
  const existingBrandsOnly: boolean = config.existing_brands_only === true;
  // Rollout flag: when true, fetch+decompress+parse the feed as a stream
  // instead of materialising the whole decompressed feed in memory. Defaults to
  // false (legacy path) for every retailer until explicitly promoted.
  const streamingEnabled: boolean = config.streaming_enabled === true;

  // ── Phase 4 (Option C): sliced / resumable import ──────────────────────────
  // Big feeds 546 because one invocation can't finish the lookups+writes inside
  // the worker's variable resource ceiling (see PHASE_4_SLICED_IMPORT_DESIGN.md).
  // A sliced retailer stages its feed to Storage once, then processes it in
  // SLICE_ROWS-sized slices, each a fresh short invocation chained via pg_net.
  //   effectiveMode:
  //     'process' — a slice invocation (body.mode='process', has run_id/slice_index)
  //     'stage'   — explicit, OR a fresh real-apply entry on a sliced retailer
  //     'single'  — everything else (ALL dry-runs, non-sliced retailers): the
  //                 legacy single-invocation path, byte-for-byte unchanged.
  // Dry-runs are never sliced: cross-slice state relies on each slice COMMITTING
  // (the next slice re-derives seen-EAN/MPN and created products from the DB), and
  // a dry-run commits nothing.
  const slicedImport: boolean = config.sliced_import === true;
  // Phase 4b: how a sliced retailer STAGES its feed into slice files.
  //   'inline'              — Phase 4 single-pass stage (stream+parse+upload in one
  //                           invocation). Fits feeds up to ~YesStyle's size.
  //   'storage_passthrough' — Phase 4b two-step stage for very large gzipped feeds
  //                           (Boots): Phase A (mode='stage') ungzips once to a
  //                           single inflated.txt blob; Phase B (mode='split')
  //                           byte-range-reads that blob in bounded, self-chaining
  //                           passes and writes the slice files. Neither step does
  //                           the parse+lookup+write that 546'd the inline stage.
  const stagingMode: "inline" | "storage_passthrough" =
    config.staging_mode === "storage_passthrough" ? "storage_passthrough" : "inline";
  const reqMode: string = typeof body.mode === "string" ? body.mode : "";
  const SLICE_ROWS: number = (typeof body.slice_rows === "number" && body.slice_rows > 0)
    ? Math.floor(body.slice_rows) : 9000;            // knob: pass slice_rows (e.g. 6000) to shrink
  const runId: string = typeof body.run_id === "string" && body.run_id
    ? body.run_id : crypto.randomUUID();
  const sliceIndex: number = (typeof body.slice_index === "number" && body.slice_index >= 0)
    ? Math.floor(body.slice_index) : 0;
  const effectiveMode: "stage" | "split" | "process" | "single" =
    reqMode === "process" ? "process"
    : reqMode === "split" ? "split"
    : (reqMode === "stage" || (slicedImport && !dryRun && !reqMode)) ? "stage"
    : "single";
  // Test hook: auto_chain=false stages/processes WITHOUT firing the next slice via
  // pg_net, so a canary can drive each slice by hand and read its response (incl.
  // the final aggregate). Default true = production fire-and-forget chaining.
  const autoChain: boolean = body.auto_chain !== false;
  const STAGING_BUCKET = "import-staging";
  const slicePath = (i: number) => `${runId}/slice_${i}.jsonl`;

  // v6: per-retailer top_category override (null/missing = let inference decide)
  const topCategoryDefault: TopCategory | null =
    (config.top_category_default === "skincare" ||
     config.top_category_default === "makeup" ||
     config.top_category_default === "hair")
      ? config.top_category_default
      : null;

  // Brand canonicalisation: load the brand_aliases map ONCE (not per row), then
  // map raw feed brands to their canonical form before any downstream use
  // (categorisation, match-key building, storage). Mirrors the table lookup
  // WHERE LOWER(alias) = LOWER(input). Also seeds canonical→canonical so a feed
  // already sending the canonical passes through unchanged.
  const brandAliasMap = new Map<string, string>();
  {
    const { data: aliasRows, error: aliasErr } = await supa
      .from("brand_aliases")
      .select("alias, canonical");
    if (aliasErr) {
      console.warn("brand_aliases load failed; proceeding without canonicalisation:", aliasErr.message);
    } else if (aliasRows) {
      for (const r of aliasRows) {
        const a = String(r.alias ?? "").toLowerCase().trim();
        const c = String(r.canonical ?? "");
        if (a && c) brandAliasMap.set(a, c);
      }
      for (const r of aliasRows) {              // canonical passthrough (don't override an alias row)
        const c = String(r.canonical ?? "");
        const ck = c.toLowerCase().trim();
        if (ck && !brandAliasMap.has(ck)) brandAliasMap.set(ck, c);
      }
    }
  }
  const lookupCanonicalBrand = (raw: string): string => {
    const key = String(raw ?? "").toLowerCase().trim();
    if (!key) return raw;
    return brandAliasMap.get(key) ?? raw;
  };
  // Diagnostics: rows whose brand we rewrote, and unmatched brands by feed
  // frequency (low-frequency ones are surfaced for future alias review).
  let countBrandCanonicalised = 0;
  const unmatchedBrandCounts = new Map<string, number>();

  // ── Phase 2 (chunked apply): per-chunk catalogue lookups ───────────────────
  // The legacy path loaded this retailer's entire price list + the whole product
  // catalogue + the full EAN/MPN indexes into memory up front, which is what
  // OOM'd (HTTP 546) large HTTP feeds — see PHASE_2_CHUNKED_APPLY.md. Instead we
  // now look up only what each streamed chunk needs (keyed on match_brand / ean /
  // mpn / external_product_id) and apply in flushes. The per-row matching body
  // further below is UNCHANGED; it just reads chunk-scoped maps (rebuilt per
  // chunk by loadChunkMaps) plus a small persistent accumulator.
  //
  // DELIBERATE DIVERGENCE: import-rakuten-feed / import-shopify-feed still use the
  // upfront-load pattern. Porting the chunked apply to them is a tracked
  // follow-up, to be done only if they hit memory pressure. Do NOT "harmonise"
  // the trio without reading PHASE_2_CHUNKED_APPLY.md.

  // Chunk-scoped maps — code-keyed (brand-agnostic, potentially huge), rebuilt
  // fresh and dropped every chunk to keep peak memory bounded.
  type StrippedEntry = { id: number; size: string };
  let existingByExtId = new Map<string, any>();
  let eanToProductId = new Map<string, number>();
  let mpnToProductId = new Map<string, number>();

  // PERSISTENT lazy per-brand product cache (Option A, on top of the Option B RPC).
  // NOT reset per chunk: buildMatchKey is brand-prefixed, so a row of brand B only
  // matches products of brand B (Tier 3/4) and entries from different brands never
  // collide — so each brand can be fetched ONCE and retained, and a row sees the
  // same candidates whether its brand loaded this chunk or earlier (outcome parity,
  // proven byte-identical on Beauty Bay/Flash). `loadedBrands` lets loadChunkMaps
  // pass only the NOT-yet-seen brands to the RPC's p_brands, so after warmup the
  // products payload is ~empty — this kills the per-chunk dense-brand refetch that
  // kept load_maps at ~15s under B alone.
  const productByExact = new Map<string, number>();
  const productByStripped = new Map<string, StrippedEntry>();
  const loadedBrands = new Set<string>();

  // Persistent (whole-import) accumulator — survives chunk boundaries, bounded by
  // links+creates (small). Holds the in-feed mutations that used to live on the
  // global maps (§2/§4A of the plan).
  const seenEanToProductId = new Map<string, number>(); // EAN learned via a link this run
  const seenMpnToProductId = new Map<string, number>(); // MPN learned via a link this run
  const createdUrls = new Set<string>();                // URLs created this run (Tier 5 shade-variant suppression; replaces the old urlToProductId -1 sentinel)
  const createdByMatchKey = new Map<string, number>();  // 4A-i: match key → -1 (pending); suppresses duplicate creates only, never links

  // existing_brands_only needs just the distinct set of normalised brands. The
  // big feeds that actually OOM have existing_brands_only=false, so they SKIP this
  // entirely; only the (smaller, not memory-bound) restricted retailers pay the
  // distinct-brand pagination. (Follow-up: replace with an RPC if a large
  // existing_brands_only retailer ever makes this slow.)
  const existingBrandSet = new Set<string>();
  if (existingBrandsOnly) {
    let bfrom = 0;
    while (true) {
      const { data, error } = await supa
        .from("products")
        .select("normalised_brand")
        .not("normalised_brand", "is", null)
        .order("normalised_brand", { ascending: true })
        .range(bfrom, bfrom + 999);
      if (error) {
        await recordImportStatus(supa, retailerId, "error", `DB read failed (distinct brands): ${error.message ?? error}`);
        return new Response(JSON.stringify({ error: "DB read failed (distinct brands)", details: error }), { status: 500 });
      }
      if (!data || data.length === 0) break;
      for (const r of data) {
        const b = String(r.normalised_brand || "").toLowerCase().trim();
        if (b) existingBrandSet.add(b);
      }
      if (data.length < 1000) break;
      bfrom += 1000;
    }
  }

  // Run an `.in(filterCol, slice)` query in bounded key-slices AND paginate each
  // slice past the 1000-row PostgREST cap. CRITICAL: a chunk's brands can match
  // FAR more than 1000 products (L'Oréal Paris alone has ~1,800), so a single
  // un-paginated .in() silently truncates and drops match candidates — the exact
  // bug that made the first canary dry-run lose name matches. Each slice is
  // .order()'d by a stable column so .range() pages don't skip/duplicate rows.
  async function eachIn(
    table: string,
    cols: string,
    filterCol: string,
    keys: string[],
    orderCol: string,
    onRow: (r: any) => void,
    eq?: { col: string; val: any },
  ): Promise<void> {
    const IN_CHUNK = 300;
    for (let i = 0; i < keys.length; i += IN_CHUNK) {
      const slice = keys.slice(i, i + IN_CHUNK);
      let from = 0;
      while (true) {
        let q = supa.from(table).select(cols);
        if (eq) q = q.eq(eq.col, eq.val);
        q = q.in(filterCol, slice).order(orderCol, { ascending: true }).range(from, from + 999);
        const { data, error } = await q;
        if (error) throw new Error(`${table} lookup: ${error.message}`);
        if (!data || data.length === 0) break;
        for (const r of data) onRow(r);
        if (data.length < 1000) break;
        from += 1000;
      }
    }
  }

  // Build the chunk-scoped maps for a buffer of raw feed rows. Over-fetch is
  // intentional and safe: keys are collected from ALL rows in the chunk (even
  // ones the gates below exclude). Excluded rows never consult the maps, so the
  // extra entries change nothing — they only spare us a second gating pass.
  async function loadChunkMaps(rawRows: string[][]): Promise<void> {
    const matchBrands = new Set<string>();
    const eans = new Set<string>();
    const mpns = new Set<string>();
    const extIds = new Set<string>();
    for (const rawFields of rawRows) {
      const f = rawFields.map((x) => x.replace(/^"|"$/g, ""));
      const mb = normaliseForMatch(lookupCanonicalBrand(f[idx.brand_name] || ""));
      if (mb) matchBrands.add(mb);
      if (idx.ean >= 0) { const e = normaliseEan((f[idx.ean] || "").trim()); if (e) eans.add(e); }
      if (idx.mpn >= 0) { const m = normaliseMpn((f[idx.mpn] || "").trim()); if (m) mpns.add(m); }
      const mv = f[matchColumnIdx]; if (mv) extIds.add(mv);
    }

    // EAN/MPN/ext-id maps stay chunk-scoped (brand-agnostic, code-keyed): rebuilt
    // fresh and dropped every chunk. productByExact/productByStripped are PERSISTENT
    // (Option A) — never reset; only grown with brands new to this chunk.
    existingByExtId = new Map();
    eanToProductId = new Map();
    mpnToProductId = new Map();

    // Option A+B: ONE round-trip per chunk via match_chunk_lookups, but p_brands is
    // only the brands NOT yet cached this run. After warmup that list is ~empty, so
    // the products section of the payload is tiny — the dense-brand refetch that
    // kept B-alone's load_maps at ~15s/chunk is gone. EAN/MPN/ext-id are still the
    // full chunk sets (uncached, code-keyed). The four lookups are independent,
    // index-supported set scans; no join, no row explosion. Map-build is
    // byte-identical to v88's per-row callbacks (FIRST-wins products/ean/mpn,
    // LAST-wins ext-id) and the RPC's ORDER BYs (products→id, ean→ean, mpn→mpn,
    // extids→id) preserve the order those guards depend on. Persistent product maps
    // are parity-safe: brand-prefixed keys never collide across brands, and a
    // colliding key's products share a match_brand so they load together →
    // first-id-wins is identical to the per-chunk rebuild. Tier 5 stays dead.
    const missingBrands = [...matchBrands].filter((b) => !loadedBrands.has(b));
    for (const b of missingBrands) loadedBrands.add(b);
    const { data: sets, error: rpcErr } = await supa.rpc("match_chunk_lookups", {
      p_retailer_id: retailerId,
      p_brands: missingBrands,
      p_eans: [...eans],
      p_mpns: [...mpns],
      p_extids: [...extIds],
    });
    if (rpcErr) throw new Error(`match_chunk_lookups RPC: ${rpcErr.message}`);

    for (const p of (sets?.products ?? [])) {
      const exactKey = buildMatchKey(p.brand || "", p.name);
      if (!exactKey) continue;
      if (!productByExact.has(exactKey)) productByExact.set(exactKey, p.id);
      const strippedKey = stripSize(exactKey);
      if (strippedKey && !productByStripped.has(strippedKey)) {
        productByStripped.set(strippedKey, { id: p.id, size: extractSize(exactKey) });
      }
    }
    for (const r of (sets?.eans ?? [])) {
      const k = String(r.ean || "").trim();
      if (k && r.product_id != null && !eanToProductId.has(k)) eanToProductId.set(k, r.product_id);
    }
    for (const r of (sets?.mpns ?? [])) {
      const k = String(r.mpn || "").trim();
      if (k && r.product_id != null && !mpnToProductId.has(k)) mpnToProductId.set(k, r.product_id);
    }
    for (const r of (sets?.extids ?? [])) {
      if (r.external_product_id) existingByExtId.set(r.external_product_id, r);
    }

    // Overlay the persistent in-feed learning so a product linked/created in an
    // earlier chunk is matchable by EAN/MPN in this one (cross-chunk parity with
    // the old global maps). Tier 5's createdUrls is consulted directly below.
    for (const [k, v] of seenEanToProductId) if (!eanToProductId.has(k)) eanToProductId.set(k, v);
    for (const [k, v] of seenMpnToProductId) if (!mpnToProductId.has(k)) mpnToProductId.set(k, v);
  }

  // Step 4: Download feed
  // v6.1: support both legacy AWIN format and new Darwin (Google Shopping) format.
  // Format detection priority:
  //   1. config.feed_url is set → use that URL directly (Darwin path)
  //   2. config.feed_format === 'google_shopping' but no feed_url → error (we need the URL)
  //   3. Otherwise → legacy AWIN format, build URL from API key + feed_id
  const feedFormat: string = (config.feed_format === "google_shopping") ? "google_shopping" : "awin";
  const feedUrlOverride: string | null = (typeof config.feed_url === "string" && config.feed_url.trim().length > 0)
    ? config.feed_url.trim()
    : null;

  let feedUrl: string;
  if (feedUrlOverride) {
    feedUrl = feedUrlOverride;
  } else if (feedFormat === "google_shopping") {
    await recordImportStatus(supa, retailerId, "error",
      "Google Shopping (Darwin) format requires config.feed_url to be set");
    return new Response(JSON.stringify({
      error: "Google Shopping (Darwin) format requires config.feed_url to be set",
      retailer_id: retailerId,
      hint: "Find the download URL in the AWIN dashboard (right-click the download button → Copy Link Address) and store it in retailer_import_config.feed_url",
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  } else {
    feedUrl = buildFeedUrl(apiKey, config.awin_feed_id);
  }

  const fetchT0 = Date.now();
  // Streaming only helps — and is only reliable — for HTTP feeds. A storage://
  // object is already fully buffered into memory by supabase-js .download(), so
  // streaming it gains NO memory benefit; worse, the extra buffered-slice
  // allocations on top of the retained buffer intermittently trip the edge
  // WORKER_RESOURCE_LIMIT (observed: ~33% of storage dry-runs 546'd, while the
  // identically-sized HTTP feed was 5/5 reliable). So storage:// always uses the
  // legacy buffered path even when the flag is on. The flag therefore only
  // changes behaviour for direct-HTTP feeds (the ones big enough to need it,
  // e.g. Debenhams once switched off its storage:// pre-filter).
  const streamingActive = effectiveMode !== "process" && streamingEnabled && !feedUrl.startsWith("storage://");

  // ── Phase 4b — STORAGE-PASSTHROUGH STAGE (Phase A): ungzip ONCE → one blob ──
  // Very large gzipped feeds (Boots) 546 in the inline stage because inflate +
  // per-row CSV parse + JSON.stringify + many slice uploads all run in ONE
  // invocation. Phase A does ONLY the cheap, bounded part: fetch the raw feed,
  // gzip-inflate it in a single pako pass, and upload the inflated bytes as ONE
  // `inflated.txt` blob. The expensive parse+slice is deferred to Phase B
  // (mode='split'), which byte-range-reads that blob in bounded, self-chaining
  // passes. No catalogue lookups and no DB writes here — the two costs that 546.
  // Returns early, so the streaming/legacy fetch dispatch + inline-stage block
  // below never run for a passthrough retailer.
  if (effectiveMode === "stage" && stagingMode === "storage_passthrough") {
    const stageRunStartedAt = new Date().toISOString();
    // Fetch the raw (still-gzipped) feed. Mirrors the legacy block's two source
    // schemes; Boots is a direct-HTTP AWIN feed, storage:// is supported too.
    let rawBuf: ArrayBuffer;
    try {
      if (feedUrl.startsWith("storage://")) {
        const withoutScheme = feedUrl.slice("storage://".length);
        const slashIdx = withoutScheme.indexOf("/");
        const bucket = withoutScheme.slice(0, slashIdx);
        const objectPath = withoutScheme.slice(slashIdx + 1);
        const { data, error } = await supa.storage.from(bucket).download(objectPath);
        if (error || !data) throw new Error(`storage download ${bucket}/${objectPath}: ${error?.message ?? "no data"}`);
        rawBuf = await data.arrayBuffer();
      } else {
        const resp = await fetch(feedUrl, { headers: { "Accept-Encoding": "identity", "User-Agent": "FindMyBasket/1.0 (Supabase Edge Function)" } });
        if (!resp.ok) throw new Error(`feed download ${resp.status} ${resp.statusText} (fid ${config.awin_feed_id})`);
        rawBuf = await resp.arrayBuffer();
      }
    } catch (e) {
      const msg = `passthrough stage fetch failed: ${String(e instanceof Error ? e.message : e)}`;
      await recordImportStatus(supa, retailerId, "error", msg);
      return new Response(JSON.stringify({ error: msg }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    // Inflate once (the bounded step). pako.ungzip for gzip magic 1f 8b, else raw.
    let inflated: Uint8Array;
    try {
      const input = new Uint8Array(rawBuf);
      const gz = input.length >= 2 && input[0] === 0x1f && input[1] === 0x8b;
      inflated = gz ? pako.ungzip(input) : input;
    } catch (gzErr) {
      const msg = `passthrough stage gunzip failed: ${String(gzErr)}`;
      await recordImportStatus(supa, retailerId, "error", msg);
      return new Response(JSON.stringify({ error: msg }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    const totalBytes = inflated.byteLength;
    // Header = bytes up to the first \n. Strip BOM + trailing \r, parse columns
    // exactly like the inline/legacy path. Phase B then starts AFTER the header,
    // so it only ever sees data rows (parity with batchSource's i=1 start).
    const firstNl = inflated.indexOf(0x0A);
    if (firstNl < 0) {
      await recordImportStatus(supa, retailerId, "error", "passthrough stage: no newline in inflated feed");
      return new Response(JSON.stringify({ error: "no newline in inflated feed" }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    const headerLine = new TextDecoder("utf-8").decode(inflated.subarray(0, firstNl)).replace(/^﻿/, "").replace(/\r$/, "");
    const passthroughColumns = parseRow(headerLine).map((c) => c.replace(/^"|"$/g, ""));
    const postHeaderOffset = firstNl + 1;
    // Cheap newline scan for the <50-row safeguard (same intent as the other paths).
    let nlCount = 0;
    for (let i = 0; i < inflated.length; i++) if (inflated[i] === 0x0A) nlCount++;
    const stagedRowsEst = Math.max(0, nlCount - 1); // minus the header line
    if (stagedRowsEst < 50) {
      await recordImportStatus(supa, retailerId, "error", `Feed returned fewer than 50 rows (${stagedRowsEst}) — likely AWIN incident or bad feed ID`);
      return new Response(JSON.stringify({ error: "Feed returned fewer than 50 rows — aborting", staged_rows: stagedRowsEst }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    // Upload the inflated feed as ONE blob (bucket file_size_limit was raised for this).
    const inflatedPath = `${runId}/inflated.txt`;
    {
      const { error: upErr } = await supa.storage.from(STAGING_BUCKET)
        .upload(inflatedPath, new Blob([inflated], { type: "text/plain" }), { upsert: true, contentType: "text/plain" });
      if (upErr) {
        await recordImportStatus(supa, retailerId, "error", `passthrough stage: inflated upload failed: ${upErr.message}`);
        return new Response(JSON.stringify({ error: "inflated upload failed", details: upErr.message }), { status: 502, headers: { "Content-Type": "application/json" } });
      }
    }
    // Init run_state. total_slices is unknown until Phase B finishes → null for now.
    const { error: metaErr } = await supa.from("import_run_state").insert({
      run_id: runId, retailer_id: retailerId, kind: "meta", key: "",
      meta: {
        columns: passthroughColumns, run_started_at: stageRunStartedAt, total_slices: null, next_slice: 0,
        creates_enqueued: 0, slice_rows: SLICE_ROWS, feed_format: feedFormat, staged_rows: stagedRowsEst,
        staging_mode: "storage_passthrough", inflated_blob_path: inflatedPath, inflated_total_bytes: totalBytes,
        next_byte_offset: postHeaderOffset, next_slice_write: 0,
        counts: {}, applied: { updates: 0, links: 0, creates: 0, capped: 0, errors: [] },
      },
    });
    if (metaErr) {
      await recordImportStatus(supa, retailerId, "error", `passthrough stage run_state init: ${metaErr.message}`);
      return new Response(JSON.stringify({ error: "run_state init failed", details: metaErr.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    // Trigger Phase B (split) — fire-and-forget via pg_net, like the inline path.
    if (autoChain) {
      const { error: trigErr } = await supa.rpc("fmb_invoke_import_slice", { p_body: { retailer_id: retailerId, run_id: runId, mode: "split", dry_run: false, slice_rows: SLICE_ROWS } });
      if (trigErr) {
        await recordImportStatus(supa, retailerId, "error", `passthrough stage: failed to trigger split: ${trigErr.message}`);
        return new Response(JSON.stringify({ error: "split trigger failed", run_id: runId, details: trigErr.message }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }
    return new Response(JSON.stringify({
      staged: true, mode: "storage_passthrough", run_id: runId,
      inflated_total_bytes: totalBytes, staged_rows_est: stagedRowsEst, slice_rows: SLICE_ROWS,
    }, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  // ── Phase 4b — SPLIT (Phase B): byte-range-read inflated.txt → slice files ──
  // Self-chaining. Each invocation reads READ_CHUNK_BYTES from the inflated blob,
  // CSV-parses the complete lines, and writes them as slice_<j>.jsonl files of up
  // to SLICE_ROWS rows each (identical format to the inline stage, so Phase C is
  // unchanged). DESIGN NOTE (deviation from the original plan): instead of a
  // partial_row_carry string + CsvLineAccumulator, we advance next_byte_offset to
  // just past the LAST newline in the window. 0x0A never occurs inside a UTF-8
  // multibyte sequence, so every consumed line is whole and decodes cleanly — no
  // row is ever cut, and no carry needs persisting. The last slice of a chunk may
  // be short; that's fine — Phase C tolerates short slices and they stay strictly
  // UNDER the per-slice ceiling. When the blob is exhausted we set total_slices
  // and trigger Phase C slice 0.
  if (effectiveMode === "split") {
    const READ_CHUNK_BYTES = (typeof body.read_chunk_bytes === "number" && body.read_chunk_bytes > 0)
      ? Math.floor(body.read_chunk_bytes) : 5 * 1024 * 1024; // 5MB; override per-call via body.read_chunk_bytes
    const { data: metaRow, error: metaErr } = await supa
      .from("import_run_state").select("meta").eq("run_id", runId).eq("kind", "meta").eq("key", "").maybeSingle();
    if (metaErr || !metaRow?.meta) {
      await recordImportStatus(supa, retailerId, "error", `split: run_state meta missing (run ${runId}): ${metaErr?.message ?? "no meta row"}`);
      return new Response(JSON.stringify({ error: "run_state meta missing", run_id: runId }), { status: 410, headers: { "Content-Type": "application/json" } });
    }
    const sMeta = metaRow.meta;
    const inflatedPath: string = sMeta.inflated_blob_path;
    const totalBytes: number = sMeta.inflated_total_bytes;
    const offset: number = typeof sMeta.next_byte_offset === "number" ? sMeta.next_byte_offset : 0;
    const sliceRows: number = typeof sMeta.slice_rows === "number" && sMeta.slice_rows > 0 ? sMeta.slice_rows : SLICE_ROWS;
    let j: number = typeof sMeta.next_slice_write === "number" ? sMeta.next_slice_write : 0;

    // Range-read [offset, end] inclusive. supabase-js .download() can't do ranged
    // reads, so hit the storage REST object endpoint directly with the service key.
    // Use the PUBLIC project URL, not env SUPABASE_URL: in the edge runtime the
    // latter is the internal gateway, which 400s on a ranged object GET (verified),
    // while the public host serves 206 correctly. Mirrors fmb_invoke_import_slice's
    // hardcoded public URL.
    const PUBLIC_STORAGE_BASE = "https://crtrjoescntlcjiwdtrt.supabase.co";
    const end = Math.min(offset + READ_CHUNK_BYTES, totalBytes) - 1;
    let bytes: Uint8Array;
    try {
      const url = `${PUBLIC_STORAGE_BASE}/storage/v1/object/${STAGING_BUCKET}/${inflatedPath}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, Range: `bytes=${offset}-${end}` } });
      if (!resp.ok && resp.status !== 206) {
        const errBody = await resp.text().catch(() => "");
        throw new Error(`range fetch ${resp.status} ${resp.statusText} url=${url} body=${errBody.slice(0, 300)}`);
      }
      bytes = new Uint8Array(await resp.arrayBuffer());
    } catch (e) {
      await recordImportStatus(supa, retailerId, "error", `split: range fetch failed (run ${runId}, offset ${offset}): ${String(e instanceof Error ? e.message : e)}`);
      return new Response(JSON.stringify({ error: "range fetch failed", run_id: runId, offset }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    const isFinal = offset + bytes.length >= totalBytes;
    let consumeEnd: number;
    if (isFinal) {
      consumeEnd = bytes.length; // last chunk: the final line may have no trailing \n
    } else {
      let lastNl = -1;
      for (let i = bytes.length - 1; i >= 0; i--) { if (bytes[i] === 0x0A) { lastNl = i; break; } }
      if (lastNl < 0) {
        await recordImportStatus(supa, retailerId, "error", `split: no newline in ${READ_CHUNK_BYTES}-byte window (run ${runId}, offset ${offset}) — a row exceeds READ_CHUNK_BYTES`);
        return new Response(JSON.stringify({ error: "row exceeds read window", run_id: runId, offset }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
      consumeEnd = lastNl + 1; // next read resumes exactly at a line boundary
    }
    const textChunk = new TextDecoder("utf-8").decode(bytes.subarray(0, consumeEnd));
    // Parse complete lines exactly like the legacy/inline path (split on \n, skip
    // blank lines, parseRow each). No header here — Phase A advanced past it.
    const rows: string[][] = [];
    for (const line of textChunk.split("\n")) { if (line.trim()) rows.push(parseRow(line)); }

    // Write up to SLICE_ROWS rows per slice file, continuing the global index j.
    try {
      for (let i = 0; i < rows.length; i += sliceRows) {
        const slice = rows.slice(i, i + sliceRows);
        const bodyText = slice.map((r) => JSON.stringify(r)).join("\n");
        const { error: upErr } = await supa.storage.from(STAGING_BUCKET)
          .upload(slicePath(j), new Blob([bodyText], { type: "application/x-ndjson" }), { upsert: true, contentType: "application/x-ndjson" });
        if (upErr) throw new Error(`slice ${j} upload: ${upErr.message}`);
        j++;
      }
    } catch (e) {
      await recordImportStatus(supa, retailerId, "error", `split: ${String(e instanceof Error ? e.message : e)}`);
      return new Response(JSON.stringify({ error: "split slice upload failed", run_id: runId }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    const newOffset = offset + consumeEnd;
    const done = newOffset >= totalBytes;
    // Persist progress. total_slices becomes known only once the blob is exhausted.
    await supa.from("import_run_state")
      .update({ meta: { ...sMeta, next_byte_offset: newOffset, next_slice_write: j, total_slices: done ? j : null } })
      .eq("run_id", runId).eq("kind", "meta").eq("key", "");

    let trigErr: any = null;
    if (autoChain) {
      if (!done) {
        ({ error: trigErr } = await supa.rpc("fmb_invoke_import_slice", { p_body: { retailer_id: retailerId, run_id: runId, mode: "split", dry_run: false, slice_rows: sliceRows, read_chunk_bytes: READ_CHUNK_BYTES } }));
      } else if (j > 0) {
        ({ error: trigErr } = await supa.rpc("fmb_invoke_import_slice", { p_body: { retailer_id: retailerId, run_id: runId, mode: "process", slice_index: 0, dry_run: false, slice_rows: sliceRows } }));
      }
      if (trigErr) await recordImportStatus(supa, retailerId, "error", `split: failed to trigger ${done ? "process slice 0" : "next split"}: ${trigErr.message}`);
    }
    if (done && j === 0) {
      await recordImportStatus(supa, retailerId, "error", "split: produced 0 slices (empty feed after header)");
    }
    return new Response(JSON.stringify({
      split: true, run_id: runId, offset, new_offset: newOffset, consumed_bytes: consumeEnd,
      rows_this_pass: rows.length, slices_written_total: j, total_bytes: totalBytes, done,
      next: done ? (j > 0 ? "process_slice_0" : "none") : "split", trigger_error: trigErr?.message ?? null,
    }, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  // Shared across both fetch paths. The legacy path materialises `lines` and
  // `columns`; the streaming path produces `columns` from the header row and an
  // async iterator (`streamBatchIter`) over the remaining row batches.
  let columns: string[] = [];
  let legacyLines: string[] | null = null;
  let streamBatchIter: AsyncIterator<string[][]> | null = null;
  let pendingFirstRows: string[][] | null = null; // data rows sharing the header's batch
  let fetchMs = 0;

  // Phase 4: process-mode inputs — the header (columns) was captured into
  // run_state.meta at stage time; this slice's rows come from its Storage file.
  // Cross-slice state (createdUrls / creates_enqueued / counters / run_started_at)
  // is seeded from run_state below where each accumulator is declared.
  let processRows: string[][] = [];
  let runMeta: any = null;
  if (effectiveMode === "process") {
    const { data: metaRow, error: metaErr } = await supa
      .from("import_run_state")
      .select("meta").eq("run_id", runId).eq("kind", "meta").eq("key", "").maybeSingle();
    if (metaErr || !metaRow?.meta) {
      await recordImportStatus(supa, retailerId, "error",
        `sliced run_state missing for run_id=${runId} slice=${sliceIndex}: ${metaErr?.message ?? "no meta row"}`);
      return new Response(JSON.stringify({ error: "run_state meta missing", run_id: runId, slice_index: sliceIndex }),
        { status: 410, headers: { "Content-Type": "application/json" } });
    }
    runMeta = metaRow.meta;
    columns = Array.isArray(runMeta.columns) ? runMeta.columns : [];
    const { data: blob, error: dlErr } = await supa.storage.from(STAGING_BUCKET).download(slicePath(sliceIndex));
    if (dlErr || !blob) {
      await recordImportStatus(supa, retailerId, "error",
        `sliced slice file missing: ${slicePath(sliceIndex)}: ${dlErr?.message ?? "no blob"}`);
      return new Response(JSON.stringify({ error: "slice file missing", path: slicePath(sliceIndex) }),
        { status: 410, headers: { "Content-Type": "application/json" } });
    }
    const text = await blob.text();
    processRows = text.length ? text.split("\n").filter((l) => l.length).map((l) => JSON.parse(l) as string[]) : [];
    fetchMs = 0;
    // Seed Tier-5 createdUrls from prior slices (the one accumulator that isn't
    // DB-covered: shade variants share a url but differ by name, §5). Paginated —
    // bounded by creates so far (≈0 for re-imports, larger for first-imports).
    {
      let ufrom = 0;
      while (true) {
        const { data: urlRows, error: uErr } = await supa
          .from("import_run_state").select("key")
          .eq("run_id", runId).eq("kind", "url").order("key", { ascending: true }).range(ufrom, ufrom + 999);
        if (uErr) { console.warn(`createdUrls load failed (run ${runId}): ${uErr.message}`); break; }
        if (!urlRows || urlRows.length === 0) break;
        for (const r of urlRows) if (r.key) createdUrls.add(r.key);
        if (urlRows.length < 1000) break;
        ufrom += 1000;
      }
    }
  } else if (streamingActive) {
    // ── Streaming I/O path ────────────────────────────────────────────────
    try {
      const diagnostics = { gzipped: null as boolean | null, firstBytesHex: "", source: "" };
      const it = streamFeedRowBatches(feedUrl, supa, diagnostics)[Symbol.asyncIterator]();
      const firstRes = await it.next();
      if (firstRes.done || !firstRes.value.length) {
        await recordImportStatus(supa, retailerId, "error",
          "Streaming feed produced no rows (empty body)");
        return new Response(JSON.stringify({
          error: "Streaming feed produced no rows (empty body)",
          feed_format: feedFormat,
        }), { status: 502, headers: { "Content-Type": "application/json" } });
      }
      // First row of the first batch is the header. The parser already strips a
      // leading BOM; the per-field quote strip mirrors legacy header handling.
      // The remaining rows of that batch are real data rows — keep them.
      const firstBatch = firstRes.value;
      columns = firstBatch[0].map((c) => c.replace(/^﻿/, "").replace(/^"|"$/g, ""));
      pendingFirstRows = firstBatch.length > 1 ? [firstBatch.slice(1)] : null;
      streamBatchIter = it;
      fetchMs = Date.now() - fetchT0; // time-to-first-batch (header)
      console.log("FEED_DIAGNOSTIC", JSON.stringify({
        streaming: true,
        first_32_bytes_hex: diagnostics.firstBytesHex,
        gzipped: diagnostics.gzipped,
        source: diagnostics.source,
        feed_format: feedFormat,
      }));
    } catch (e) {
      if (e instanceof FeedFetchError) {
        await recordImportStatus(supa, retailerId, "error", e.message);
        return new Response(JSON.stringify({
          error: e.message, ...e.detail, feed_format: feedFormat,
        }, null, 2), { status: e.status, headers: { "Content-Type": "application/json" } });
      }
      await recordImportStatus(supa, retailerId, "error",
        `Streaming fetch failed: ${String(e)}`);
      return new Response(JSON.stringify({
        error: "Streaming fetch failed — see function logs",
        details: String(e), feed_format: feedFormat,
      }, null, 2), { status: 502, headers: { "Content-Type": "application/json" } });
    }
  } else {
  // ── Legacy load-whole-feed path ───────────────────────────────────────────
  let buf: ArrayBuffer;
  let respStatus = 200;
  const responseHeaders: Record<string, string> = {};

  // Special URL scheme: storage://bucket/path
  // Reads from Supabase Storage using the service role key. Bypasses
  // network/decompression issues with edge function fetches of large feeds.
  // GitHub Actions (or similar) is responsible for keeping the file fresh.
  if (feedUrl.startsWith("storage://")) {
    const withoutScheme = feedUrl.slice("storage://".length);
    const slashIdx = withoutScheme.indexOf("/");
    if (slashIdx < 0) {
      await recordImportStatus(supa, retailerId, "error",
        `Invalid storage URL — expected storage://bucket/path, got ${feedUrl}`);
      return new Response(JSON.stringify({
        error: "Invalid storage URL — expected format storage://bucket/path",
        feed_url: feedUrl,
      }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const bucket = withoutScheme.slice(0, slashIdx);
    const objectPath = withoutScheme.slice(slashIdx + 1);
    const { data: storageData, error: storageErr } = await supa.storage
      .from(bucket)
      .download(objectPath);
    if (storageErr || !storageData) {
      await recordImportStatus(supa, retailerId, "error",
        `Storage download failed (${bucket}/${objectPath}): ${storageErr?.message || "no data"}`);
      return new Response(JSON.stringify({
        error: "Failed to download from Supabase Storage",
        details: storageErr?.message || "no data",
        bucket,
        object_path: objectPath,
        hint: "Has the GitHub Action uploaded this file yet? Check the Actions tab.",
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    buf = await storageData.arrayBuffer();
    responseHeaders["x-source"] = "supabase-storage";
    responseHeaders["x-bucket"] = bucket;
    responseHeaders["x-object"] = objectPath;
  } else {
    // HTTP(S) fetch path. Used for legacy AWIN-format feeds.
    // Set Accept-Encoding: identity to disable transport-level compression.
    const resp = await fetch(feedUrl, {
      headers: {
        "Accept-Encoding": "identity",
        "User-Agent": "FindMyBasket/1.0 (Supabase Edge Function)",
      },
    });
    if (!resp.ok) {
      await recordImportStatus(supa, retailerId, "error",
        `Feed download failed: ${resp.status} ${resp.statusText} (fid ${config.awin_feed_id})`);
      return new Response(JSON.stringify({
        error: `Feed download failed: ${resp.status}`,
        status_text: resp.statusText,
        feed_id: config.awin_feed_id,
        feed_format: feedFormat,
        feed_url_used: feedUrl.replace(/apikey\/[^/]+/, "apikey/REDACTED"),
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    buf = await resp.arrayBuffer();
    respStatus = resp.status;
    resp.headers.forEach((v, k) => { responseHeaders[k] = v; });
  }

  // Log response details FIRST so we can see them in logs even if decompression fails
  const previewBytes = Array.from(new Uint8Array(buf.slice(0, 32)))
    .map(b => b.toString(16).padStart(2, "0")).join(" ");
  console.log("FEED_DIAGNOSTIC", JSON.stringify({
    body_size_bytes: buf.byteLength,
    first_32_bytes_hex: previewBytes,
    response_status: respStatus,
    response_headers: responseHeaders,
    feed_format: feedFormat,
  }));

  // Detect whether the body is actually gzipped. Gzip files start with magic
  // bytes 0x1f 0x8b. If those are present, decompress; otherwise treat as plaintext.
  let text: string = "";
  const firstBytes = new Uint8Array(buf.slice(0, 4));
  const isGzipped = firstBytes.length >= 2 && firstBytes[0] === 0x1f && firstBytes[1] === 0x8b;

  if (isGzipped) {
    // pako.ungzip handles the full buffer in one call. Deno's built-in
    // DecompressionStream("gzip") was failing on ~1.5MB feeds with
    // "failed to write whole buffer" in the edge function runtime,
    // regardless of streaming pattern (Response.text() vs explicit reader).
    try {
      const inputBytes = new Uint8Array(buf);
      const decompressed = pako.ungzip(inputBytes);
      text = new TextDecoder("utf-8").decode(decompressed);
      console.log("GZIP_OK", JSON.stringify({
        compressed_size: buf.byteLength,
        decompressed_size: decompressed.byteLength,
      }));
    } catch (gzErr) {
      console.log("GZIP_FAILED", String(gzErr));
      const rawPreview = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 500));
      console.log("RAW_TEXT_PREVIEW", rawPreview);
      await recordImportStatus(supa, retailerId, "error",
        `Gzip decompression failed: ${String(gzErr)}`);
      return new Response(JSON.stringify({
        error: "Gzip decompression failed — see function logs for diagnostic",
        details: String(gzErr),
        body_size_bytes: buf.byteLength,
        first_32_bytes_hex: previewBytes,
        feed_format: feedFormat,
      }, null, 2), { status: 502, headers: { "Content-Type": "application/json" } });
    }
  } else {
    text = new TextDecoder("utf-8").decode(buf);
  }
  fetchMs = Date.now() - fetchT0;

  const lines = text.split("\n");
  if (lines.length < 50) {
    await recordImportStatus(supa, retailerId, "error",
      `Feed returned fewer than 50 rows (${lines.length}) — likely AWIN incident or bad feed ID`);
    return new Response(JSON.stringify({
      error: "Feed returned fewer than 50 rows — aborting (likely AWIN incident or bad feed ID)",
      lines: lines.length,
      feed_format: feedFormat,
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }

  // Strip BOM (Google Shopping CSV files have UTF-8 BOM)
  const headerLine = lines[0].replace(/^\uFEFF/, "");
  columns = parseRow(headerLine).map(c => c.replace(/^"|"$/g, ""));
  legacyLines = lines;
  } // \u2500\u2500 end legacy (non-streaming) fetch path \u2500\u2500

  // Column index mapping. Two paths:
  //   - 'awin' (legacy): product_name, merchant_product_id, search_price, etc.
  //   - 'google_shopping' (Darwin): title, id, price, sale_price, availability, etc.
  // After this block, the rest of the function uses idx.* the same way regardless.
  type ColIdx = {
    product_name: number;
    merchant_product_id: number;
    aw_product_id: number;
    search_price: number;
    store_price: number;
    merchant_deep_link: number;
    in_stock: number;
    rrp_price: number;
    brand_name: number;
    category_path: number;
    category_name: number;
    ean: number;
    mpn: number;
    image_url: number;
    // Google Shopping–specific fields used by row-level mapper
    sale_price: number;
    availability: number;
  };

  let idx: ColIdx;
  if (feedFormat === "google_shopping") {
    idx = {
      product_name: columns.indexOf("title"),
      merchant_product_id: columns.indexOf("id"),
      aw_product_id: columns.indexOf("id"),  // Google format only has 'id' — same column for both lookup modes
      search_price: columns.indexOf("sale_price"),  // prefer sale, fall back to price (handled in row loop)
      store_price: columns.indexOf("price"),
      merchant_deep_link: columns.indexOf("aw_deep_link"),  // already wrapped, used directly
      in_stock: columns.indexOf("availability"),
      rrp_price: columns.indexOf("price"),
      brand_name: columns.indexOf("brand"),
      // Google format puts the rich category data in google_product_category.
      // We treat it as both "path" (for filtering) and "name" (since it's the only category field).
      category_path: columns.indexOf("google_product_category"),
      category_name: columns.indexOf("product_type"),
      ean: columns.indexOf("gtin"),
      mpn: columns.indexOf("mpn"),
      image_url: columns.indexOf("image_link"),
      sale_price: columns.indexOf("sale_price"),
      availability: columns.indexOf("availability"),
    };
  } else {
    idx = {
      product_name: columns.indexOf("product_name"),
      merchant_product_id: columns.indexOf("merchant_product_id"),
      aw_product_id: columns.indexOf("aw_product_id"),
      search_price: columns.indexOf("search_price"),
      store_price: columns.indexOf("store_price"),
      merchant_deep_link: columns.indexOf("merchant_deep_link"),
      in_stock: columns.indexOf("in_stock"),
      rrp_price: columns.indexOf("rrp_price"),
      brand_name: columns.indexOf("brand_name"),
      category_path: columns.indexOf("merchant_product_category_path"),
      category_name: columns.indexOf("category_name"),
      ean: columns.indexOf("ean"),
      mpn: columns.indexOf("mpn"),
      image_url: columns.indexOf("merchant_image_url"),
      sale_price: -1,
      availability: -1,
    };
  }

  // Helper for Google Shopping format: parse "1.59 GBP" → 1.59
  // Also handles plain numeric strings (legacy AWIN format).
  function parsePrice(raw: string): number {
    if (!raw) return NaN;
    const numeric = raw.replace(/[^0-9.]/g, "");
    return parseFloat(numeric);
  }

  // Helper for Google Shopping format: 'in_stock' → true, 'out_of_stock' → false
  // Legacy AWIN: '1'/'true'/'y'/'yes' → true
  function parseInStock(raw: string, format: string): boolean {
    const v = (raw || "").toLowerCase().trim();
    if (format === "google_shopping") {
      return v === "in_stock" || v === "in stock";
    }
    return v === "1" || v === "true" || v === "y" || v === "yes";
  }

  const matchColumnIdx = config.match_column === "aw_product_id"
    ? idx.aw_product_id
    : idx.merchant_product_id;

  // Step 5: Walk feed, classify each row
  let feedRows = 0;
  let countExcluded = 0;
  let countExcludedPathNotInScope = 0;
  let countNoPrice = 0;
  let countNoMatchId = 0;
  let countOOS = 0;
  let countUpdate = 0;
  let countLinkExisting = 0;
  let countSkippedShadeVariant = 0;
  const sampleSkippedShadeVariant: any[] = [];
  let countCreateNew = 0;
  let countSkippedNewBrand = 0;
  let countSizeMismatchRejected = 0;
  // v6 counters
  let countV6Excluded = 0;
  const v6ExclusionBreakdown: Record<string, number> = {};

  const sampleExcluded: any[] = [];
  const sampleLinkExisting: any[] = [];
  const sampleCreateNew: any[] = [];
  const sampleV6Excluded: any[] = [];
  const SAMPLE_LIMIT_EXCLUDED = 50;
  const SAMPLE_LIMIT_CREATE_NEW = 50;
  const SAMPLE_LIMIT_V6_EXCLUDED = 50;
  const sampleRawCategoryData: any[] = [];
  // v6.13: aggregate ALL unique category paths with counts. Useful for designing
  // category_path_must_contain filters for new retailers.
  const categoryPathCounts: Map<string, number> = new Map();
  // DIAGNOSTIC (measurement-only): of the rows that would create a new product,
  // bucket by whether they carry a category_path / category_name. Hypothesis:
  // empty-path designer rows split into beauty (category_name "Cosmetics &
  // Skincare") vs non-beauty eyewear/apparel/bags (empty category_name). This
  // tells us whether a category_name gate on empty-path rows is safe.
  const createNewCatNameBreakdown: Record<string, number> = {};
  const sampleCreateNewEmptyCatName: any[] = [];

  const updateActions: Array<{ rp_id: number; product_id: number; price: number; url: string; in_stock: boolean; ean: string; mpn: string; image_url: string }> = [];
  const linkActions: Array<{ product_id: number; ext_id: string; price: number; url: string; in_stock: boolean; ean: string; mpn: string; image_url: string }> = [];
  // v6.16: createActions now carries canonical_size + image_url
  const createActions: Array<{
    ext_id: string;
    name: string;
    brand: string;
    category: string;
    product_type: string;
    top_category: TopCategory;
    subcategory: string;
    tags: string[];
    canonical_size: string | null;
    shade: string | null;
    price: number;
    url: string;
    in_stock: boolean;
    ean: string;
    mpn: string;
    image_url: string;
  }> = [];

  // ── Phase 2 streamed-apply state ───────────────────────────────────────────
  // createActions/linkActions/updateActions are flushed and CLEARED mid-run, so
  // any end-of-run aggregate over them must instead be a running counter.
  let createSkincare = 0, createMakeup = 0, createHair = 0;     // v6 top_category breakdown of creates
  let createCanonicalSizeExtracted = 0, createShadeExtracted = 0;
  let countSuppressedDuplicateCreate = 0;                       // 4A-i: in-feed duplicate creates suppressed
  // createsEnqueued is the GLOBAL running create count across slices (drives the
  // 20k cap), so a slice seeds it from run_state.meta. createdUrlsNew tracks just
  // the urls a slice creates, to persist back without re-writing the seeded set.
  let createsEnqueued = (effectiveMode === "process" && runMeta && typeof runMeta.creates_enqueued === "number")
    ? runMeta.creates_enqueued : 0;
  const createdUrlsNew: string[] = [];
  let cappedCreates = 0;                                        // creates skipped after the 20k incremental ceiling
  const CREATE_CAP = 20000;                                     // partial-write ceiling (was an abort-before-any-write guard)
  const FLUSH_THRESHOLD = 1000;                                 // flush when total pending actions reach this
  // Apply tallies + errors (populated by flush()).
  let updatesApplied = 0, linksApplied = 0, createsApplied = 0;
  const errors: string[] = [];
  // One timestamp captured at the top of the apply, passed to the price-aware
  // link RPC on every flush so "lowest price wins" is scoped to THIS run. A sliced
  // run shares ONE run_started_at across all slices (from run_state.meta) so the
  // cross-slice lowest-price-wins upsert stays correct.
  const runStartedAt = (effectiveMode === "process" && runMeta && typeof runMeta.run_started_at === "string")
    ? runMeta.run_started_at : new Date().toISOString();
  const pendingActions = () => updateActions.length + linkActions.length + createActions.length;

  // Chunk size for every bulk RPC / upsert. A single statement over a whole large
  // batch exceeds the Postgres statement timeout and is silently cancelled
  // (v6.18 monitoring surfaced this). Chunking keeps each statement small.
  const INSERT_CHUNK = 500;

  // Apply all pending actions, then clear them. On a dry_run we only DISCARD
  // (the run computes counts, never writes) — which keeps dry-runs memory-bounded
  // too. Called when pending actions cross FLUSH_THRESHOLD and once at the end.
  async function flush(): Promise<void> {
    if (dryRun) {
      updateActions.length = 0;
      linkActions.length = 0;
      createActions.length = 0;
      return;
    }

    // 1. Updates — chunked price + image backfill RPCs.
    if (updateActions.length > 0) {
      const nowIso = new Date().toISOString();
      for (let i = 0; i < updateActions.length; i += INSERT_CHUNK) {
        const chunk = updateActions.slice(i, i + INSERT_CHUNK);
        const payload = chunk.map(u => ({
          id: u.rp_id, price: u.price, in_stock: u.in_stock, last_updated: nowIso,
          url: u.url || "", ean: u.ean || "", mpn: u.mpn || "",
        }));
        const { data: rpcResult, error: rpcErr } = await supa.rpc("bulk_update_retailer_prices", { updates: payload });
        if (rpcErr) errors.push(`bulk_update_retailer_prices (chunk at ${i}): ${rpcErr.message}`);
        else updatesApplied += typeof rpcResult === "number" ? rpcResult : chunk.length;
      }
      const imageUpdates = updateActions.filter(u => u.image_url).map(u => ({ product_id: u.product_id, image_url: u.image_url }));
      for (let i = 0; i < imageUpdates.length; i += INSERT_CHUNK) {
        const chunk = imageUpdates.slice(i, i + INSERT_CHUNK);
        const { error: imgErr } = await supa.rpc("bulk_update_product_images", { updates: chunk });
        if (imgErr) errors.push(`bulk_update_product_images (updates chunk at ${i}): ${imgErr.message}`);
      }
    }
    updateActions.length = 0;

    // 2. Links — dedupe THIS flush by product_id (lowest price) so one INSERT
    //    never hits the same (product_id, retailer_id) conflict row twice, then
    //    upsert via the run-scoped price-aware RPC (lowest price wins across
    //    flushes regardless of chunk order — see upsert_retailer_prices_lowest).
    if (linkActions.length > 0) {
      const dedupedLinks = new Map<number, typeof linkActions[number]>();
      for (const l of linkActions) {
        const ex = dedupedLinks.get(l.product_id);
        if (!ex || l.price < ex.price) dedupedLinks.set(l.product_id, l);
      }
      const dedupedLinkArray = Array.from(dedupedLinks.values());
      const nowIso = new Date().toISOString();
      for (let i = 0; i < dedupedLinkArray.length; i += INSERT_CHUNK) {
        const chunk = dedupedLinkArray.slice(i, i + INSERT_CHUNK);
        const rows = chunk.map(l => ({
          product_id: l.product_id, retailer_id: retailerId, price: l.price, url: l.url,
          in_stock: l.in_stock, external_product_id: l.ext_id, ean: l.ean || null, mpn: l.mpn || null,
          last_updated: nowIso,
        }));
        const { error } = await supa.rpc("upsert_retailer_prices_lowest", { p_rows: rows, p_run_started_at: runStartedAt });
        if (error) errors.push(`link flush at ${i}: ${error.message}`);
        else linksApplied += chunk.length;
      }
      const linkImageUpdates = dedupedLinkArray.filter(l => l.image_url).map(l => ({ product_id: l.product_id, image_url: l.image_url }));
      for (let i = 0; i < linkImageUpdates.length; i += INSERT_CHUNK) {
        const chunk = linkImageUpdates.slice(i, i + INSERT_CHUNK);
        const { error: linkImgErr } = await supa.rpc("bulk_update_product_images", { updates: chunk });
        if (linkImgErr) errors.push(`bulk_update_product_images (links chunk at ${i}): ${linkImgErr.message}`);
      }
    }
    linkActions.length = 0;

    // 3. Creates — two-phase bulk insert (products → real ids → retailer_prices).
    for (let i = 0; i < createActions.length; i += INSERT_CHUNK) {
      const chunk = createActions.slice(i, i + INSERT_CHUNK);
      const productRows = chunk.map(c => ({
        name: c.name, brand: c.brand,
        normalised_brand: c.brand ? String(c.brand).toLowerCase().trim() || null : null,
        category: c.category, product_type: c.product_type, top_category: c.top_category,
        subcategory: c.subcategory, tags: c.tags, canonical_size: c.canonical_size,
        shade: c.shade, image_url: c.image_url || null,
      }));
      const { data: insertedProducts, error: pErr } = await supa.from("products").insert(productRows).select("id");
      if (pErr || !insertedProducts || insertedProducts.length !== chunk.length) {
        errors.push(`create products batch at ${i}: ${pErr?.message || "row count mismatch"}`);
        continue;
      }
      const priceRows = chunk.map((c, j) => ({
        product_id: insertedProducts[j].id, retailer_id: retailerId, price: c.price, url: c.url,
        in_stock: c.in_stock, external_product_id: c.ext_id, ean: c.ean || null, mpn: c.mpn || null,
        last_updated: new Date().toISOString(),
      }));
      const { error: rpErr } = await supa.from("retailer_prices").insert(priceRows);
      if (rpErr) errors.push(`create rps batch at ${i}: ${rpErr.message}`);
      else createsApplied += chunk.length;
    }
    createActions.length = 0;
  }

  // Counters for the EAN-first matching tier
  let countLinkViaEan = 0;
  let countLinkViaMpn = 0;
  let countLinkViaNameExact = 0;
  let countLinkViaNameStripped = 0;
  let rowsWithEan = 0;
  let rowsWithMpn = 0;

  // DIAGNOSTIC: track every The Ordinary row and where it ends up
  const ordinaryDiagnostic: any = {
    total_rows_seen: 0,
    excluded_path: 0,
    excluded_category: 0,
    excluded_name: 0,
    excluded_no_match_id: 0,
    excluded_no_price: 0,
    excluded_oos: 0,
    matched_existing: 0,
    linked_via_ean: 0,
    linked_via_mpn: 0,
    linked_via_name_exact: 0,
    linked_via_name_stripped: 0,
    v6_excluded: 0,
    v6_excluded_reasons: {} as Record<string, number>,
    skipped_new_brand: 0,
    would_create_new: 0,
    sample_rows: [] as any[],
  };

  // Unified row source — yields BATCHES of raw parsed rows (string[][]). The
  // inner per-row loop below applies the quote-strip and blank-line skip and is
  // byte-for-byte identical to the pre-streaming classification body (every
  // `continue` skips to the next row in the batch). Yielding batches rather than
  // single rows keeps the async/await count to one-per-source-chunk instead of
  // one-per-row, which is what kept the streaming path under Deno's resource
  // limit (per-row awaits flakily tripped WORKER_RESOURCE_LIMIT).
  const LEGACY_BATCH = 2000;
  async function* batchSource(): AsyncGenerator<string[][]> {
    if (effectiveMode === "process") {
      // Process mode: rows already parsed from this slice's Storage file. One
      // batch; the chunk driver re-buffers into CHUNK_SIZE blocks as usual.
      if (processRows.length) yield processRows;
      return;
    }
    if (streamingActive && streamBatchIter) {
      const streamT0 = Date.now();
      let seen = 0;
      if (pendingFirstRows) for (const b of pendingFirstRows) yield b;
      while (true) {
        const res = await streamBatchIter.next();
        if (res.done) break;
        seen += res.value.length;
        // Throughput heartbeat each time we cross a 100k-row boundary, so a
        // Sephora-sized stream visibly makes progress in the logs.
        if (seen % 100000 < res.value.length) {
          const secs = (Date.now() - streamT0) / 1000;
          console.log("STREAM_PROGRESS", JSON.stringify({
            rows_parsed: seen,
            elapsed_s: Math.round(secs),
            rows_per_s: Math.round(seen / Math.max(secs, 0.001)),
          }));
        }
        yield res.value;
      }
    } else {
      // Legacy: emit fixed-size batches so we never materialise an extra
      // full-feed array (matches legacy memory profile).
      let batch: string[][] = [];
      for (let i = 1; i < legacyLines!.length; i++) {
        const line = legacyLines![i];
        if (!line.trim()) continue;
        batch.push(parseRow(line));
        if (batch.length >= LEGACY_BATCH) { yield batch; batch = []; }
      }
      if (batch.length) yield batch;
    }
  }

  // ── Chunked match+apply driver ─────────────────────────────────────────────
  // Buffer raw rows into ~CHUNK_SIZE blocks; for each block load only the
  // catalogue rows that block needs (loadChunkMaps), run the unchanged matching
  // body, then flush applied actions once they cross FLUSH_THRESHOLD. Peak memory
  // is bounded by one block's lookup maps + FLUSH_THRESHOLD pending actions,
  // rather than the whole-feed loads + whole-feed action arrays that OOM'd.
  // NOTE (big-feed 546, diagnosed 2026-06-15 via a since-removed memory-trace
  // probe): on the streaming path heap stays bounded (~23-33MB), so chunked apply fixed the
  // MATCHING/heap memory. The remaining 546 on Stylevana is the per-chunk product
  // OVER-FETCH: its product-dense brands (Kose 2215, Shiseido 1715, L'Oréal 1837,
  // …) recur in nearly every chunk, so loadChunkMaps refetches ~19k products via
  // ~19 paginated queries PER CHUNK — the query/response churn (native/RSS, not
  // heap) trips the limit. CHUNK_SIZE alone doesn't fix it (dense brands recur at
  // any size; tried 500, still 546). FIX (next): a cross-chunk lazy per-brand
  // product cache so each brand is fetched ONCE, not every chunk.
  const CHUNK_SIZE = 2000;
  let chunkRows: string[][] = [];
  let chunkNo = 0;
  async function runChunk(): Promise<void> {
    if (!chunkRows.length) return;
    await loadChunkMaps(chunkRows);
    for (const rawFields of chunkRows) {
    // Quote-strip mirrors the legacy `parseRow(line).map(...)`; blank-line skip
    // mirrors the legacy `!line.trim()` (a blank source line parses to one empty
    // field). `continue` here skips to the next row in the batch.
    const fields = rawFields.map((x) => x.replace(/^"|"$/g, ""));
    if (fields.length === 1 && !fields[0].trim()) continue;
    feedRows++;

    const name = fields[idx.product_name] || "";
    const rawBrand = fields[idx.brand_name] || "";
    const brand = lookupCanonicalBrand(rawBrand);   // canonical from here down
    if (rawBrand) {
      if (brand !== rawBrand) countBrandCanonicalised++;
      else if (!brandAliasMap.has(rawBrand.toLowerCase().trim()))
        unmatchedBrandCounts.set(rawBrand, (unmatchedBrandCounts.get(rawBrand) ?? 0) + 1);
    }
    const categoryPath = fields[idx.category_path] || "";
    const categoryName = fields[idx.category_name] || "";

    // DIAGNOSTIC: flag The Ordinary rows
    const isOrdinary = brand.toLowerCase().includes("ordinary") || name.toLowerCase().includes("the ordinary");
    if (isOrdinary) {
      ordinaryDiagnostic.total_rows_seen++;
      if (ordinaryDiagnostic.sample_rows.length < 10) {
        ordinaryDiagnostic.sample_rows.push({
          name,
          brand,
          category_path: categoryPath,
          category_name: categoryName,
          price: fields[idx.search_price] || fields[idx.store_price],
          in_stock_raw: fields[idx.in_stock] || "",
          ean: idx.ean >= 0 ? fields[idx.ean] : null,
        });
      }
    }

    // Capture raw category data for debugging — first 8 rows
    if (sampleRawCategoryData.length < 8) {
      sampleRawCategoryData.push({
        name,
        category_path: categoryPath,
        category_name: categoryName,
      });
    }

    // v6.13: track all unique paths for filter design
    if (categoryPath) {
      categoryPathCounts.set(categoryPath, (categoryPathCounts.get(categoryPath) || 0) + 1);
    }

    // Path include-filter
    const pathInclusion = isPathIncluded(categoryPath, categoryPathMustContain);
    if (!pathInclusion.included) {
      countExcludedPathNotInScope++;
      if (isOrdinary) ordinaryDiagnostic.excluded_path++;
      continue;
    }

    // Category filter
    const categoryExclusion = isExcludedCategory(categoryPath, categoryName, categoryExcludes);
    if (categoryExclusion.excluded) {
      countExcluded++;
      if (isOrdinary) ordinaryDiagnostic.excluded_category++;
      if (sampleExcluded.length < SAMPLE_LIMIT_EXCLUDED) {
        sampleExcluded.push({
          name,
          brand,
          reason: "category",
          matched_term: categoryExclusion.matched_term,
          category_path: categoryPath,
        });
      }
      continue;
    }

    // Name filter
    const nameExclusion = isExcludedName(name, nameExcludes);
    if (nameExclusion.excluded) {
      countExcluded++;
      if (isOrdinary) ordinaryDiagnostic.excluded_name++;
      if (sampleExcluded.length < SAMPLE_LIMIT_EXCLUDED) {
        sampleExcluded.push({
          name,
          brand,
          reason: "name",
          matched_term: nameExclusion.matched_term,
        });
      }
      continue;
    }

    const matchValue = fields[matchColumnIdx];
    if (!matchValue) { countNoMatchId++; if (isOrdinary) ordinaryDiagnostic.excluded_no_match_id++; continue; }

    // Price parsing — format-aware. Google Shopping has values like "1.59 GBP".
    // Legacy AWIN has bare numerics like "1.59".
    // Prefer sale_price over price (we want what the customer actually pays).
    const priceStr = fields[idx.search_price] || fields[idx.store_price];
    const price = parsePrice(priceStr);
    if (!isFinite(price) || price <= 0) { countNoPrice++; if (isOrdinary) ordinaryDiagnostic.excluded_no_price++; continue; }

    const inStock = parseInStock(fields[idx.in_stock] || "", feedFormat);
    if (!inStock) { countOOS++; if (isOrdinary) ordinaryDiagnostic.excluded_oos++; continue; }

    // URL — format-aware.
    // Google Shopping format: aw_deep_link is already a fully-wrapped AWIN
    //   tracking URL with our publisher ID baked in. Use it directly.
    // Legacy AWIN: merchant_deep_link is the raw merchant URL; we need to
    //   wrap it through cread.php with our publisher ID and the merchant ID.
    const rawMerchantUrl = fields[idx.merchant_deep_link] || "";
    let wrappedUrl: string;
    if (feedFormat === "google_shopping") {
      wrappedUrl = rawMerchantUrl;
    } else {
      wrappedUrl = rawMerchantUrl
        ? buildCreadUrl(config.awin_merchant_id, AWIN_PUBLISHER_ID, rawMerchantUrl)
        : "";
    }

    // Path 1: extract EAN/MPN from feed row.
    const rawEan = idx.ean >= 0 ? (fields[idx.ean] || "").trim() : "";
    const rawMpn = idx.mpn >= 0 ? (fields[idx.mpn] || "").trim() : "";
    const normEan = normaliseEan(rawEan);
    const normMpn = normaliseMpn(rawMpn);
    if (normEan) rowsWithEan++;
    if (normMpn) rowsWithMpn++;

    // Image URL - feed-provided product image. Used for catalogue display.
    const imageUrl = idx.image_url >= 0 ? (fields[idx.image_url] || "").trim() : "";

    // Decision tree (tiered).
   const existing = existingByExtId.get(matchValue);
    if (existing) {
      countUpdate++;
      if (isOrdinary) ordinaryDiagnostic.matched_existing++;
      updateActions.push({ rp_id: existing.id, product_id: existing.product_id, price, url: wrappedUrl, in_stock: inStock, ean: rawEan, mpn: rawMpn, image_url: imageUrl });
      continue;
    }

    // Tier 1: EAN match (cross-retailer)
    let matchedProductId: number | undefined = undefined;
    let matchedVia: "ean" | "mpn" | "name_exact" | "name_stripped" | undefined = undefined;
    if (normEan && eanToProductId.has(normEan)) {
      matchedProductId = eanToProductId.get(normEan);
      matchedVia = "ean";
      countLinkViaEan++; if (isOrdinary) ordinaryDiagnostic.linked_via_ean++;
    }

    // Tier 2: MPN match
    if (!matchedProductId && normMpn && mpnToProductId.has(normMpn)) {
      matchedProductId = mpnToProductId.get(normMpn);
      matchedVia = "mpn";
      countLinkViaMpn++; if (isOrdinary) ordinaryDiagnostic.linked_via_mpn++;
    }

    const productMatchKey = buildMatchKey(brand, name);
    const strippedMatchKey = stripSize(productMatchKey);
    const sourceSize = extractSize(productMatchKey);

    // Tier 3: name exact match
    if (!matchedProductId) {
      const id = productByExact.get(productMatchKey);
      if (id) {
        matchedProductId = id;
        matchedVia = "name_exact";
        countLinkViaNameExact++; if (isOrdinary) ordinaryDiagnostic.linked_via_name_exact++;
      }
    }

    // Tier 4: name stripped + size-verified match. Candidates now come only from
    // productByStripped (each entry carries its own size). The former
    // productByExact.get(strippedMatchKey) candidate is dropped: productByExact
    // maps key→id with no size, so under the folded structure it can no longer
    // be size-verified. It was reachable only for a product whose full exact key
    // already equals strippedMatchKey, in which case that product is normally
    // also present in productByStripped under the same key — so the same row is
    // still covered, except in rare stripped-key collisions (verified no counter
    // drift on the Beauty Bay + Beauty Flash dry-runs).
    if (!matchedProductId) {
      const candidates: (StrippedEntry | undefined)[] = [
        productByStripped.get(productMatchKey),
        productByStripped.get(strippedMatchKey),
      ];
      for (const candidate of candidates) {
        if (!candidate) continue;
        if (sourceSize === candidate.size) {
          matchedProductId = candidate.id;
          matchedVia = "name_stripped";
          countLinkViaNameStripped++; if (isOrdinary) ordinaryDiagnostic.linked_via_name_stripped++;
          break;
        }
        countSizeMismatchRejected++;
      }
    }

// Tier 5: same-retailer URL already maps to an existing product.
    // This is the shade-variant case — Boots/Superdrug send one feed row per
    // shade, but the URL points to a single base product page (with a shade
    // dropdown). Skip rather than create a redundant row.
    // createdUrls (persistent) replaces the old urlToProductId -1 sentinel — the
    // map was always empty from the DB anyway (url was never selected), so Tier 5
    // is, as in prod today, in-feed-created shade variants only. (Follow-up:
    // restore DB-populated url matching in its own PR.)
    if (!matchedProductId && wrappedUrl && createdUrls.has(wrappedUrl)) {
      countSkippedShadeVariant++;
      if (sampleSkippedShadeVariant.length < 20) {
        sampleSkippedShadeVariant.push({
          name, brand,
          existing_product_id: -1,
        });
      }
      continue;
    }
    if (matchedProductId) {
      countLinkExisting++;
      linkActions.push({ product_id: matchedProductId, ext_id: matchValue, price, url: wrappedUrl, in_stock: inStock, ean: rawEan, mpn: rawMpn, image_url: imageUrl });
      // In-feed learning: write to BOTH the chunk map (for later rows in this
      // chunk) and the persistent seen-map (for later chunks).
      if (normEan && !eanToProductId.has(normEan)) { eanToProductId.set(normEan, matchedProductId); seenEanToProductId.set(normEan, matchedProductId); }
      if (normMpn && !mpnToProductId.has(normMpn)) { mpnToProductId.set(normMpn, matchedProductId); seenMpnToProductId.set(normMpn, matchedProductId); }
      if (sampleLinkExisting.length < 25) {
        sampleLinkExisting.push({ name, brand, matched_product_id: matchedProductId, price, matched_via: matchedVia });
      }
      continue;
    }

    // 4A-i: suppress an in-feed duplicate create — the same NEW product seen
    // earlier this run (a different row/chunk that didn't match any existing
    // product). Seeded with -1 (pending id); used only to skip the redundant
    // create, never to link (true cross-chunk name-linking is a follow-up). This
    // is the one intentional create→suppress delta vs prod for §6 parity.
    if (createdByMatchKey.has(productMatchKey)) {
      countSuppressedDuplicateCreate++;
      continue;
    }

    // ─── v6: classify the new product before deciding to create ──────────
    const cat = inferCategorisation(name, brand);

    // Skip products on the v6 denylist (fragrance, period_care, etc.)
    if (cat.excluded) {
      countV6Excluded++;
      v6ExclusionBreakdown[cat.excluded] = (v6ExclusionBreakdown[cat.excluded] || 0) + 1;
      if (isOrdinary) {
        ordinaryDiagnostic.v6_excluded++;
        ordinaryDiagnostic.v6_excluded_reasons[cat.excluded] = (ordinaryDiagnostic.v6_excluded_reasons[cat.excluded] || 0) + 1;
      }
      if (sampleV6Excluded.length < SAMPLE_LIMIT_V6_EXCLUDED) {
        sampleV6Excluded.push({ name, brand, reason: cat.excluded });
      }
      continue;
    }

    // Skip products that can't even be classified to a top-level category.
    // In practice the skincare path is a catchall, so this should be rare.
    if (!cat.top_category) {
      countV6Excluded++;
      v6ExclusionBreakdown["unclassified"] = (v6ExclusionBreakdown["unclassified"] || 0) + 1;
      if (sampleV6Excluded.length < SAMPLE_LIMIT_V6_EXCLUDED) {
        sampleV6Excluded.push({ name, brand, reason: "unclassified" });
      }
      continue;
    }

    // Apply per-retailer top_category override if config has one set.
    // Keeps inferred product_type and subcategory, just retags the top.
    let finalTopCategory: TopCategory = cat.top_category;
    let finalTags: string[] = cat.tags;
    if (topCategoryDefault) {
      finalTopCategory = topCategoryDefault;
      // Replace the top_category tag (always at index 0 from inference)
      finalTags = [topCategoryDefault, ...cat.tags.slice(1)];
    }

    countCreateNew++;
    // Brand restriction: if existing_brands_only is on, skip products from
    // brands we don't already track.
    if (existingBrandsOnly) {
      const normBrand = brand.toLowerCase().trim();
      if (!normBrand || !existingBrandSet.has(normBrand)) {
        countCreateNew--;
        countSkippedNewBrand++;
        if (isOrdinary) ordinaryDiagnostic.skipped_new_brand++;
        continue;
      }
    }

// v6.16: extract canonical_size from raw product name for the new product
    const canonicalSize = extractCanonicalSize(name);
    // v6.17: extract shade from raw product name for the new product
    const shade = extractShade(name, brand);

    if (isOrdinary) ordinaryDiagnostic.would_create_new++;
    // DIAGNOSTIC (measurement-only): bucket this create-new row by category_name.
    const catNameKey = !categoryPath
      ? (categoryName ? `emptyPath|${categoryName}` : "emptyPath|<blank>")
      : "hasPath";
    createNewCatNameBreakdown[catNameKey] = (createNewCatNameBreakdown[catNameKey] || 0) + 1;
    if (!categoryPath && !categoryName && sampleCreateNewEmptyCatName.length < 40) {
      sampleCreateNewEmptyCatName.push({ name, brand, top_category: finalTopCategory, product_type: cat.product_type });
    }

    // Incremental partial-write cap (replaces the old abort-before-any-write at
    // >20k). Streamed creates may already be on disk, so we can't unwind — instead
    // we stop enqueuing further creates, keep doing updates/links, and finish with
    // an 'error' status flagging the partial run.
    if (createsEnqueued >= CREATE_CAP) {
      cappedCreates++;
      continue;
    }

    createActions.push({
      ext_id: matchValue,
      name,
      brand,
      category: cat.product_type,         // backwards compat (auto-sync trigger reads this)
      product_type: cat.product_type,
      top_category: finalTopCategory,
      subcategory: cat.subcategory,
      tags: finalTags,
      canonical_size: canonicalSize,
      shade: shade,
      price,
      url: wrappedUrl,
      in_stock: inStock,
      ean: rawEan,
      mpn: rawMpn,
      image_url: imageUrl,
    });
    createsEnqueued++;
    // 4A-i: remember this new product's key so a later in-feed duplicate is
    // suppressed (seed -1 = pending; we don't know the real id until flush).
    createdByMatchKey.set(productMatchKey, -1);
    // v6 create breakdowns — running counters, because createActions is cleared
    // on each flush so it can't be filtered at the end any more.
    if (finalTopCategory === "skincare") createSkincare++;
    else if (finalTopCategory === "makeup") createMakeup++;
    else if (finalTopCategory === "hair") createHair++;
    if (canonicalSize != null) createCanonicalSizeExtracted++;
    if (shade != null) createShadeExtracted++;
    // Track URL for shade-variant detection on subsequent rows in this same import
    if (wrappedUrl && !createdUrls.has(wrappedUrl)) { createdUrls.add(wrappedUrl); createdUrlsNew.push(wrappedUrl); }
    if (sampleCreateNew.length < SAMPLE_LIMIT_CREATE_NEW) {
      sampleCreateNew.push({
        name,
        brand,
        top_category: finalTopCategory,
        product_type: cat.product_type,
        subcategory: cat.subcategory,
        canonical_size: canonicalSize,
        shade: shade,
        price,
        url: wrappedUrl,
      });
    }
    }
    chunkNo++;
    chunkRows = [];
    if (pendingActions() >= FLUSH_THRESHOLD) await flush();
  }

  // ── STAGE: stream the feed once, split into Storage slice files, fire slice 0 ─
  // No matching/lookups/writes here (those are the costs that 546) — just parse +
  // upload, which fits one invocation even for Boots. Memory stays bounded: at most
  // one SLICE_ROWS buffer is held before it's uploaded and dropped.
  // Guarded to stagingMode==='inline': passthrough retailers stage via Phase A/B
  // above and return there, so this block is the inline path only.
  if (effectiveMode === "stage" && stagingMode === "inline") {
    let sliceBuf: string[][] = [];
    let sliceIdx = 0;
    let stagedRows = 0;
    const uploadSlice = async (i: number, rows: string[][]) => {
      const bodyText = rows.map((r) => JSON.stringify(r)).join("\n");
      const { error: upErr } = await supa.storage.from(STAGING_BUCKET)
        .upload(slicePath(i), new Blob([bodyText], { type: "application/x-ndjson" }), { upsert: true, contentType: "application/x-ndjson" });
      if (upErr) throw new Error(`stage upload slice ${i}: ${upErr.message}`);
    };
    try {
      for await (const batch of batchSource()) {
        for (const rawFields of batch) {
          sliceBuf.push(rawFields);
          stagedRows++;
          if (sliceBuf.length >= SLICE_ROWS) { await uploadSlice(sliceIdx, sliceBuf); sliceIdx++; sliceBuf = []; }
        }
      }
      if (sliceBuf.length) { await uploadSlice(sliceIdx, sliceBuf); sliceIdx++; sliceBuf = []; }
    } catch (e) {
      const msg = e instanceof FeedFetchError ? e.message : `stage failed: ${String(e instanceof Error ? e.message : e)}`;
      await recordImportStatus(supa, retailerId, "error", msg);
      try { const { data: f } = await supa.storage.from(STAGING_BUCKET).list(runId); if (f?.length) await supa.storage.from(STAGING_BUCKET).remove(f.map((x) => `${runId}/${x.name}`)); } catch { /* best effort */ }
      return new Response(JSON.stringify({ error: msg }, null, 2), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    const totalSlices = sliceIdx;
    // Same <50-row safeguard as the single path (likely AWIN incident / bad id).
    if (stagedRows < 50) {
      await recordImportStatus(supa, retailerId, "error", `Feed returned fewer than 50 rows (${stagedRows}) — likely AWIN incident or bad feed ID`);
      try { const { data: f } = await supa.storage.from(STAGING_BUCKET).list(runId); if (f?.length) await supa.storage.from(STAGING_BUCKET).remove(f.map((x) => `${runId}/${x.name}`)); } catch { /* best effort */ }
      return new Response(JSON.stringify({ error: "Feed returned fewer than 50 rows — aborting", staged_rows: stagedRows }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    const { error: metaErr } = await supa.from("import_run_state").insert({
      run_id: runId, retailer_id: retailerId, kind: "meta", key: "",
      meta: {
        columns, run_started_at: runStartedAt, total_slices: totalSlices, next_slice: 0,
        creates_enqueued: 0, slice_rows: SLICE_ROWS, feed_format: feedFormat, staged_rows: stagedRows,
        counts: {}, applied: { updates: 0, links: 0, creates: 0, capped: 0, errors: [] },
      },
    });
    if (metaErr) {
      await recordImportStatus(supa, retailerId, "error", `stage run_state init: ${metaErr.message}`);
      return new Response(JSON.stringify({ error: "run_state init failed", details: metaErr.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    // Fire slice 0 via pg_net (fire-and-forget; dry_run:false is REQUIRED or the
    // slice would default to a dry-run and DISCARD all writes).
    if (autoChain) {
      const { error: trigErr } = await supa.rpc("fmb_invoke_import_slice", { p_body: { retailer_id: retailerId, run_id: runId, mode: "process", slice_index: 0, dry_run: false, slice_rows: SLICE_ROWS } });
      if (trigErr) {
        await recordImportStatus(supa, retailerId, "error", `stage: failed to trigger slice 0: ${trigErr.message}`);
        return new Response(JSON.stringify({ error: "stage trigger failed", run_id: runId, details: trigErr.message }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }
    return new Response(JSON.stringify({
      staged: true, run_id: runId, total_slices: totalSlices, staged_rows: stagedRows,
      slice_rows: SLICE_ROWS, feed_fetch_ms: fetchMs,
    }, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  try {
    for await (const batch of batchSource()) {
      for (const rawFields of batch) {
        chunkRows.push(rawFields);
        if (chunkRows.length >= CHUNK_SIZE) await runChunk();
      }
    }
    await runChunk(); // process the final partial block (auto-flushes only if it crosses FLUSH_THRESHOLD)
  } catch (streamErr) {
    // A throw during streaming iteration means the fetch/inflate/parse pipeline
    // failed mid-feed (e.g. gzip corruption surfaced only after the magic-byte
    // check). Record status and return like the other feed-error paths. The
    // legacy path's batchSource never throws, so this only fires when streaming.
    if (streamingActive) {
      const msg = streamErr instanceof FeedFetchError
        ? streamErr.message
        : `Streaming parse failed mid-feed: ${String(streamErr)}`;
      await recordImportStatus(supa, retailerId, "error", msg);
      return new Response(JSON.stringify({
        error: msg, rows_processed_before_error: feedRows, feed_format: feedFormat,
      }, null, 2), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    throw streamErr;
  }

  // Sub-50-row safeguard. The legacy path checks this up front on
  // lines.length; when streaming we only know the count after draining the
  // stream. It runs BEFORE any apply below, so a truncated feed still aborts
  // with zero writes — same outcome as the legacy pre-loop check.
  if (streamingActive && feedRows < 50) {
    await recordImportStatus(supa, retailerId, "error",
      `Feed returned fewer than 50 rows (${feedRows}) — likely AWIN incident or bad feed ID`);
    return new Response(JSON.stringify({
      error: "Feed returned fewer than 50 rows — aborting (likely AWIN incident or bad feed ID)",
      rows: feedRows,
      feed_format: feedFormat,
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }

  // v6 breakdowns of would-create-new. Running counters (NOT createActions
  // filters) because createActions is flushed+cleared mid-run.
  const v6TopCategoryBreakdown = { skincare: createSkincare, makeup: createMakeup, hair: createHair };
  const v6CanonicalSizeExtracted = createCanonicalSizeExtracted;
  const v6ShadeExtracted = createShadeExtracted;

  // v6.13: build top-N category paths breakdown (sorted by count desc)
  const categoryPathBreakdown = Array.from(categoryPathCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([path, count]) => ({ path, count }));

  // The old abort-before-any-write safety cap (countCreateNew > 20000) is gone:
  // with streamed creates there's nothing to unwind. It's replaced by the
  // incremental ceiling in the match loop (CREATE_CAP / createsEnqueued /
  // cappedCreates) plus a partial-run 'error' status at the bottom.

  // Brand canonicalisation diagnostics + low-frequency unmatched brands for review
  const unmatchedLowFreq = Array.from(unmatchedBrandCounts.entries())
    .filter(([, n]) => n < 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([brand, count]) => ({ brand, count }));
  if (unmatchedLowFreq.length) {
    console.log(`brand_canonicalisation: ${unmatchedLowFreq.length} low-freq unmatched brands (<5 rows) for review`);
  }
  const brandCanonicalisation = {
    alias_map_size: brandAliasMap.size,
    rows_canonicalised: countBrandCanonicalised,
    distinct_unmatched_brands: unmatchedBrandCounts.size,
    unmatched_lowfreq_sample: unmatchedLowFreq,
  };

  // Step 6: Apply (or report)
  const result: any = {
    retailer_id: retailerId,
    feed_id_used: config.awin_feed_id,
    match_column_used: config.match_column,
    feed_format_used: feedFormat,
    top_category_default_used: topCategoryDefault,
    dry_run: dryRun,
    feed_total_rows: feedRows,
    feed_fetch_ms: fetchMs,
    counts: {
      excluded_path_not_in_scope: countExcludedPathNotInScope,
      excluded_by_category: countExcluded,
      excluded_no_price: countNoPrice,
      excluded_no_match_id: countNoMatchId,
      excluded_out_of_stock: countOOS,
      skipped_new_brand: countSkippedNewBrand,
      size_mismatch_rejected: countSizeMismatchRejected,
      v6_excluded: countV6Excluded,
      would_update_existing: countUpdate,
      would_link_to_existing_product: countLinkExisting,
      skipped_shade_variant: countSkippedShadeVariant,
      would_link_via_ean: countLinkViaEan,
      would_link_via_mpn: countLinkViaMpn,
      would_link_via_name_exact: countLinkViaNameExact,
      would_link_via_name_stripped: countLinkViaNameStripped,
      would_create_new_product: countCreateNew,
      suppressed_duplicate_create: countSuppressedDuplicateCreate,
      capped_creates: cappedCreates,
      canonical_size_extracted_on_new: v6CanonicalSizeExtracted,
      shade_extracted_on_new: v6ShadeExtracted,
      rows_with_ean: rowsWithEan,
      rows_with_mpn: rowsWithMpn,
    },
    v6_top_category_breakdown: v6TopCategoryBreakdown,
    v6_exclusion_breakdown: v6ExclusionBreakdown,
    brand_canonicalisation: brandCanonicalisation,
    ordinary_diagnostic: ordinaryDiagnostic,
    sample_v6_excluded: sampleV6Excluded,
    sample_excluded_by_category: sampleExcluded,
    sample_link_to_existing: sampleLinkExisting,
    sample_create_new: sampleCreateNew,
    sample_raw_category_data: sampleRawCategoryData,
    category_path_breakdown: categoryPathBreakdown,
    create_new_cat_name_breakdown: createNewCatNameBreakdown,
    sample_create_new_empty_cat_name: sampleCreateNewEmptyCatName,
    duration_ms_so_far: Date.now() - startTime,
  };

  if (dryRun) {
    return new Response(JSON.stringify(result, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  // ============================ APPLY ============================
  // The match loop already streamed most actions to disk via flush() as the
  // accumulators crossed FLUSH_THRESHOLD; this applies whatever's still buffered.
  // dry_run returned above, so this is real-run only. updatesApplied /
  // linksApplied / createsApplied / errors were accumulated across all flushes.
  await flush();

  // ── PROCESS: persist cross-slice state, then trigger the next slice or finalize ─
  if (effectiveMode === "process") {
    // 1. Persist this slice's NEW createdUrls (Tier-5 shade suppression, §5). The
    //    seeded set isn't re-written; ON CONFLICT DO NOTHING keeps it idempotent.
    for (let i = 0; i < createdUrlsNew.length; i += 500) {
      const rows = createdUrlsNew.slice(i, i + 500).map((u) => ({ run_id: runId, retailer_id: retailerId, kind: "url", key: u }));
      const { error: uErr } = await supa.from("import_run_state").upsert(rows, { onConflict: "run_id,kind,key", ignoreDuplicates: true });
      if (uErr) errors.push(`persist createdUrls: ${uErr.message}`);
    }
    // 2. Accumulate this slice's counts + applied tallies into the meta row.
    const prevCounts = (runMeta.counts && typeof runMeta.counts === "object") ? runMeta.counts : {};
    const sliceCounts = result.counts as Record<string, number>;
    const mergedCounts: Record<string, number> = { ...prevCounts };
    for (const k of Object.keys(sliceCounts)) mergedCounts[k] = (mergedCounts[k] || 0) + (sliceCounts[k] || 0);
    const prevApplied = runMeta.applied || { updates: 0, links: 0, creates: 0, capped: 0, errors: [] };
    const mergedApplied = {
      updates: (prevApplied.updates || 0) + updatesApplied,
      links: (prevApplied.links || 0) + linksApplied,
      creates: (prevApplied.creates || 0) + createsApplied,
      capped: (prevApplied.capped || 0) + cappedCreates,
      errors: [...(prevApplied.errors || []), ...errors.slice(0, 5)].slice(0, 20),
    };
    const totalSlices = runMeta.total_slices || 0;
    const nextSlice = sliceIndex + 1;
    const isLast = nextSlice >= totalSlices;
    await supa.from("import_run_state")
      .update({ meta: { ...runMeta, counts: mergedCounts, applied: mergedApplied, creates_enqueued: createsEnqueued, next_slice: isLast ? totalSlices : nextSlice } })
      .eq("run_id", runId).eq("kind", "meta").eq("key", "");

    if (!isLast) {
      // 3a. More slices remain — keep status 'running', fire the next slice.
      await recordImportStatus(supa, retailerId, "running", `sliced import: starting slice ${nextSlice}/${totalSlices} (run ${runId})`);
      let nextErr: any = null;
      if (autoChain) {
        ({ error: nextErr } = await supa.rpc("fmb_invoke_import_slice", { p_body: { retailer_id: retailerId, run_id: runId, mode: "process", slice_index: nextSlice, dry_run: false, slice_rows: SLICE_ROWS } }));
        if (nextErr) await recordImportStatus(supa, retailerId, "error", `slice ${sliceIndex}: failed to trigger slice ${nextSlice}: ${nextErr.message}`);
      }
      result.applied = { slice_index: sliceIndex, updates_applied: updatesApplied, links_applied: linksApplied, creates_applied: createsApplied, error_count: errors.length, next_slice: nextSlice, total_slices: totalSlices, trigger_error: nextErr?.message ?? null };
      result.duration_ms = Date.now() - startTime;
      return new Response(JSON.stringify(result, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    // 3b. Last slice — finalize: write the import outcome, then clean up.
    const runHadError = mergedApplied.errors.length > 0 || mergedApplied.capped > 0;
    const finalCapMsg = mergedApplied.capped > 0 ? `create cap hit (partial): ${mergedApplied.capped} create(s) skipped after the ${CREATE_CAP} ceiling` : null;
    await supa.from("retailer_import_config").update({
      last_imported_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(),
      last_import_status: runHadError ? "error" : "ok",
      last_import_error: runHadError ? [finalCapMsg, ...mergedApplied.errors.slice(0, 5)].filter(Boolean).join("; ").slice(0, 1000) : null,
    }).eq("retailer_id", retailerId);
    try {
      await supa.from("scrape_log").insert({ retailer_id: retailerId, status: runHadError ? "partial_failure" : "success", products_seen: runMeta.staged_rows || 0, products_updated: mergedApplied.updates, products_inserted: mergedApplied.links + mergedApplied.creates, duration_ms: Date.now() - startTime });
    } catch { /* table may not have these exact columns; ignore */ }
    // Cleanup: staging slice files + all run_state rows for this run.
    try { const { data: f } = await supa.storage.from(STAGING_BUCKET).list(runId); if (f?.length) await supa.storage.from(STAGING_BUCKET).remove(f.map((x) => `${runId}/${x.name}`)); } catch { /* best effort */ }
    await supa.from("import_run_state").delete().eq("run_id", runId);
    // Refresh ISR caches for the brands/categories this run touched (best-effort).
    await triggerRevalidation(supa, retailerId, runStartedAt);
    result.applied = { final: true, total_slices: totalSlices, updates_applied: mergedApplied.updates, links_applied: mergedApplied.links, creates_applied: mergedApplied.creates, capped_creates: mergedApplied.capped, error_count: mergedApplied.errors.length, sample_errors: mergedApplied.errors.slice(0, 10) };
    result.duration_ms = Date.now() - startTime;
    return new Response(JSON.stringify(result, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  // Partial-write cap: if the incremental ceiling skipped any creates, the run is
  // incomplete even if every write succeeded — flag it 'error' so the monitor and
  // the operator see it.
  const capMsg = cappedCreates > 0
    ? `create cap hit (partial): ${cappedCreates} create(s) skipped after the ${CREATE_CAP} ceiling`
    : null;
  const hadError = errors.length > 0 || cappedCreates > 0;

  // Update last_imported_at on the config row, and record the import outcome so
  // monitor-retailer-feeds can alert immediately.
  await supa
    .from("retailer_import_config")
    .update({
      last_imported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_attempt_at: new Date().toISOString(),
      last_import_status: hadError ? "error" : "ok",
      last_import_error: hadError
        ? [capMsg, ...errors.slice(0, 5)].filter(Boolean).join("; ").slice(0, 1000)
        : null,
    })
    .eq("retailer_id", retailerId);

  // Optional: log to scrape_log if the table exists in your schema
  try {
    await supa.from("scrape_log").insert({
      retailer_id: retailerId,
      status: errors.length > 0 ? "partial_failure" : "success",
      products_seen: feedRows,
      products_updated: updatesApplied,
      products_inserted: linksApplied + createsApplied,
      duration_ms: Date.now() - startTime,
    });
  } catch { /* table may not have these exact columns; ignore */ }

  // Refresh ISR caches for the brands/categories this run touched (best-effort).
  await triggerRevalidation(supa, retailerId, runStartedAt);

  result.applied = {
    updates_applied: updatesApplied,
    links_applied: linksApplied,
    creates_applied: createsApplied,
    suppressed_duplicate_create: countSuppressedDuplicateCreate,
    capped_creates: cappedCreates,
    error_count: errors.length,
    sample_errors: errors.slice(0, 10),
  };
  result.duration_ms = Date.now() - startTime;

  return new Response(JSON.stringify(result, null, 2), { headers: { "Content-Type": "application/json" } });
});// touch 1779206234
