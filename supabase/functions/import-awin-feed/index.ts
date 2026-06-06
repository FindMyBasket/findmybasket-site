// Edge function: import-awin-feed (v6.16)
//
// Generic, retailer-agnostic AWIN datafeed importer.
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
    ["fragrance", /\b(fragrance|perfume|cologne|eau de (parfum|toilette)|edt|edp|aftershave splash|aftershave spray|aftershave cologne|after.?shave \d+\s*(ml|oz)\b|after.?shave (splash|spray|cologne)|parfum (spray|refill|refillable)|parfum \d+\s*(ml|oz))\b/],
    ["supplement", /\b(supplement|vitamin tablet|capsule|gummies|protein shake|meal replacement|powder drink)\b/],
    ["oral_care", /\b(toothpaste|toothbrush|mouthwash|dental floss|whitening strip)\b/],
    ["period_care", /\b(tampons?|sanitary pads?|menstrual|period care|panty liner|pantyliner)\b/],
    ["deodorant", /\b(deodorant|antiperspirant|body spray)\b/],
    ["shaving", /\b(razor|shaving foam|shave gel|shave cream|epilator|wax strip)\b/],
    // hair_tool: extended to catch hair brushes by brand (Mason Pearson) and
    // by descriptor patterns (bristle brush, boar bristle, paddle brush etc.)
    ["hair_tool", /\b(hair dryer|straightener|curling iron|curling wand|hair brush|paddle brush|bristle brush|boar bristle|comb|hair clip|hair tie|scrunchie|mason pearson)\b/],
    ["makeup_tool", /\b(makeup brush|beauty blender|sponge|eyelash curler|brush set|brush cleaner)\b/],
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
  const fragranceIsScentDescriptor = (
    /\b(shampoo|conditioner|hair mask|hair oil|hair serum|hair spray|hairspray|dry shampoo|body wash|body lotion|body cream|body butter|hand cream|shower gel|bubble bath)\b/.test(t)
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
    const hairBrand = /\b(olaplex|kerastase|kérastase|moroccanoil|oribe|virtue labs|american crew|bumble and bumble|bumble & bumble|living proof|redken|paul mitchell|pureology|color wow|colour wow|sachajuan|label\.?m|tigi)\b/;
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
    } else if (/\b(hair (mask|treatment|repair|reconstruct|perfector))|bond builder|olaplex|protein treatment\b/.test(t)) {
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
    if (/\b(lipstick|lip gloss|lip stain|lip lacquer|lip pencil|lip liner|lip tint|lip plumper|lip cream|lip paint|lip color|lip colour|lip shine|lip crayon|color balm|colour balm|liquid lip|matte lip|cream lip)\b/.test(t)) return true;
    if (/\b(mascara|eyeliner|eye liner|eye shadow|eyeshadow|eyebrow|brow (pencil|gel|pomade|powder|tint|definer|enhancer|fixer|sculptor))\b/.test(t)) return true;
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
    } else if (/\b(eyebrow|brow (pencil|gel|pomade|powder|tint|definer|enhancer|fixer|sculptor))\b/.test(t)) {
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
    else if (/\b(foundation|bb cream|cc cream|skin tint|tinted moisturiser|tinted moisturizer)\b/.test(t)) {
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
  let skincare_product_type = "";
  if (/\blip (balm|oil|treatment|mask|scrub|butter|conditioner)\b/.test(t)) skincare_product_type = "Lip Care";
  else if (/\b(eye cream|eye serum|eye gel|eye mask|eye balm|under.?eye)\b/.test(t)) skincare_product_type = "Eye Care";
  else if (/\b(mask|peel|pack)\b/.test(t)) skincare_product_type = "Mask";
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
// AND at the start of the name field (Skin Cupid, Stylevana, some others),
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

  if (!config.enabled) {
    return new Response(JSON.stringify({
      error: "Retailer import is disabled (config.enabled = false)",
      retailer_id: retailerId,
    }), { status: 400, headers: { "Content-Type": "application/json" } });
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
  // v6: per-retailer top_category override (null/missing = let inference decide)
  const topCategoryDefault: TopCategory | null =
    (config.top_category_default === "skincare" ||
     config.top_category_default === "makeup" ||
     config.top_category_default === "hair")
      ? config.top_category_default
      : null;

  // Step 2: Load existing retailer_prices rows for this retailer
  // We fetch in batches because Supabase caps at 1000 per request.
  const existingRows: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supa
      .from("retailer_prices")
      .select("id, product_id, external_product_id, price, in_stock, ean, mpn")
      .eq("retailer_id", retailerId)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) {
      return new Response(JSON.stringify({ error: "DB read failed (retailer_prices)", details: error }), { status: 500 });
    }
    if (!data || data.length === 0) break;
    existingRows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const existingByExtId = new Map<string, any>();
  for (const r of existingRows) {
    if (r.external_product_id) existingByExtId.set(r.external_product_id, r);
  }

  // Path 1: cross-retailer EAN/MPN lookup tables.
  const eanToProductId = new Map<string, number>();
  const mpnToProductId = new Map<string, number>();
  {
    let efrom = 0;
    while (true) {
      const { data, error } = await supa
        .from("ean_product_index")
        .select("ean, product_id")
        .order("ean", { ascending: true })
        .range(efrom, efrom + 999);
      if (error) {
        return new Response(JSON.stringify({ error: "DB read failed (ean_product_index)", details: error }), { status: 500 });
      }
      if (!data || data.length === 0) break;
      for (const r of data) {
        const k = String(r.ean || "").trim();
        if (k && r.product_id != null && !eanToProductId.has(k)) {
          eanToProductId.set(k, r.product_id);
        }
      }
      if (data.length < 1000) break;
      efrom += 1000;
    }
  }
  {
    let mfrom = 0;
    while (true) {
      const { data, error } = await supa
        .from("mpn_product_index")
        .select("mpn, product_id")
        .order("mpn", { ascending: true })
        .range(mfrom, mfrom + 999);
      if (error) {
        return new Response(JSON.stringify({ error: "DB read failed (mpn_product_index)", details: error }), { status: 500 });
      }
      if (!data || data.length === 0) break;
      for (const r of data) {
        const k = String(r.mpn || "").trim();
        if (k && r.product_id != null && !mpnToProductId.has(k)) {
          mpnToProductId.set(k, r.product_id);
        }
      }
      if (data.length < 1000) break;
      mfrom += 1000;
    }
  }

  // Step 3: Load all products in DB for fuzzy name matching
  const allProducts: any[] = [];
  from = 0;
  while (true) {
    const { data, error } = await supa
      .from("products")
      .select("id, name, brand")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) {
      return new Response(JSON.stringify({ error: "DB read failed (products)", details: error }), { status: 500 });
    }
    if (!data || data.length === 0) break;
    allProducts.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  // Build lookup maps for fuzzy product matching.
  const productByExact = new Map<string, number>();
  const productByStripped = new Map<string, number>();
  const urlToProductId = new Map<string, number>();  // URL → product_id (retailer-scoped via existingRows)
  for (const r of existingRows) {
   if (r.url && r.product_id != null) {
    urlToProductId.set(r.url, r.product_id);
  }
}
  const sizeByProductId = new Map<number, string>();
  const existingBrandSet = new Set<string>();
  for (const p of allProducts) {
    const exactKey = buildMatchKey(p.brand || "", p.name);
    if (!exactKey) continue;
    if (!productByExact.has(exactKey)) productByExact.set(exactKey, p.id);
    const strippedKey = stripSize(exactKey);
    if (strippedKey && !productByStripped.has(strippedKey)) {
      productByStripped.set(strippedKey, p.id);
    }
    sizeByProductId.set(p.id, extractSize(exactKey));
    if (p.brand) {
      const normBrand = String(p.brand).toLowerCase().trim();
      if (normBrand) existingBrandSet.add(normBrand);
    }
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
    return new Response(JSON.stringify({
      error: "Google Shopping (Darwin) format requires config.feed_url to be set",
      retailer_id: retailerId,
      hint: "Find the download URL in the AWIN dashboard (right-click the download button → Copy Link Address) and store it in retailer_import_config.feed_url",
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  } else {
    feedUrl = buildFeedUrl(apiKey, config.awin_feed_id);
  }

  const fetchT0 = Date.now();
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
  const fetchMs = Date.now() - fetchT0;

  const lines = text.split("\n");
  if (lines.length < 50) {
    return new Response(JSON.stringify({
      error: "Feed returned fewer than 50 rows — aborting (likely AWIN incident or bad feed ID)",
      lines: lines.length,
      feed_format: feedFormat,
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }

  // Strip BOM (Google Shopping CSV files have UTF-8 BOM)
  const headerLine = lines[0].replace(/^\uFEFF/, "");
  const columns = parseRow(headerLine).map(c => c.replace(/^"|"$/g, ""));

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

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    feedRows++;

    const fields = parseRow(line).map(f => f.replace(/^"|"$/g, ""));
    const name = fields[idx.product_name] || "";
    const brand = fields[idx.brand_name] || "";
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

    // Tier 4: name stripped + size-verified match
    if (!matchedProductId) {
      const candidates: (number | undefined)[] = [
        productByStripped.get(productMatchKey),
        productByExact.get(strippedMatchKey),
        productByStripped.get(strippedMatchKey),
      ];
      for (const candidateId of candidates) {
        if (!candidateId) continue;
        const targetSize = sizeByProductId.get(candidateId) || "";
        if (sourceSize === targetSize) {
          matchedProductId = candidateId;
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
    if (!matchedProductId && wrappedUrl && urlToProductId.has(wrappedUrl)) {
      countSkippedShadeVariant++;
      if (sampleSkippedShadeVariant.length < 20) {
        sampleSkippedShadeVariant.push({
          name, brand,
          existing_product_id: urlToProductId.get(wrappedUrl),
        });
      }
      continue;
    }
    if (matchedProductId) {
      countLinkExisting++;
      linkActions.push({ product_id: matchedProductId, ext_id: matchValue, price, url: wrappedUrl, in_stock: inStock, ean: rawEan, mpn: rawMpn, image_url: imageUrl });
      if (normEan && !eanToProductId.has(normEan)) eanToProductId.set(normEan, matchedProductId);
      if (normMpn && !mpnToProductId.has(normMpn)) mpnToProductId.set(normMpn, matchedProductId);
      if (sampleLinkExisting.length < 25) {
        sampleLinkExisting.push({ name, brand, matched_product_id: matchedProductId, price, matched_via: matchedVia });
      }
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
    // Track URL for shade-variant detection on subsequent rows in this same import
    if (wrappedUrl) urlToProductId.set(wrappedUrl, -1);
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

  // v6: top_category breakdown of would-create-new
  const v6TopCategoryBreakdown = {
    skincare: createActions.filter(a => a.top_category === "skincare").length,
    makeup: createActions.filter(a => a.top_category === "makeup").length,
    hair: createActions.filter(a => a.top_category === "hair").length,
  };

  // v6.16: canonical_size extraction success on new products
  const v6CanonicalSizeExtracted = createActions.filter(a => a.canonical_size != null).length;
  
  // v6.17: shade extraction success on new products
  const v6ShadeExtracted = createActions.filter(a => a.shade != null).length;

  // v6.13: build top-N category paths breakdown (sorted by count desc)
  const categoryPathBreakdown = Array.from(categoryPathCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([path, count]) => ({ path, count }));

  // Safeguard: cap on new products created in one run.
  if (countCreateNew > 20000) {
    return new Response(JSON.stringify({
      error: "Would create more than 20000 new products in one run — aborting as a safety cap",
      retailer_id: retailerId,
      feed_id_used: config.awin_feed_id,
      feed_total_rows: feedRows,
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
        canonical_size_extracted_on_new: v6CanonicalSizeExtracted,
        shade_extracted_on_new: v6ShadeExtracted,
        rows_with_ean: rowsWithEan,
        rows_with_mpn: rowsWithMpn,
      },
      v6_top_category_breakdown: v6TopCategoryBreakdown,
      v6_exclusion_breakdown: v6ExclusionBreakdown,
      sample_v6_excluded: sampleV6Excluded,
      sample_excluded_by_category: sampleExcluded,
      sample_link_to_existing: sampleLinkExisting,
      sample_create_new: sampleCreateNew,
      sample_raw_category_data: sampleRawCategoryData,
      category_path_breakdown: categoryPathBreakdown,
    }, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
  }

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
      canonical_size_extracted_on_new: v6CanonicalSizeExtracted,
      shade_extracted_on_new: v6ShadeExtracted,
      rows_with_ean: rowsWithEan,
      rows_with_mpn: rowsWithMpn,
    },
    v6_top_category_breakdown: v6TopCategoryBreakdown,
    v6_exclusion_breakdown: v6ExclusionBreakdown,
    ordinary_diagnostic: ordinaryDiagnostic,
    sample_v6_excluded: sampleV6Excluded,
    sample_excluded_by_category: sampleExcluded,
    sample_link_to_existing: sampleLinkExisting,
    sample_create_new: sampleCreateNew,
    sample_raw_category_data: sampleRawCategoryData,
    category_path_breakdown: categoryPathBreakdown,
    duration_ms_so_far: Date.now() - startTime,
  };

  if (dryRun) {
    return new Response(JSON.stringify(result, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  // ============================ APPLY ============================
  let updatesApplied = 0;
  let linksApplied = 0;
  let createsApplied = 0;
  const errors: string[] = [];

  // 1. Updates — single bulk RPC.
  if (updateActions.length > 0) {
    const nowIso = new Date().toISOString();
    const payload = updateActions.map(u => ({
      id: u.rp_id,
      price: u.price,
      in_stock: u.in_stock,
      last_updated: nowIso,
      url: u.url || "",
      ean: u.ean || "",
      mpn: u.mpn || "",
    }));
    const { data: rpcResult, error: rpcErr } = await supa.rpc("bulk_update_retailer_prices", { updates: payload });
    if (rpcErr) {
      errors.push(`bulk_update_retailer_prices: ${rpcErr.message}`);
    } else {
      updatesApplied = typeof rpcResult === "number" ? rpcResult : updateActions.length;
    }

    // Image backfill on existing products. Single bulk RPC.
    const imageUpdates = updateActions
      .filter(u => u.image_url)
      .map(u => ({ product_id: u.product_id, image_url: u.image_url }));
    if (imageUpdates.length > 0) {
      const { error: imgErr } = await supa.rpc("bulk_update_product_images", { updates: imageUpdates });
      if (imgErr) {
        errors.push(`bulk_update_product_images (updates): ${imgErr.message}`);
      }
    }
  }

  // 2. Links — dedupe and bulk upsert.
  const dedupedLinks = new Map<number, typeof linkActions[number]>();
  for (const l of linkActions) {
    const existing = dedupedLinks.get(l.product_id);
    if (!existing || l.price < existing.price) {
      dedupedLinks.set(l.product_id, l);
    }
  }
  const dedupedLinkArray = Array.from(dedupedLinks.values());

  const INSERT_CHUNK = 500;
  for (let i = 0; i < dedupedLinkArray.length; i += INSERT_CHUNK) {
    const chunk = dedupedLinkArray.slice(i, i + INSERT_CHUNK);
    const rows = chunk.map(l => ({
      product_id: l.product_id,
      retailer_id: retailerId,
      price: l.price,
      url: l.url,
      in_stock: l.in_stock,
      external_product_id: l.ext_id,
      ean: l.ean || null,
      mpn: l.mpn || null,
      last_updated: new Date().toISOString(),
    }));
    const { error } = await supa
      .from("retailer_prices")
      .upsert(rows, { onConflict: "product_id,retailer_id" });
    if (error) {
      errors.push(`link batch starting at ${i}: ${error.message}`);
    } else {
      linksApplied += chunk.length;
    }
  }

  // 2b. Image backfill on linked products. Single bulk RPC.
  const linkImageUpdates = dedupedLinkArray
    .filter(l => l.image_url)
    .map(l => ({ product_id: l.product_id, image_url: l.image_url }));
  if (linkImageUpdates.length > 0) {
    const { error: linkImgErr } = await supa.rpc("bulk_update_product_images", { updates: linkImageUpdates });
    if (linkImgErr) {
      errors.push(`bulk_update_product_images (links): ${linkImgErr.message}`);
    }
  }

  // 3. Creates — two-phase bulk insert (v6.16: now writes canonical_size)
  for (let i = 0; i < createActions.length; i += INSERT_CHUNK) {
    const chunk = createActions.slice(i, i + INSERT_CHUNK);
    const productRows = chunk.map(c => ({
      name: c.name,
      brand: c.brand,
      category: c.category,
      product_type: c.product_type,
      top_category: c.top_category,
      subcategory: c.subcategory,
      tags: c.tags,
      canonical_size: c.canonical_size,
      shade: c.shade,
      image_url: c.image_url || null,
    }));
    const { data: insertedProducts, error: pErr } = await supa
      .from("products")
      .insert(productRows)
      .select("id");

    if (pErr || !insertedProducts || insertedProducts.length !== chunk.length) {
      errors.push(`create products batch at ${i}: ${pErr?.message || "row count mismatch"}`);
      continue;
    }

    const priceRows = chunk.map((c, idx) => ({
      product_id: insertedProducts[idx].id,
      retailer_id: retailerId,
      price: c.price,
      url: c.url,
      in_stock: c.in_stock,
      external_product_id: c.ext_id,
      ean: c.ean || null,
      mpn: c.mpn || null,
      last_updated: new Date().toISOString(),
    }));
    const { error: rpErr } = await supa.from("retailer_prices").insert(priceRows);
    if (rpErr) {
      errors.push(`create rps batch at ${i}: ${rpErr.message}`);
    } else {
      createsApplied += chunk.length;
    }
  }

  // Update last_imported_at on the config row
  await supa
    .from("retailer_import_config")
    .update({ last_imported_at: new Date().toISOString(), updated_at: new Date().toISOString() })
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

  result.applied = {
    updates_applied: updatesApplied,
    links_applied: linksApplied,
    creates_applied: createsApplied,
    error_count: errors.length,
    sample_errors: errors.slice(0, 10),
  };
  result.duration_ms = Date.now() - startTime;

  return new Response(JSON.stringify(result, null, 2), { headers: { "Content-Type": "application/json" } });
});// touch 1779206234
