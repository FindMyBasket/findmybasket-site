// Edge function: import-rakuten-feed (v6.19-rakuten.0)
//
// Generic, retailer-agnostic Rakuten LinkShare datafeed importer.
//
// v6.19-rakuten.0 changes (chunk all bulk-apply RPCs — port of import-awin-feed v6.19):
//   - bulk_update_retailer_prices and both bulk_update_product_images calls were
//     each sent as a single statement over the whole batch. On Superdrug
//     (~21,700 rows) that exceeds the Postgres statement timeout and the
//     statement is cancelled, silently dropping the entire batch — only ~100
//     price rows were landing per run and the other ~21k went stale (>14 days).
//   - All three (prices, update-image, link-image) now chunk at INSERT_CHUNK
//     (500), matching the link/create paths. updatesApplied accumulates with
//     += across chunks instead of being overwritten.
//
// v6.16-rakuten.0 changes (Stream B — canonical_size):
//   - New extractCanonicalSize() pulls a size string (e.g. "50ml", "30g",
//     "1.5oz") from the raw product name. Operates on the unnormalised
//     name to preserve decimals.
//   - createActions now carries canonical_size; productRows insert writes
//     it. Backwards compat: null on rows where extraction is uncertain.
//   - New diagnostic counter canonical_size_extracted_on_new shows hit
//     rate in dry-run output.
//
// v6.15-rakuten.1 changes:
//   - Added `skip_name_match` config flag. When true, skips the expensive
//     loading of all products + building of normalised name maps. Suitable
//     for retailers with high EAN coverage (>95%) like Superdrug. Saves
//     ~150-200ms CPU on a 40K-product catalogue.
//
// v6.15-rakuten changes (port of v6.15 from import-awin-feed):
//   - Replaced inferCategory() with inferCategorisation() — returns
//     {top_category, product_type, subcategory, tags, excluded?}
//   - top_category written as 'skincare' | 'makeup' | 'hair'
//   - Denylist (fragrance, supplement, oral_care, period_care, deodorant,
//     shaving, hair_tool, makeup_tool, bath_set, baby, accessory) skips
//     non-beauty rows before they become products
//   - v6_excluded counter and breakdown in response for visibility
//   - Subcategory and tags written to products table
//   - Safety cap raised 10K → 20K (Superdrug-feed-sized)
//   - HTTP 200 status on cap-exceeded so Supabase UI shows breakdown
//
// Pipeline:
//   - Fetch pre-converted NDJSON feed from Supabase Storage (uploaded by
//     GitHub Actions which fetches XML from aftp.linksynergy.com via SFTP,
//     converts XML to NDJSON, and uploads gzipped). Streaming line-by-line
//     keeps memory bounded.
//   - Match feed rows against existing products in DB (EAN/MPN/name)
//   - INSERT new products, link to existing products, update price/stock
//   - Filter by category path (configurable per retailer in retailer_import_config)
//
// Feed format (NDJSON, one product per line):
//   {"name":"...","sku":"...","product_id":"...","brand":"...",
//    "category_primary":"Health & Beauty",
//    "category_secondary":"Personal Care~~Cosmetics~~Skincare~~Lotions",
//    "price":6.49,"availability":"in-stock","url":"https://click...",
//    "upc":"01234567890","mpn":"..."}
//
// Storage convention:
//   - Bucket: "rakuten-feeds" (private)
//   - Path: feeds/<retailer_slug>/latest.ndjson.gz
//
// Call:
//   POST /functions/v1/import-rakuten-feed
//   body: {
//     "retailer_id": 12,
//     "feed_path": "feeds/superdrug/latest.ndjson.gz",
//     "feed_bucket": "rakuten-feeds",  // optional
//     "dry_run": true
//   }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
function inferCategorisation(name, brand = "") {
  const t = String(name || "").toLowerCase();
  const b = String(brand || "").toLowerCase();
  // ─── Step 1: Excluded categories (denylist) ──────────────────────────────
  const excludeChecks = [
    [
      "fragrance",
      /\b(fragrance|perfume|cologne|eau de (parfum|toilette)|edt|edp|aftershave splash|aftershave spray|aftershave cologne|after.?shave \d+\s*(ml|oz)\b|after.?shave (splash|spray|cologne)|parfum (spray|refill|refillable)|parfum \d+\s*(ml|oz))\b/
    ],
    [
      "supplement",
      /\b(supplement|vitamin tablet|capsule|gummies|protein shake|meal replacement|powder drink)\b/
    ],
    [
      "oral_care",
      /\b(toothpaste|toothbrush|mouthwash|dental floss|whitening strip)\b/
    ],
    [
      "period_care",
      /\b(tampons?|sanitary pads?|menstrual|period care|panty liner|pantyliner)\b/
    ],
    [
      "deodorant",
      /\b(deodorant|antiperspirant|body spray)\b/
    ],
    [
      "shaving",
      /\b(razor|shaving foam|shave gel|shave cream|epilator|wax strip)\b/
    ],
    [
      "hair_tool",
      /\b(hair dryer|straightener|curling iron|curling wand|hair brush|paddle brush|bristle brush|boar bristle|comb|hair clip|hair tie|scrunchie|mason pearson)\b/
    ],
    [
      "makeup_tool",
      /\b(makeup brush|beauty blender|sponge|eyelash curler|brush set|brush cleaner)\b/
    ],
    [
      "bath_set",
      /\b(gift set|bath set|body care set|grooming set|skincare set)\b/
    ],
    [
      "baby",
      /\b(baby (cream|lotion|wash|shampoo|wipes?|powder|oil|bath|skincare|sunscreen|sun cream)|babies|infant|newborn|toddler|nappy|diaper)\b/
    ],
    [
      "accessory",
      /\b(headband|hair tie|spatula|applicator only|case only|bag only|pouch)\b/
    ]
  ];
  const fragranceIsScentDescriptor = /\b(shampoo|conditioner|hair mask|hair oil|hair serum|hair spray|hairspray|dry shampoo|body wash|body lotion|body cream|body butter|hand cream|shower gel|bubble bath)\b/.test(t);
  for (const [reason, re] of excludeChecks){
    if (reason === "fragrance" && fragranceIsScentDescriptor) continue;
    if (re.test(t)) {
      return {
        top_category: null,
        product_type: "",
        subcategory: "",
        tags: [],
        excluded: reason
      };
    }
  }
  // ─── Step 2: Hair detection ──────────────────────────────────────────────
  const hairCheck = (()=>{
    if (/\b(shampoo|conditioner|co-?wash|leave-?in)\b/.test(t)) return true;
    if (/\b(hair (mask|oil|serum|spray|cream|gel|mousse|wax|balm|treatment|tonic|perfector|repair|food|primer))\b/.test(t)) return true;
    if (/\b(scalp (treatment|serum|oil|scrub|tonic|massage))\b/.test(t)) return true;
    if (/\b(hair (colour|color|dye|toner|bleach))\b/.test(t)) return true;
    if (/\b(dry shampoo|hair perfume|root touch.?up|heat protect|frizz control)\b/.test(t)) return true;
    if (/\b(hairspray|hair spray|hair lacquer|setting spray hair)\b/.test(t)) return true;
    if (/\b(olaplex|kerastase|kérastase|moroccanoil|oribe|virtue labs)\b/.test(t)) return true;
    if (/\b(olaplex|kerastase|kérastase|moroccanoil|oribe|virtue labs)\b/.test(b)) return true;
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
    } else if (/\b(hair (spray|gel|mousse|wax|balm|cream|pomade|paste|fiber|fibre)|hairspray|edge control)\b/.test(t)) {
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
      tags: [
        "hair",
        subcategory
      ].filter(Boolean)
    };
  }
  // ─── Step 3: Makeup detection ────────────────────────────────────────────
  const makeupCheck = (()=>{
    if (/\b(lipstick|lip gloss|lip stain|lip lacquer|lip pencil|lip liner|lip tint|lip plumper|lip cream|lip paint|lip color|lip colour|lip shine|lip crayon|color balm|colour balm|liquid lip|matte lip|cream lip)\b/.test(t)) return true;
    if (/\b(mascara|eyeliner|eye liner|eye shadow|eyeshadow|eyebrow|brow (pencil|gel|pomade|powder|tint|definer|enhancer|fixer|sculptor))\b/.test(t)) return true;
    if (/\b(quickliner|kohl)\b/.test(t)) return true;
    if (/\b(foundation|concealer|colour corrector|color corrector|primer)\b/.test(t)) return true;
    if (/\b(blush|bronzer|highlighter|highlighting|contour|contouring|illuminator|strobing|strobe)\b/.test(t)) return true;
    if (/\bbronze\b.*\b(powder|palette|stick|shimmer|glow palette)\b/.test(t)) return true;
    if (/\b(setting (spray|powder)|finishing powder|fixing spray|fixing mist)\b/.test(t)) return true;
    if (/\b(face powder|pressed powder|loose powder|compact powder|superpowder|powder makeup)\b/.test(t)) return true;
    if (/\b(nail (polish|colour|color|lacquer|varnish|enamel)|nail (treatment|strengthener)|cuticle (oil|cream)|nail base|base coat|top coat|nail file)\b/.test(t)) return true;
    if (/\bfalse (lashes|eyelashes)|lash (extension|adhesive|glue)\b/.test(t)) return true;
    if (/\bmakeup\b/.test(t) && !/\bmakeup (remover|removal|wipe)\b/.test(t)) return true;
    return false;
  })();
  if (makeupCheck) {
    let product_type = "Makeup";
    let subcategory = "";
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
    } else if (/\b(lip pencil|lip liner)\b/.test(t)) {
      product_type = "Lip Liner";
      subcategory = "lips";
    } else if (/\b(lip gloss|lip stain|lip lacquer|lip tint|lip plumper|lip paint|lip color|lip colour|lip shine)\b/.test(t)) {
      product_type = "Lip Colour";
      subcategory = "lips";
    } else if (/\b(lipstick|liquid lip|matte lip|cream lip|lip cream|color balm|colour balm|lip crayon)\b/.test(t)) {
      product_type = "Lipstick";
      subcategory = "lips";
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
    } else if (/\b(nail (polish|colour|color|lacquer|varnish|enamel))\b/.test(t)) {
      product_type = "Nail Polish";
      subcategory = "nails";
    } else if (/\b(nail (treatment|strengthener|oil)|cuticle (oil|cream))\b/.test(t)) {
      product_type = "Nail Treatment";
      subcategory = "nails";
    } else if (/\b(superbalanced|sheer|matte|liquid|cream|stick) makeup\b/.test(t)) {
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
      tags: [
        "makeup",
        subcategory
      ].filter(Boolean)
    };
  }
  // ─── Step 4: Skincare detection (existing logic) ──────────────────────────
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
  else skincare_product_type = "Skincare";
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
  const skin_tags = [
    "skincare",
    skin_subcategory
  ];
  if (skincare_product_type === "Lip Care" || /\blip (balm|oil|treatment|mask)\b/.test(t)) {
    if (!skin_tags.includes("lips")) skin_tags.push("lips");
    skin_tags.push("lip_care");
  }
  if (/\b(men|men's|for men|mens)\b/.test(t) || /\b(men|men's|for men|mens)\b/.test(b)) {
    skin_tags.push("mens");
  }
  return {
    top_category: "skincare",
    product_type: skincare_product_type,
    subcategory: skin_subcategory,
    tags: skin_tags
  };
}
// ============================================================================
// Helpers
// ============================================================================
function passthroughUrl(url) {
  return (url || "").trim();
}
function isExcludedCategory(categoryPath, categoryName, excludes) {
  const haystack = `${categoryPath} ${categoryName}`.toLowerCase();
  for (const term of excludes){
    if (haystack.includes(term.toLowerCase())) {
      return {
        excluded: true,
        matched_term: term
      };
    }
  }
  return {
    excluded: false
  };
}
function isPathIncluded(categoryPath, mustContain) {
  if (mustContain.length === 0) return {
    included: true
  };
  const haystack = categoryPath.toLowerCase();
  for (const term of mustContain){
    if (haystack.includes(term.toLowerCase())) {
      return {
        included: true
      };
    }
  }
  return {
    included: false,
    reason: "path_not_in_scope"
  };
}
function isExcludedName(name, excludes) {
  if (excludes.length === 0) return {
    excluded: false
  };
  const haystack = name.toLowerCase();
  for (const term of excludes){
    if (haystack.includes(term.toLowerCase())) {
      return {
        excluded: true,
        matched_term: term
      };
    }
  }
  return {
    excluded: false
  };
}
function normaliseForMatch(s) {
  return String(s || "").toLowerCase().replace(/[\u2018\u2019\u201C\u201D]/g, "'").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
// Build a match key from brand + name, deduplicating when name starts with brand.
// Handles the case where some retailers put the brand in both the brand field
// AND at the start of the name field (Stylevana and some others),
// while other retailers only put it in the brand field. Without this, the
// matcher creates duplicate products because match keys differ:
//   Retailer A: "mixsoon mixsoon bifida ferment essence 100ml"  (brand in name)
//   Retailer B: "mixsoon bifida ferment essence 100ml"          (brand not in name)
function buildMatchKey(brand, name) {
  const normBrand = normaliseForMatch(brand);
  const normName = normaliseForMatch(name);
  if (normBrand && normName.startsWith(normBrand + " ")) {
    return normName; // Brand already at start of name; don't prepend
  }
  if (normBrand && normName === normBrand) {
    return normBrand; // Name IS the brand (rare)
  }
  return `${normBrand} ${normName}`.trim();
}
function normaliseEan(raw) {
  if (!raw) return null;
  const digitsOnly = String(raw).replace(/[^0-9]/g, "");
  const stripped = digitsOnly.replace(/^0+/, "");
  if (stripped.length < 8) return null;
  return stripped;
}
function normaliseMpn(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}
function stripSize(normalised) {
  return normalised.replace(/\b\d+\s*(ml|g|kg|oz|pcs|pc|ea|pack|count|ct|sheets?)\b.*$/g, "").replace(/\bx\s*\d+\s*$/g, "").trim();
}
// Extract a canonical size string ("50ml", "30g", "1.5oz") from a raw product
// name. Returns null if no confident size found. Used to populate the
// canonical_size field on new product rows.
//
// Differs from extractSize(): operates on the raw name (precision-preserving,
// decimals intact) and is conservative — requires a clear unit suffix to avoid
// false positives like shade numbers, SPF values, model numbers.
function extractCanonicalSize(rawName) {
  if (!rawName) return null;
  const s = String(rawName);
  const SIZE_REGEX = /(?<!\w)(\d+(?:\.\d+)?)\s*(ml|g|kg|oz|fl\.?\s*oz)\b/gi;
  const matches = [
    ...s.matchAll(SIZE_REGEX)
  ];
  if (matches.length === 0) return null;
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
function extractShade(rawName) {
  if (!rawName) return null;
  const s = String(rawName);
  const cleanCandidate = (raw)=>{
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
  const dashMatch = s.match(/\s-\s([^-]+?)\s*$/);
  if (dashMatch) {
    const result = cleanCandidate(dashMatch[1]);
    if (result) return result;
  }
  const commaMatch = s.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s*,\s*\d+(?:\.\d+)?\s*(?:ml|g|kg|oz|pcs?)\b/);
  if (commaMatch) {
    const result = cleanCandidate(commaMatch[1]);
    if (result) return result;
  }
  return null;
}
function extractSize(normalised) {
  const volMatch = normalised.match(/\b(\d+(?:\.\d+)?)\s*(ml|g|kg|oz)\b/);
  if (volMatch) return `${volMatch[1]}${volMatch[2]}`;
  const countMatch = normalised.match(/\b(\d+)\s*(pcs|pc|ea|count|ct|sheets?|pack)\b/);
  if (countMatch) {
    let unit = countMatch[2];
    if (unit === "sheet" || unit === "sheets") unit = "pcs";
    if (unit === "pc") unit = "pcs";
    if (unit === "count" || unit === "ct") unit = "pcs";
    if (unit === "pack") unit = "pcs";
    return `${countMatch[1]}${unit}`;
  }
  const xMatch = normalised.match(/\bx\s*(\d+)\s*$/);
  if (xMatch) return `${xMatch[1]}pcs`;
  return "";
}
// ============================================================================
// Records the outcome of an import attempt on the retailer's config row so that
// monitor-retailer-feeds can alert on failures immediately (instead of waiting
// for the 48h staleness backstop). Best-effort: never throws.
async function recordImportStatus(supa, retailerId, status, errorMsg) {
  try {
    await supa.from("retailer_import_config").update({
      last_attempt_at: new Date().toISOString(),
      last_import_status: status,
      last_import_error: errorMsg ? String(errorMsg).slice(0, 1000) : null,
      updated_at: new Date().toISOString()
    }).eq("retailer_id", retailerId);
  } catch (e) {
    console.error("recordImportStatus failed", String(e));
  }
}

// Main handler
// ============================================================================
serve(async (req)=>{
  const startTime = Date.now();
  let body = {};
  try {
    body = await req.json();
  } catch  {}
  const retailerId = body.retailer_id;
  const dryRun = body.dry_run !== false; // default true
  const feedPath = typeof body.feed_path === "string" ? body.feed_path : "";
  const feedBucket = typeof body.feed_bucket === "string" ? body.feed_bucket : "rakuten-feeds";
  if (!retailerId || typeof retailerId !== "number") {
    return new Response(JSON.stringify({
      error: "retailer_id (number) required in request body"
    }), {
      status: 400,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  if (!feedPath) {
    return new Response(JSON.stringify({
      error: "feed_path (string) required in request body — e.g. 'feeds/superdrug/latest.ndjson.gz'"
    }), {
      status: 400,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supa = createClient(supabaseUrl, serviceKey);
  // Step 1: Load retailer config
  const { data: config, error: configErr } = await supa.from("retailer_import_config").select("*").eq("retailer_id", retailerId).single();
  if (configErr || !config) {
    return new Response(JSON.stringify({
      error: "No retailer_import_config row for this retailer_id",
      retailer_id: retailerId
    }), {
      status: 404,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  if (!config.enabled) {
    return new Response(JSON.stringify({
      error: "Retailer import is disabled (config.enabled = false)",
      retailer_id: retailerId
    }), {
      status: 400,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const categoryExcludes = Array.isArray(config.category_excludes) ? config.category_excludes : [];
  const nameExcludes = Array.isArray(config.name_excludes) ? config.name_excludes : [];
  const categoryPathMustContain = Array.isArray(config.category_path_must_contain) ? config.category_path_must_contain : [];
  const existingBrandsOnly = config.existing_brands_only === true;
  // Brand canonicalisation: load the brand_aliases map ONCE (not per row), then
  // map raw feed brands to their canonical form before any downstream use
  // (categorisation, match-key building, storage). Mirrors LOWER(alias)=LOWER(input);
  // seeds canonical→canonical so a feed already sending the canonical passes through.
  const brandAliasMap = new Map();
  {
    const { data: aliasRows, error: aliasErr } = await supa.from("brand_aliases").select("alias, canonical");
    if (aliasErr) {
      console.warn("brand_aliases load failed; proceeding without canonicalisation:", aliasErr.message);
    } else if (aliasRows) {
      for (const r of aliasRows){
        const a = String(r.alias ?? "").toLowerCase().trim();
        const c = String(r.canonical ?? "");
        if (a && c) brandAliasMap.set(a, c);
      }
      for (const r of aliasRows){
        const c = String(r.canonical ?? "");
        const ck = c.toLowerCase().trim();
        if (ck && !brandAliasMap.has(ck)) brandAliasMap.set(ck, c);
      }
    }
  }
  const lookupCanonicalBrand = (raw)=>{
    const key = String(raw ?? "").toLowerCase().trim();
    if (!key) return raw;
    return brandAliasMap.get(key) ?? raw;
  };
  let countBrandCanonicalised = 0;
  const unmatchedBrandCounts = new Map();
  // Step 2: Load existing retailer_prices rows for this retailer
  const existingRows = [];
  let from = 0;
  while(true){
    const { data, error } = await supa.from("retailer_prices").select("id, product_id, external_product_id, price, in_stock, ean, mpn").eq("retailer_id", retailerId).order("id", {
      ascending: true
    }).range(from, from + 999);
    if (error) {
      return new Response(JSON.stringify({
        error: "DB read failed (retailer_prices)",
        details: error
      }), {
        status: 500
      });
    }
    if (!data || data.length === 0) break;
    existingRows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const existingByExtId = new Map();
  for (const r of existingRows){
    if (r.external_product_id) existingByExtId.set(r.external_product_id, r);
  }
  // Cross-retailer EAN/MPN lookup tables
  const eanToProductId = new Map();
  const mpnToProductId = new Map();
  {
    let efrom = 0;
    while(true){
      const { data, error } = await supa.from("ean_product_index").select("ean, product_id").order("ean", {
        ascending: true
      }).range(efrom, efrom + 999);
      if (error) {
        return new Response(JSON.stringify({
          error: "DB read failed (ean_product_index)",
          details: error
        }), {
          status: 500
        });
      }
      if (!data || data.length === 0) break;
      for (const r of data){
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
    while(true){
      const { data, error } = await supa.from("mpn_product_index").select("mpn, product_id").order("mpn", {
        ascending: true
      }).range(mfrom, mfrom + 999);
      if (error) {
        return new Response(JSON.stringify({
          error: "DB read failed (mpn_product_index)",
          details: error
        }), {
          status: 500
        });
      }
      if (!data || data.length === 0) break;
      for (const r of data){
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
  // For retailers with high EAN coverage (>95%) we can skip this entirely
  // and rely on cross-retailer EAN matching. The config flag
  // skip_name_match disables it. Saves significant CPU on large catalogues.
  const skipNameMatch = config.skip_name_match === true;
  const allProducts = [];
  if (!skipNameMatch) {
    from = 0;
    while(true){
      const { data, error } = await supa.from("products").select("id, name, brand").order("id", {
        ascending: true
      }).range(from, from + 999);
      if (error) {
        return new Response(JSON.stringify({
          error: "DB read failed (products)",
          details: error
        }), {
          status: 500
        });
      }
      if (!data || data.length === 0) break;
      allProducts.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  const productByExact = new Map();
  const productByStripped = new Map();
  const sizeByProductId = new Map();
  const existingBrandSet = new Set();
  for (const p of allProducts){
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
  // Step 4: Download feed from Storage and stream-process line-by-line
  const fetchT0 = Date.now();
  const { data: storageBlob, error: storageErr } = await supa.storage.from(feedBucket).download(feedPath);
  if (storageErr || !storageBlob) {
    await recordImportStatus(supa, retailerId, "error",
      `Storage download failed (${feedBucket}/${feedPath}): ${String(storageErr?.message || storageErr || "unknown")}`);
    return new Response(JSON.stringify({
      error: "Failed to download feed from Storage",
      bucket: feedBucket,
      path: feedPath,
      details: String(storageErr?.message || storageErr || "unknown").substring(0, 500)
    }), {
      status: 502,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const isGzipped = feedPath.endsWith(".gz");
  const blobStream = storageBlob.stream();
  const sourceStream = isGzipped ? blobStream.pipeThrough(new DecompressionStream("gzip")) : blobStream;
  const textStream = sourceStream.pipeThrough(new TextDecoderStream("utf-8"));
  // Step 5: Walk products line by line, classify each
  let feedRows = 0;
  let countExcludedPathNotInScope = 0;
  let countExcluded = 0;
  let countNoPrice = 0;
  let countNoMatchId = 0;
  let countOOS = 0;
  let countUpdate = 0;
  let countLinkExisting = 0;
  let countCreateNew = 0;
  let countSkippedNewBrand = 0;
  let countSizeMismatchRejected = 0;
  let countParseErrors = 0;
  let countV6Excluded = 0;
  const v6ExclusionBreakdown = {};
  const sampleV6Excluded = [];
  const sampleExcluded = [];
  const sampleLinkExisting = [];
  const sampleCreateNew = [];
  const sampleRawCategoryData = [];
  const v6TopCategoryBreakdown = {
    skincare: 0,
    makeup: 0,
    hair: 0
  };
  const SAMPLE_LIMIT_EXCLUDED = 50;
  const SAMPLE_LIMIT_CREATE_NEW = 50;
  const updateActions = [];
  const linkActions = [];
  const createActions = [];
  let countLinkViaEan = 0;
  let countLinkViaMpn = 0;
  let countLinkViaNameExact = 0;
  let countLinkViaNameStripped = 0;
  let rowsWithEan = 0;
  let rowsWithMpn = 0;
  const reader = textStream.getReader();
  let lineBuffer = "";
  const processProduct = (product)=>{
    feedRows++;
    const name = String(product.name || "");
    const skuNumber = String(product.sku || "");
    const productIdAttr = String(product.product_id || "");
    const rawBrand = String(product.brand || "");
    const brand = lookupCanonicalBrand(rawBrand);   // canonical from here down
    if (rawBrand) {
      if (brand !== rawBrand) countBrandCanonicalised++;
      else if (!brandAliasMap.has(rawBrand.toLowerCase().trim()))
        unmatchedBrandCounts.set(rawBrand, (unmatchedBrandCounts.get(rawBrand) ?? 0) + 1);
    }
    const primaryCat = String(product.category_primary || "");
    const secondaryCat = String(product.category_secondary || "");
    const categoryPath = `${primaryCat} > ${secondaryCat}`.replace(/~~/g, " > ");
    const categoryName = primaryCat;
    if (sampleRawCategoryData.length < 8) {
      sampleRawCategoryData.push({
        name,
        category_path: categoryPath,
        category_name: categoryName
      });
    }
    const pathInclusion = isPathIncluded(categoryPath, categoryPathMustContain);
    if (!pathInclusion.included) {
      countExcludedPathNotInScope++;
      return;
    }
    const categoryExclusion = isExcludedCategory(categoryPath, categoryName, categoryExcludes);
    if (categoryExclusion.excluded) {
      countExcluded++;
      if (sampleExcluded.length < SAMPLE_LIMIT_EXCLUDED) {
        sampleExcluded.push({
          name,
          brand,
          reason: "category",
          matched_term: categoryExclusion.matched_term,
          category_path: categoryPath
        });
      }
      return;
    }
    const nameExclusion = isExcludedName(name, nameExcludes);
    if (nameExclusion.excluded) {
      countExcluded++;
      if (sampleExcluded.length < SAMPLE_LIMIT_EXCLUDED) {
        sampleExcluded.push({
          name,
          brand,
          reason: "name",
          matched_term: nameExclusion.matched_term
        });
      }
      return;
    }
    const matchValue = config.match_column === "aw_product_id" ? productIdAttr : skuNumber;
    if (!matchValue) {
      countNoMatchId++;
      return;
    }
    const price = parseFloat(String(product.price));
    if (!isFinite(price) || price <= 0) {
      countNoPrice++;
      return;
    }
    const availStr = String(product.availability || "").toLowerCase();
    const inStock = availStr === "in-stock" || availStr === "instock" || availStr === "in_stock";
    if (!inStock) {
      countOOS++;
      return;
    }
    const merchantUrl = String(product.url || "");
    const wrappedUrl = passthroughUrl(merchantUrl);
    const rawEan = String(product.upc || "").trim();
    const rawMpn = String(product.mpn || "").trim();
    const normEan = normaliseEan(rawEan);
    const normMpn = normaliseMpn(rawMpn);
    if (normEan) rowsWithEan++;
    if (normMpn) rowsWithMpn++;
    // Image URL - feed-provided product image. Used for catalogue display.
    const imageUrl = String(product.image_url || "").trim();
    const existing = existingByExtId.get(matchValue);
    if (existing) {
      countUpdate++;
      updateActions.push({
        rp_id: existing.id,
        product_id: existing.product_id,
        price,
        url: wrappedUrl,
        in_stock: inStock,
        ean: rawEan,
        mpn: rawMpn,
        image_url: imageUrl
      });
      return;
    }
    let matchedProductId = undefined;
    let matchedVia = undefined;
    if (normEan && eanToProductId.has(normEan)) {
      matchedProductId = eanToProductId.get(normEan);
      matchedVia = "ean";
      countLinkViaEan++;
    }
    if (!matchedProductId && normMpn && mpnToProductId.has(normMpn)) {
      matchedProductId = mpnToProductId.get(normMpn);
      matchedVia = "mpn";
      countLinkViaMpn++;
    }
    const productMatchKey = buildMatchKey(brand, name);
    const strippedMatchKey = stripSize(productMatchKey);
    const sourceSize = extractSize(productMatchKey);
    if (!matchedProductId) {
      const id = productByExact.get(productMatchKey);
      if (id) {
        matchedProductId = id;
        matchedVia = "name_exact";
        countLinkViaNameExact++;
      }
    }
    if (!matchedProductId) {
      const candidates = [
        productByStripped.get(productMatchKey),
        productByExact.get(strippedMatchKey),
        productByStripped.get(strippedMatchKey)
      ];
      for (const candidateId of candidates){
        if (!candidateId) continue;
        const targetSize = sizeByProductId.get(candidateId) || "";
        if (sourceSize === targetSize) {
          matchedProductId = candidateId;
          matchedVia = "name_stripped";
          countLinkViaNameStripped++;
          break;
        }
        countSizeMismatchRejected++;
      }
    }
    if (matchedProductId) {
      countLinkExisting++;
      linkActions.push({
        product_id: matchedProductId,
        ext_id: matchValue,
        price,
        url: wrappedUrl,
        in_stock: inStock,
        ean: rawEan,
        mpn: rawMpn,
        image_url: imageUrl
      });
      if (normEan && !eanToProductId.has(normEan)) eanToProductId.set(normEan, matchedProductId);
      if (normMpn && !mpnToProductId.has(normMpn)) mpnToProductId.set(normMpn, matchedProductId);
      if (sampleLinkExisting.length < 25) {
        sampleLinkExisting.push({
          name,
          brand,
          matched_product_id: matchedProductId,
          price,
          matched_via: matchedVia
        });
      }
      return;
    }
    // V6 INFERENCE
    const cat = inferCategorisation(name, brand);
    if (cat.excluded) {
      countV6Excluded++;
      v6ExclusionBreakdown[cat.excluded] = (v6ExclusionBreakdown[cat.excluded] || 0) + 1;
      if (sampleV6Excluded.length < SAMPLE_LIMIT_EXCLUDED) {
        sampleV6Excluded.push({
          name,
          brand,
          reason: cat.excluded
        });
      }
      return;
    }
    if (existingBrandsOnly) {
      const normBrand = brand.toLowerCase().trim();
      if (!normBrand || !existingBrandSet.has(normBrand)) {
        countSkippedNewBrand++;
        return;
      }
    }
    countCreateNew++;
    if (cat.top_category) {
      v6TopCategoryBreakdown[cat.top_category] = (v6TopCategoryBreakdown[cat.top_category] || 0) + 1;
    }
    // v6.16: extract canonical_size from raw product name for the new product
    const canonicalSize = extractCanonicalSize(name);
    // v6.17: extract shade from raw product name for the new product
    const shade = extractShade(name, brand);
    createActions.push({
      ext_id: matchValue,
      name,
      brand,
      top_category: cat.top_category || "skincare",
      product_type: cat.product_type,
      subcategory: cat.subcategory,
      tags: cat.tags,
      canonical_size: canonicalSize,
      shade: shade,
      price,
      url: wrappedUrl,
      in_stock: inStock,
      ean: rawEan,
      mpn: rawMpn,
      image_url: imageUrl
    });
    if (sampleCreateNew.length < SAMPLE_LIMIT_CREATE_NEW) {
      sampleCreateNew.push({
        name,
        brand,
        top_category: cat.top_category,
        product_type: cat.product_type,
        subcategory: cat.subcategory,
        canonical_size: canonicalSize,
        shade: shade,
        price
      });
    }
  };
  // Stream-read the decompressed text
  try {
    while(true){
      const { value, done } = await reader.read();
      if (done) break;
      lineBuffer += value;
      let nlIdx;
      while((nlIdx = lineBuffer.indexOf("\n")) !== -1){
        const line = lineBuffer.substring(0, nlIdx).trim();
        lineBuffer = lineBuffer.substring(nlIdx + 1);
        if (!line) continue;
        try {
          const product = JSON.parse(line);
          processProduct(product);
        } catch (e) {
          countParseErrors++;
        }
      }
    }
    if (lineBuffer.trim()) {
      try {
        const product = JSON.parse(lineBuffer.trim());
        processProduct(product);
      } catch (e) {
        countParseErrors++;
      }
    }
  } catch (e) {
    await recordImportStatus(supa, retailerId, "error", `Stream read failed: ${String(e)}`);
    return new Response(JSON.stringify({
      error: "Stream read failed",
      details: String(e).substring(0, 500),
      rows_processed_so_far: feedRows
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const fetchMs = Date.now() - fetchT0;
  if (feedRows < 50) {
    await recordImportStatus(supa, retailerId, "error",
      `Feed contains fewer than 50 products (${feedRows}) — likely partial upload or wrong feed`);
    return new Response(JSON.stringify({
      error: "Feed contains fewer than 50 products — aborting (likely partial upload or wrong feed)",
      products_found: feedRows,
      parse_errors: countParseErrors
    }), {
      status: 502,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  // v6.16: canonical_size extraction success on new products
  const v6CanonicalSizeExtracted = createActions.filter((a)=>a.canonical_size != null).length;
  // v6.17: shade extraction success on new products
  const v6ShadeExtracted = createActions.filter((a)=>a.shade != null).length;
  // Safety cap — bumped to 20K (Superdrug-feed-sized).
  // Returns 200 status so Supabase UI shows the breakdown body.
  if (countCreateNew > 20000) {
    return new Response(JSON.stringify({
      error: "Would create more than 20000 new products in one run — aborting as a safety cap",
      retailer_id: retailerId,
      feed_format: "rakuten_xml",
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
        would_link_via_ean: countLinkViaEan,
        would_link_via_mpn: countLinkViaMpn,
        would_link_via_name_exact: countLinkViaNameExact,
        would_link_via_name_stripped: countLinkViaNameStripped,
        would_create_new_product: countCreateNew,
        canonical_size_extracted_on_new: v6CanonicalSizeExtracted,
        shade_extracted_on_new: v6ShadeExtracted,
        rows_with_ean: rowsWithEan,
        rows_with_mpn: rowsWithMpn
      },
      v6_top_category_breakdown: v6TopCategoryBreakdown,
      v6_exclusion_breakdown: v6ExclusionBreakdown,
      sample_v6_excluded: sampleV6Excluded,
      sample_excluded_by_category: sampleExcluded,
      sample_link_to_existing: sampleLinkExisting,
      sample_create_new: sampleCreateNew,
      sample_raw_category_data: sampleRawCategoryData
    }, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
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
    unmatched_lowfreq_sample: unmatchedLowFreq
  };
  // Build result object (same for dry_run and apply)
  const result = {
    retailer_id: retailerId,
    feed_format: "rakuten_xml",
    match_column_used: config.match_column,
    dry_run: dryRun,
    feed_total_rows: feedRows,
    feed_parse_ms: fetchMs,
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
      would_link_via_ean: countLinkViaEan,
      would_link_via_mpn: countLinkViaMpn,
      would_link_via_name_exact: countLinkViaNameExact,
      would_link_via_name_stripped: countLinkViaNameStripped,
      would_create_new_product: countCreateNew,
      canonical_size_extracted_on_new: v6CanonicalSizeExtracted,
      shade_extracted_on_new: v6ShadeExtracted,
      rows_with_ean: rowsWithEan,
      rows_with_mpn: rowsWithMpn
    },
    v6_top_category_breakdown: v6TopCategoryBreakdown,
    v6_exclusion_breakdown: v6ExclusionBreakdown,
    brand_canonicalisation: brandCanonicalisation,
    sample_v6_excluded: sampleV6Excluded,
    sample_excluded_by_category: sampleExcluded,
    sample_link_to_existing: sampleLinkExisting,
    sample_create_new: sampleCreateNew,
    sample_raw_category_data: sampleRawCategoryData,
    duration_ms_so_far: Date.now() - startTime
  };
  if (dryRun) {
    return new Response(JSON.stringify(result, null, 2), {
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  // ============================ APPLY ============================
  let updatesApplied = 0;
  let linksApplied = 0;
  let createsApplied = 0;
  const errors = [];
  // Chunk size for every bulk RPC / upsert below. A single statement over the
  // whole batch (~21,700 rows for Superdrug) exceeds the Postgres statement
  // timeout and is cancelled, silently dropping the entire batch — that is why
  // Superdrug's daily price writes were landing on only ~100 rows and the rest
  // went stale. Chunking keeps each statement small and well under the timeout.
  // Mirrors import-awin-feed v6.19.
  const INSERT_CHUNK = 500;
  // 1. Updates — chunked price + image backfill RPCs.
  if (updateActions.length > 0) {
    const nowIso = new Date().toISOString();
    for(let i = 0; i < updateActions.length; i += INSERT_CHUNK){
      const chunk = updateActions.slice(i, i + INSERT_CHUNK);
      const payload = chunk.map((u)=>({
          id: u.rp_id,
          price: u.price,
          in_stock: u.in_stock,
          last_updated: nowIso,
          url: u.url || "",
          ean: u.ean || "",
          mpn: u.mpn || ""
        }));
      const { data: rpcResult, error: rpcErr } = await supa.rpc("bulk_update_retailer_prices", {
        updates: payload
      });
      if (rpcErr) {
        errors.push(`bulk_update_retailer_prices (chunk at ${i}): ${rpcErr.message}`);
      } else {
        updatesApplied += typeof rpcResult === "number" ? rpcResult : chunk.length;
      }
    }
    // Image backfill on existing products — chunked (same timeout risk).
    const imageUpdates = updateActions.filter((u)=>u.image_url).map((u)=>({
        product_id: u.product_id,
        image_url: u.image_url
      }));
    for(let i = 0; i < imageUpdates.length; i += INSERT_CHUNK){
      const chunk = imageUpdates.slice(i, i + INSERT_CHUNK);
      const { error: imgErr } = await supa.rpc("bulk_update_product_images", {
        updates: chunk
      });
      if (imgErr) {
        errors.push(`bulk_update_product_images (updates chunk at ${i}): ${imgErr.message}`);
      }
    }
  }
  // 2. Links — dedupe and bulk upsert
  const dedupedLinks = new Map();
  for (const l of linkActions){
    const existing = dedupedLinks.get(l.product_id);
    if (!existing || l.price < existing.price) {
      dedupedLinks.set(l.product_id, l);
    }
  }
  const dedupedLinkArray = Array.from(dedupedLinks.values());
  for(let i = 0; i < dedupedLinkArray.length; i += INSERT_CHUNK){
    const chunk = dedupedLinkArray.slice(i, i + INSERT_CHUNK);
    const rows = chunk.map((l)=>({
        product_id: l.product_id,
        retailer_id: retailerId,
        price: l.price,
        url: l.url,
        in_stock: l.in_stock,
        external_product_id: l.ext_id,
        ean: l.ean || null,
        mpn: l.mpn || null,
        last_updated: new Date().toISOString()
      }));
    const { error } = await supa.from("retailer_prices").upsert(rows, {
      onConflict: "product_id,retailer_id"
    });
    if (error) {
      errors.push(`link batch starting at ${i}: ${error.message}`);
    } else {
      linksApplied += chunk.length;
    }
  }
  // 2b. Image backfill on linked products — chunked (same timeout risk).
  const linkImageUpdates = dedupedLinkArray.filter((l)=>l.image_url).map((l)=>({
      product_id: l.product_id,
      image_url: l.image_url
    }));
  for(let i = 0; i < linkImageUpdates.length; i += INSERT_CHUNK){
    const chunk = linkImageUpdates.slice(i, i + INSERT_CHUNK);
    const { error: linkImgErr } = await supa.rpc("bulk_update_product_images", {
      updates: chunk
    });
    if (linkImgErr) {
      errors.push(`bulk_update_product_images (links chunk at ${i}): ${linkImgErr.message}`);
    }
  }
  // 3. Creates — two-phase bulk insert (v6.16: now writes canonical_size)
  for(let i = 0; i < createActions.length; i += INSERT_CHUNK){
    const chunk = createActions.slice(i, i + INSERT_CHUNK);
    const productRows = chunk.map((c)=>({
        name: c.name,
        brand: c.brand,
        // c.brand is already the canonical brand (lookupCanonicalBrand). Store its
        // lowercased form so brand pages can group by normalised_brand. Mirrors the
        // backfill COALESCE(LOWER(canonical), LOWER(brand)); without this, new
        // products land with NULL normalised_brand and never surface on /brands/*.
        normalised_brand: c.brand ? String(c.brand).toLowerCase().trim() || null : null,
        category: c.product_type,
        product_type: c.product_type,
        top_category: c.top_category,
        subcategory: c.subcategory,
        tags: c.tags,
        canonical_size: c.canonical_size,
        shade: c.shade,
        image_url: c.image_url || null
      }));
    const { data: insertedProducts, error: pErr } = await supa.from("products").insert(productRows).select("id");
    if (pErr || !insertedProducts || insertedProducts.length !== chunk.length) {
      errors.push(`create products batch at ${i}: ${pErr?.message || "row count mismatch"}`);
      continue;
    }
    const priceRows = chunk.map((c, idx)=>({
        product_id: insertedProducts[idx].id,
        retailer_id: retailerId,
        price: c.price,
        url: c.url,
        in_stock: c.in_stock,
        external_product_id: c.ext_id,
        ean: c.ean || null,
        mpn: c.mpn || null,
        last_updated: new Date().toISOString()
      }));
    const { error: rpErr } = await supa.from("retailer_prices").insert(priceRows);
    if (rpErr) {
      errors.push(`create rps batch at ${i}: ${rpErr.message}`);
    } else {
      createsApplied += chunk.length;
    }
  }
  await supa.from("retailer_import_config").update({
    last_imported_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_attempt_at: new Date().toISOString(),
    last_import_status: errors.length > 0 ? "error" : "ok",
    last_import_error: errors.length > 0 ? errors.slice(0, 5).join("; ").slice(0, 1000) : null
  }).eq("retailer_id", retailerId);
  try {
    await supa.from("scrape_log").insert({
      retailer_id: retailerId,
      status: errors.length > 0 ? "partial_failure" : "success",
      products_seen: feedRows,
      products_updated: updatesApplied,
      products_inserted: linksApplied + createsApplied,
      duration_ms: Date.now() - startTime
    });
  } catch  {}
  result.applied = {
    updates_applied: updatesApplied,
    links_applied: linksApplied,
    creates_applied: createsApplied,
    error_count: errors.length,
    sample_errors: errors.slice(0, 10)
  };
  result.duration_ms = Date.now() - startTime;
  return new Response(JSON.stringify(result, null, 2), {
    headers: {
      "Content-Type": "application/json"
    }
  });
});
