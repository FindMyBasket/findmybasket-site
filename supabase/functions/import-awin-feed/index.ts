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
import { inferCategorisationForImport, type TopCategory, type ImportTopCategory } from "../_shared/categorisation.ts";
import { pickDescription } from "../_shared/description.ts";
import { decodeFeedName, normaliseImageUrl } from "../_shared/strip-html.ts";
import {
  normaliseForMatch,
  buildMatchKey,
  normaliseEan,
  normaliseMpn,
  stripSize,
  extractSize,
  extractNameNumbers,
  extractCanonicalSize,
  extractShade,
} from "../_shared/match-key.ts";
import { isMultipackMismatch } from "../_shared/multipack-guard.ts";
// validateBarcode is no longer imported here: it is called only inside extractFeedEan,
// which is now the single derivation point for a feed row's barcode. Importing it again
// at a call site would be the first step back to two implementations.
import { coalesceField, extractFeedEan } from "../_shared/barcode.ts";
import { mergeSliceCounts } from "../_shared/merge-counts.ts";
import { requireServiceRole } from "../_shared/require-service-role.ts";
import { finaliseRun } from "../_shared/run-metrics.ts";
import { reconstructBeautyFlashName, BEAUTY_FLASH_RETAILER_ID } from "./name-reconstruction.ts";
import { cleanDebenhamsName, DEBENHAMS_RETAILER_ID } from "./name-hygiene.ts";

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
    // SIBLING PAIRS. AWIN advertisers populate one half of each pair and leave the
    // other blank, and WHICH half differs per feed. Requesting only one half silently
    // discards data that is present. Measured 3 Aug 2026:
    //   Beauty Flash  ean 0.0%  product_GTIN 96.4%   category_name 100%  product_type 0%
    //   Stylevana     ean 43.9% product_GTIN 0.0%    category_name 0%    product_type 100%
    // Both halves are requested; the row loop prefers the primary and falls back.
    "merchant_product_category_path",
    "merchant_category",
    "category_name",
    "product_type",
    // Path 1 / EAN-first matching: barcode + manufacturer part number.
    //
    // THE ORIGINAL COMMENT HERE READ "Coverage observed: ~99.7% gtin" AND THEN
    // REQUESTED "ean". The measurement was right and the column name beside it was
    // wrong, which cost five retailers their barcodes entirely: Boots, Escentual,
    // Beauty Flash, Gorgeous Shop and The Organic Pharmacy all sat at exactly 0.0%.
    // Requesting both halves is the fix; reading only one is what caused it.
    "ean",
    "product_GTIN",
    "mpn",
    // Image URL - feed includes a merchant-hosted image for the product.
    // Used for catalogue display.
    "merchant_image_url",
    // Description - long form (`description`) preferred, short form as fallback.
    // Used for the "About this product" section + SEO meta/JSON-LD.
    "description",
    "product_short_description",
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
/**
 * Shared name tokens between a feed row's name and the stored product's name.
 *
 * Tokens are alphabetic and at least three characters, so sizes ("50ml"), pack
 * counts and ids can never manufacture an overlap.
 *
 * ADJACENT WORDS ARE ALSO JOINED, because brands are spelled inconsistently across
 * a feed and its catalogue: "ByWishtrend" tokenises to {bywishtrend} and
 * "By Wishtrend" to {by, wishtrend}, which share nothing. Joining pairs makes the
 * two spellings meet WITHOUT loosening the zero threshold. Measured on Stylevana:
 * adding this moved the zero-overlap count 138 -> 137 — one row — and sharpened the
 * mid-range from 44/273/904 to 6/13/20, so it improved the signal's contrast while
 * barely touching its count. Work-list item 84.
 */
function sharedNameTokens(feedName: string, storedName: string): number {
  const toks = (v: string): Set<string> => {
    const words = v.toLowerCase().replace(/[^a-z]+/g, " ").split(" ").filter(Boolean);
    const out = new Set<string>(words.filter((t) => t.length >= 3));
    for (let i = 0; i + 1 < words.length; i++) {
      const j = words[i] + words[i + 1];
      if (j.length >= 6) out.add(j);
    }
    return out;
  };
  const a = toks(feedName);
  const b = toks(storedName);
  // No usable tokens on either side is NOT zero overlap — it is unmeasurable, and
  // returning 0 would report it as a trip. -1 so the caller can tell them apart;
  // the caller tests `=== 0`. Item 84: a guard that excludes is a guard that lies.
  if (a.size === 0 || b.size === 0) return -1;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared;
}

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

// Is this row on one of the retailer's configured supplements paths?
// `retailer_import_config.supplements_path_prefixes`, empty for every retailer
// until deliberately set. Feeds the 4th argument of inferCategorisationForImport.
//
// PREFIX, NOT SUBSTRING — AND DELIBERATELY NOT THE SAME MATCHER AS isPathIncluded
// ABOVE. That one uses case-insensitive `includes`, because it answers "is this row
// anywhere in scope". This answers "is this row ON a specific leaf", and it drives a
// classification OVERRIDE that bypasses the supplement denylist. A substring match
// would let any path merely CONTAINING the leaf text take the override, which is a
// wider blast radius than the column's own comment promises ("path prefixes").
//
// The difference is stated here because a silent mismatch between two path matchers
// in one importer is precisely the class of defect this whole change came out of.
function isOnSupplementsPath(categoryPath: string, prefixes: string[]): boolean {
  if (prefixes.length === 0) return false;
  const haystack = categoryPath.toLowerCase();
  return prefixes.some((p) => haystack.startsWith(p.toLowerCase()));
}

// PART 2 of the retailer-taxonomy subcategory work. Work-list items 125, 126, 140, 142.
//
// Files a row's subcategory from the RETAILER'S OWN taxonomy column
// (`subcategory_source_field`) instead of from our name inference, by longest-prefix
// match against `subcategory_prefix_map`. Both columns are NULL for every retailer, so
// this returns null for every row until one is deliberately configured.
//
// LONGEST PREFIX WINS, and that is the whole reason this is prefix matching and not an
// exact lookup: Boots ships 88 distinct product_type values inside one leaf, 58 of which
// hold 120 rows between them. A deep tail inherits from its mapped parent, so the map
// does not have to enumerate every value and does not break on the next one the retailer
// invents. Exact matching would drop the tail on the floor silently.
//
// A NULL SUBCATEGORY ON A MATCHED ENTRY IS A MEASUREMENT, NOT AN EXCLUSION. Entries like
// `Beauty & Skincare > Makeup` exist to say "this prefix is deliberately out of scope",
// and they are COUNTED AND REPORTED AND NOTHING ELSE. Whether an out-of-scope match should
// remove the row is part 3 and is a separate decision — see item 142. Stated here because
// item 135 trap 2 is exactly this: a mechanism that looks like it does something.
type SubcategoryMapEntry = { prefix: string; subcategory: string | null };
function matchSubcategoryPrefix(
  value: string,
  map: SubcategoryMapEntry[],
): { matched: boolean; subcategory: string | null; prefix?: string } {
  if (map.length === 0 || !value) return { matched: false, subcategory: null };
  const haystack = value.toLowerCase();
  let best: SubcategoryMapEntry | undefined;
  for (const e of map) {
    if (!haystack.startsWith(e.prefix.toLowerCase())) continue;
    if (!best || e.prefix.length > best.prefix.length) best = e;
  }
  if (!best) return { matched: false, subcategory: null };
  return { matched: true, subcategory: best.subcategory ?? null, prefix: best.prefix };
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


// ── match-key normalisation, size/shade extraction, EAN/MPN normalisation ──
// These now live in the shared single-source module _shared/match-key.ts
// (imported above) so the three importers and the dedup backfill cannot drift.

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
  // Accents folded, not deleted. MIRRORS brandSlug() in lib/brand-slug.ts as of
  // 26 Aug 2026 -- see its header. Item 384.
  const FOLD_FROM = "\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u00e7\u00e8\u00e9\u00ea\u00eb\u00ec\u00ed\u00ee\u00ef\u00f1\u00f2\u00f3\u00f4\u00f5\u00f6\u00f9\u00fa\u00fb\u00fc\u00fd\u00ff\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5\u00c7\u00c8\u00c9\u00ca\u00cb\u00cc\u00cd\u00ce\u00cf\u00d1\u00d2\u00d3\u00d4\u00d5\u00d6\u00d9\u00da\u00db\u00dc\u00dd\u0178\u0161\u0160\u017e\u017d\u00f8\u00d8\u00e5\u00c5\u00df\u00f1\u00d1";
  const FOLD_TO   = "aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYYsSzZoOaAsnN";
  let folded = "";
  for (const ch of String(brand || "")) {
    const i = FOLD_FROM.indexOf(ch);
    folded += i === -1 ? ch : FOLD_TO[i];
  }
  return folded
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
    // top_category → route. fragrance/bath_body were previously missing, so
    // imports touching those categories (e.g. Perfume Click, 57% fragrance)
    // never refreshed their category pages. bath_body's route is hyphenated.
    const catRoutes: Record<string, string> = {
      skincare: "/skincare",
      makeup: "/makeup",
      hair: "/hair",
      fragrance: "/fragrance",
      bath_body: "/bath-and-body",
      supplements: "/supplements",
    };
    const paths = [
      ...Array.from(slugs).filter(Boolean).map((s) => `/brands/${s}`),
      ...Array.from(cats).map((c) => catRoutes[c]).filter(Boolean),
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
  // Caller gate. verify_jwt only proves the token is a real project JWT, and
  // the anon key — public, shipped in the browser bundle — satisfies that. Reject
  // anything that is not service-role BEFORE reading the body or touching the DB.
  // Every known caller (pg_cron, the fmb_invoke_import_slice self-chain and its
  // watchdog via vault, GitHub Actions) presents service-role. No CORS preflight
  // to spare here: this function has no browser callers and no OPTIONS handler.
  const denied = requireServiceRole(req);
  if (denied) return denied;

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
  // Feed paths whose rows classify as top_category=supplements. Empty for every
  // retailer until deliberately set, which is what makes the branch unreachable
  // and the deploy inert. Work-list items 71, 72, 91.
  const supplementsPathPrefixes: string[] = Array.isArray(config.supplements_path_prefixes)
    ? config.supplements_path_prefixes
    : [];

  // TWO CONFIG VALUES THAT MUST MOVE TOGETHER, AND NOTHING USED TO SAY SO.
  //
  // category_path_must_contain is applied to every row BEFORE the classifier is
  // reached — the row is `continue`d out of the loop. So a supplements prefix whose
  // path the must-contain filter does not admit describes rows that never survive
  // long enough to be classified. Boots is exactly this case: its must-contain list
  // was chosen for beauty, and its intended supplements leaf is not in it.
  //
  // Setting supplements_path_prefixes ALONE therefore produces no change, no error
  // and no signal — the same output as a correct inert deploy. This makes the
  // combination self-reporting instead: it lands in the response and in the log.
  const supplementsPathUnreachable: string[] = supplementsPathPrefixes.filter(
    (p) => !isPathIncluded(p, categoryPathMustContain).included,
  );
  if (supplementsPathUnreachable.length > 0) {
    console.warn(
      `[config] supplements_path_prefixes has ${supplementsPathUnreachable.length} ` +
      `prefix(es) that category_path_must_contain EXCLUDES, so no row on them can ever ` +
      `reach the classifier. Both values must be set together. Unreachable: ` +
      JSON.stringify(supplementsPathUnreachable),
    );
  }
  // PART 2: the retailer's own taxonomy as the subcategory source. Items 125, 126, 140, 142.
  //
  // A DB CHECK (retailer_subcategory_map_pair) already makes a half-configured retailer
  // impossible, so the pair cannot arrive broken from the table. It is re-checked here
  // anyway because the CHECK constrains the ROW and this code constrains the RUN, and a
  // future caller with a hand-built config object does not go through the table at all.
  const subcategorySourceField: string | null =
    typeof config.subcategory_source_field === "string" && config.subcategory_source_field
      ? config.subcategory_source_field
      : null;
  const subcategoryPrefixMap: SubcategoryMapEntry[] = Array.isArray(config.subcategory_prefix_map)
    ? (config.subcategory_prefix_map as SubcategoryMapEntry[]).filter(
        (e) => e && typeof e.prefix === "string" && e.prefix.length > 0,
      )
    : [];
  // Item 91's rule: EITHER ALONE IS A SILENT NO-OP, so say so rather than behaving like a
  // correct inert deploy. A source field with no map classifies nothing; a map with no
  // source field has nothing to read.
  const subcategoryMapHalfSet =
    (subcategorySourceField !== null) !== (subcategoryPrefixMap.length > 0);
  if (subcategoryMapHalfSet) {
    console.warn(
      `[config] subcategory_source_field and subcategory_prefix_map must be set TOGETHER. ` +
      `source_field=${JSON.stringify(subcategorySourceField)}, ` +
      `map_entries=${subcategoryPrefixMap.length}. Feature OFF for this run.`,
    );
  }
  const subcategoryMapEnabled =
    !subcategoryMapHalfSet && subcategorySourceField !== null && subcategoryPrefixMap.length > 0;
  // Resolved against the feed's header row once it is parsed, below. -1 until then, and
  // -1 also means "configured column is not in this feed", which turns the feature OFF
  // rather than falling back to name inference silently. FAILING CLOSED IS THE POINT:
  // the column's own comment says this MUST NOT be satisfied by a name rule, because a
  // fallback would reintroduce the inference this replaces and nothing would say so.
  let subcategorySourceIdx = -1;
  let countSubcategoryFromMap = 0;      // matched, mapped to a real subcategory
  let countSubcategoryMapOutOfScope = 0; // matched a deliberately-null entry (MEASUREMENT ONLY)
  let countSubcategoryMapUnmatched = 0;  // value present, no prefix matched
  let countSubcategoryMapSourceEmpty = 0; // source column blank on this row
  const subcategoryMapBreakdown: Record<string, number> = {};

  // REASSIGNMENT DETECTOR, count-log-and-write. Opt-in per retailer, default off.
  // A merchant that reassigns an external_product_id from one product to another
  // silently repoints tier 0: the row keeps its product_id and its (COALESCEd)
  // barcode while url, image and description follow the NEW product. Commit
  // a43e2ed is the worked example — an Isntree sunscreen became a Euthymol
  // toothbrush set. Work-list item 84.
  const reassignmentDetect: boolean = config.reassignment_detect === true;
  // Skip rows whose deeplink advertises a multipack while the product name
  // describes a single item — the price would misrepresent the product. Opt-in
  // per retailer: only merchants that actually sell "buy two" under the single
  // item's name need it. See _shared/multipack-guard.ts.
  const multipackGuard: boolean = config.multipack_deeplink_guard === true;
  let countSkippedMultipack = 0;
  let countMultipackUnresolved = 0;
  const sampleSkippedMultipack: Array<{ feed_name: string; matched_product_id: number; matched_name: string; url: string }> = [];
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

  // max_rows: SAMPLE THE FEED ON A DRY RUN SO LARGE FEEDS CAN BE INSPECTED AT ALL.
  //
  // A dry run is never sliced -- cross-slice state relies on each slice committing --
  // so dry_run:true pushes the whole feed through one worker. Niche Beauty at 14,636
  // rows returned WORKER_RESOURCE_LIMIT, and so does Gorgeous Shop at ~8k, with or
  // without streaming.
  //
  // THE CONSEQUENCE IS NOT "SOME DRY RUNS FAIL". It is that dry_run only works for
  // SMALL retailers, and the feeds most worth inspecting before a change are the large
  // ones. The Organic Pharmacy at 110 rows dry-runs fine and tells you almost nothing.
  // A capability that cannot reach the cases it exists for is not a partial capability.
  //
  // STRIDE, NOT HEAD. Taking the first N rows of an alphabetically-ordered feed measures
  // one letter -- one brand block, one price band, one barcode prefix. This keeps every
  // Nth row instead, which is deterministic, needs no buffering, and spans the whole
  // feed. Item 425.
  const MAX_ROWS: number = (typeof body.max_rows === "number" && body.max_rows > 0)
    ? Math.floor(body.max_rows) : 0;                 // 0 = no cap
  // A streaming source cannot report its length before it is consumed, so the stride is
  // GIVEN rather than derived. Default 4: an ~8k feed yields ~2k rows spanning all of
  // it. If the ceiling is reached before the feed ends the tail is unsampled, and
  // `rows_seen` versus the feed's real size makes that visible in the result.
  const SAMPLE_STRIDE: number = (typeof body.sample_stride === "number" && body.sample_stride >= 1)
    ? Math.floor(body.sample_stride) : 4;
  let sampleSeen = 0;
  let sampleKept = 0;
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
  type StrippedEntry = { id: number; size: string; numbers: string };
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
  // Names of the products this chunk could match, so the multipack guard can
  // test the MATCHED product rather than the feed's own name (see
  // _shared/multipack-guard.ts — the feed name is not a valid proxy).
  const productNameById = new Map<number, string>();
  const loadedBrands = new Set<string>();

  // Persistent (whole-import) accumulator — survives chunk boundaries, bounded by
  // links+creates (small). Holds the in-feed mutations that used to live on the
  // global maps (§2/§4A of the plan).
  const seenEanToProductId = new Map<string, number>(); // EAN learned via a link this run
  const seenMpnToProductId = new Map<string, number>(); // MPN learned via a link this run
  const createdUrls = new Set<string>();                // URLs created this run (Tier 5 shade-variant suppression; replaces the old urlToProductId -1 sentinel)
  const createdByMatchKey = new Map<string, number>();  // 4A-i: match key → -1 (pending); suppresses duplicate creates only, never links

  // TIER-1 AMBIGUITY. A barcode that maps to more than one catalogue product cannot be
  // linked safely: the old map-build took whichever row the RPC returned first, which is
  // an arbitrary choice made silently on every ambiguous barcode.
  //
  // Measured before this change: 22 of Niche Beauty's 537 barcode matches have more than
  // one candidate. Inspected by name, 20 are pre-existing catalogue duplicate pairs and 2
  // are plainly WRONG barcodes — a Beauty of Joseon sheet mask sharing an EAN with a Shu
  // Uemura shampoo, and a Coco & Eve conditioner sharing one with their detox shampoo.
  // Linking either way on those two is wrong, and no ranking rule fixes a bad barcode.
  //
  // So: SKIP, and record. Skipping is recoverable — the row still matches on mpn or name
  // and the barcode stays available once the duplicates are merged. Linking is not: it
  // attaches a price to a product nobody chose.
  //
  // The record is the point. A silent skip and a silent wrong link are equally invisible;
  // this makes the ambiguity a queryable list with both product ids, so it becomes merge
  // queue input or a barcode denylist rather than a decision nobody sees.
  const tier1Skips = new Map<string, number[]>();  // ean → candidate product ids
  const tier2Skips = new Map<string, number[]>();  // mpn → candidate product ids

  // PLACEHOLDER MPNs ARE NOT IDENTIFIERS, AND THIS IS NOT NORMALISATION.
  //
  // Deliberately NOT in normaliseMpn(): that function is byte-paired with the
  // `mpn_normalised` generated column, and changing one without the other silently
  // decouples what the importer matches on from what the database stores. "Is this an
  // identifier at all" is a MATCHING POLICY, so it lives beside the tier logic.
  //
  // THE PRECEDENT IS IN THE SCHEMA ALREADY. `ean_normalised` is generated as
  // NULLIF(CASE WHEN length(digits stripped of leading zeros) >= 8 THEN ... ELSE '' END)
  // -- a barcode too short to be a barcode becomes NULL and never matches. `mpn`
  // received no equivalent, so "0" survives as a key. This restores the symmetry at the
  // point of use rather than in the shared normaliser. Work-list item 424.
  const MPN_PLACEHOLDERS = new Set([
    "0", "00", "000", "0000", "00000", "000000",
    "N/A", "NA", "N.A.", "NONE", "NULL", "NIL", "-", "--", ".", "X", "XX",
    "TBC", "TBA", "UNKNOWN", "NOMPN", "NO MPN", "DEFAULT", "TEST",
  ]);
  const isPlaceholderMpn = (m: string): boolean =>
    MPN_PLACEHOLDERS.has(m) || /^0+$/.test(m);

  // existing_brands_only needs just the distinct set of match_brand keys. The
  // big feeds that actually OOM have existing_brands_only=false, so they SKIP this
  // entirely; only the (smaller, not memory-bound) restricted retailers pay the
  // distinct-brand pagination. (Follow-up: replace with an RPC if a large
  // existing_brands_only retailer ever makes this slow.)
  //
  // MODE GUARD: the brand filter runs ONLY in the apply path (process/single).
  // stage (Phase-A ungzip) and split (byte-range slicing) never read this set, so
  // building the ~96k-row set during them just wastes memory in the exact phase
  // that intermittently 546s on YesStyle. Build it only where it's used.
  const existingBrandSet = new Set<string>();
  if (existingBrandsOnly && (effectiveMode === "process" || effectiveMode === "single")) {
    let bfrom = 0;
    while (true) {
      const { data, error } = await supa
        .from("products")
        .select("match_brand")
        .neq("match_brand", "")
        .order("match_brand", { ascending: true })
        .range(bfrom, bfrom + 999);
      if (error) {
        await recordImportStatus(supa, retailerId, "error", `DB read failed (distinct brands): ${error.message ?? error}`);
        return new Response(JSON.stringify({ error: "DB read failed (distinct brands)", details: error }), { status: 500 });
      }
      if (!data || data.length === 0) break;
      for (const r of data) {
        // match_brand is fmb_match_brand(brand): lower + non-alnum→space + trim,
        // already punctuation/accent-folded. Compared against normaliseForMatch(brand)
        // on the feed side (exact parity) so casing/punctuation variants of a brand
        // we carry (rom&nd vs "romand" needs an alias; Lord&Berry vs "Lord & Berry"
        // matches here) are no longer silently dropped by existing_brands_only.
        const b = String(r.match_brand || "");
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
      // TIER-1 KEY PARITY. This MUST derive the barcode exactly as the row loop does,
      // or the prefetch asks the database about values the lookup never uses and tier 1
      // cannot match. It previously read `fields[idx.ean]` alone while the row loop read
      // the coalesced+validated value — see extractFeedEan's comment. Both sites now call
      // the one function; do not inline either of them again.
      const e = normaliseEan(extractFeedEan(f, idx.ean, idx.ean_alt, coalesceOn).value);
      if (e) eans.add(e);
      // PLACEHOLDERS ARE REFUSED HERE, BEFORE THE PREFETCH, NOT AFTER IT (item 425).
      //
      // The Tier-2 guard originally filtered the RESULT of this lookup, which is too
      // late to matter: "0" was still sent to the database and still came back as 561
      // products with their names, all materialised into the chunk map. That is the
      // suspected reason Gorgeous Shop and Beauty Flash cannot dry-run at 3,000 rows
      // while Beauty Bay can -- one placeholder value dragging a 561-row candidate set
      // into memory on every chunk.
      //
      // Refusing it at collection means the query is never asked. The ambiguity guard
      // still runs on what does come back, for the values that are genuine but shared.
      if (idx.mpn >= 0) {
        const m = normaliseMpn((f[idx.mpn] || "").trim());
        if (m) {
          if (isPlaceholderMpn(m)) {
            // STILL RECORDED, though never queried. Refusing it at collection means the
            // candidate set is never fetched, so `candidate_product_ids` is empty here --
            // an empty array on a 'placeholder' row means "not asked", not "no matches".
            if (!tier2Skips.has(m)) tier2Skips.set(m, []);
          } else {
            mpns.add(m);
          }
        }
      }
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
      if (!productNameById.has(p.id)) productNameById.set(p.id, p.name || "");
      const strippedKey = stripSize(exactKey);
      if (strippedKey && !productByStripped.has(strippedKey)) {
        productByStripped.set(strippedKey, { id: p.id, size: extractSize(exactKey), numbers: extractNameNumbers(p.name) });
      }
    }
    // Each of these projections also carries the matched product's name (see
    // migration 20260720200000). The multipack guard needs it: a row matched on
    // EAN/MPN/ext_id never touches the `products` set, so without this its
    // matched name is unknown and the guard cannot evaluate.
    const rememberName = (id: unknown, nm: unknown) => {
      const pid = typeof id === "number" ? id : Number(id);
      if (Number.isFinite(pid) && typeof nm === "string" && nm && !productNameById.has(pid)) {
        productNameById.set(pid, nm);
      }
    };
    // Group by ean BEFORE deciding. The RPC returns one row per (ean, product_id), so
    // first-wins here silently resolved ambiguity by result order. Collect the full
    // candidate set per barcode, then admit only the unambiguous ones.
    const eanCandidates = new Map<string, Set<number>>();
    for (const r of (sets?.eans ?? [])) {
      const k = String(r.ean || "").trim();
      if (k && r.product_id != null) {
        let s = eanCandidates.get(k);
        if (!s) { s = new Set<number>(); eanCandidates.set(k, s); }
        s.add(Number(r.product_id));
      }
      rememberName(r.product_id, r.name);
    }
    for (const [k, ids] of eanCandidates) {
      if (ids.size === 1) {
        // Unambiguous: exactly one catalogue product carries this barcode.
        if (!eanToProductId.has(k)) eanToProductId.set(k, [...ids][0]);
      } else if (!tier1Skips.has(k)) {
        // Ambiguous: do not link, and record every candidate so the decision is
        // inspectable. Deduped across chunks — a barcode skipped twice is one finding.
        tier1Skips.set(k, [...ids].sort((a, b) => a - b));
      }
    }
    // TIER 2 AMBIGUITY GUARD, MIRRORING TIER 1 (item 424).
    //
    // This was first-wins over a query ordered by mpn with no tiebreak, so an MPN
    // carried by many products resolved to whichever the database returned first.
    // Measured: 1,514 MPN values map to more than one product, 323 of them span
    // retailers, and "0" alone maps to 561 products across 1,046 rows.
    const mpnCandidates = new Map<string, Set<number>>();
    for (const r of (sets?.mpns ?? [])) {
      const k = String(r.mpn || "").trim();
      if (k && r.product_id != null) {
        let set = mpnCandidates.get(k);
        if (!set) { set = new Set<number>(); mpnCandidates.set(k, set); }
        set.add(Number(r.product_id));
      }
      rememberName(r.product_id, r.name);
    }
    for (const [k, ids] of mpnCandidates) {
      if (isPlaceholderMpn(k)) {
        if (!tier2Skips.has(k)) tier2Skips.set(k, [...ids].sort((a, b) => a - b));
        continue;
      }
      if (ids.size === 1) {
        if (!mpnToProductId.has(k)) mpnToProductId.set(k, [...ids][0]);
      } else if (!tier2Skips.has(k)) {
        tier2Skips.set(k, [...ids].sort((a, b) => a - b));
      }
    }
    for (const r of (sets?.extids ?? [])) {
      if (r.external_product_id) existingByExtId.set(r.external_product_id, r);
      rememberName(r.product_id, r.name);
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
  // A DRY RUN STREAMS WHETHER OR NOT THE RETAILER IS CONFIGURED TO (item 425).
  //
  // The legacy path inflates the whole gzip into memory before a single row is parsed.
  // That is why dry_run:true returned WORKER_RESOURCE_LIMIT on Gorgeous Shop (~8k rows)
  // and Beauty Flash, while Beauty Bay -- the only one of the three with
  // config.streaming_enabled = true -- completed in three seconds.
  //
  // MAX_ROWS DID NOT FIX THIS AND COULD NOT. It bounds what the MATCHER consumes, and
  // the worker was dying in the INFLATE, one layer below. A parameter added at the wrong
  // layer looks like the fix and reaches nothing: it made Beauty Bay's run cheaper and
  // left the two feeds it was added for exactly as unreachable as before.
  //
  // Forced for dry runs only, so no real import's I/O path changes. `config.streaming_enabled`
  // still governs applies, and body.force_legacy_stream:true restores the old path for
  // parity testing.
  const streamingActive = effectiveMode !== "process"
    && (streamingEnabled || (dryRun && body.force_legacy_stream !== true))
    && !feedUrl.startsWith("storage://");

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
    category_path_alt: number;
    category_name: number;
    category_name_alt: number;
    ean: number;
    ean_alt: number;
    mpn: number;
    image_url: number;
    description: number;
    short_description: number;
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
      category_path_alt: -1,
      category_name: columns.indexOf("product_type"),
      category_name_alt: -1,
      // Already reads gtin correctly, which is why the two google_shopping retailers
      // have ~99% barcode coverage while five awin ones had none. Left untouched.
      ean: columns.indexOf("gtin"),
      ean_alt: -1,
      mpn: columns.indexOf("mpn"),
      image_url: columns.indexOf("image_link"),
      description: columns.indexOf("description"),
      short_description: -1,
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
      category_path_alt: columns.indexOf("merchant_category"),
      category_name: columns.indexOf("category_name"),
      category_name_alt: columns.indexOf("product_type"),
      ean: columns.indexOf("ean"),
      ean_alt: columns.indexOf("product_GTIN"),
      mpn: columns.indexOf("mpn"),
      image_url: columns.indexOf("merchant_image_url"),
      description: columns.indexOf("description"),
      short_description: columns.indexOf("product_short_description"),
      sale_price: -1,
      availability: -1,
    };
  }

  // PART 2: resolve the configured taxonomy column against THIS feed's header row.
  //
  // BY NAME, DIRECTLY, AND NEVER THROUGH coalesceField. Item 142: product_type is already
  // wired as `category_name_alt`, i.e. the fallback for `category_name` — and on Boots
  // category_name is 100% filled with the single constant "Health", so that fallback is
  // unreachable by construction. coalesceField ranks by PRESENCE, not by INFORMATION.
  // Routing this through it would reproduce the shadowing and produce a clean zero.
  if (subcategoryMapEnabled && subcategorySourceField) {
    subcategorySourceIdx = columns.indexOf(subcategorySourceField);
    if (subcategorySourceIdx === -1) {
      console.warn(
        `[config] subcategory_source_field ${JSON.stringify(subcategorySourceField)} is NOT ` +
        `a column in this feed. Columns: ${JSON.stringify(columns)}. Subcategory mapping ` +
        `OFF for this run — deliberately NOT falling back to name inference.`,
      );
    }
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
  let countReassignmentSuspect = 0;
  const sampleReassignmentSuspect: any[] = [];
  let countSizeMismatchRejected = 0;
  // Pattern E: Beauty Flash truncated-name reconstructions (retailer 27 only).
  let countBeautyFlashRebuilt = 0;
  const sampleBeautyFlashRebuilt: Array<{ truncated: string; rebuilt: string }> = [];
  // Debenhams (retailer 28 only): name-hygiene rewrites — gender + "| Size:" +
  // " in {variant}" attribute stripped out of product_name.
  let countDebenhamsCleaned = 0;
  let countDebenhamsShadeRouted = 0;
  const sampleDebenhamsCleaned: Array<{ raw: string; cleaned: string; shade: string | null }> = [];
  // v6 counters
  let countV6Excluded = 0;
  // Rows matched by supplements_path_prefixes. Zero for every retailer with an
  // empty prefix list; the FIRST thing to read on the activation cycle, because a
  // zero here is the signature of an unwired feature as much as an inactive one.
  let countOnSupplementsPath = 0;
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

  // ── WHAT THIS REWRITES IS WHAT A MANUAL CORRECTION CANNOT SURVIVE ──────────────
  // Read this before hand-correcting anything on an existing row. The two halves have
  // OPPOSITE properties and neither is obvious from the other:
  //
  //   REWRITTEN EVERY IMPORT, from the feed:  price, url, in_stock, EAN, MPN, image_url
  //   NEVER TOUCHED after create:             products.name, brand, tags, top_category,
  //                                           subcategory, product_type
  //
  // So a NAME correction HOLDS -- products is written only on INSERT (see the creates
  // block below) -- and is the same creates-only property that makes product_exclusions
  // durable. A BARCODE correction DOES NOT: both retailers supplying a wrong EAN will
  // restore it on their next run, so correcting it locally is futile rather than merely
  // fragile. Measured on product 96761, 21 Aug 2026, where the barcode is confirmed wrong
  // and the name was corrected: the name fix stands, an EAN fix would not have.
  //
  // There is NO barcode denylist. tier1_ean_skips records ambiguity but suppresses
  // nothing. Until one exists, a wrong feed-supplied barcode can only be worked around
  // downstream, never corrected here.
  //
  // ONE CAVEAT ON THE NAME SIDE: match_key is derived from the name AT IMPORT and does
  // not follow a manual name change, so a corrected name and its match_key disagree
  // until the row is re-imported or the key recomputed. Harmless for display, relevant
  // to matching.
  const updateActions: Array<{ rp_id: number; product_id: number; price: number; url: string; in_stock: boolean; ean: string; mpn: string; image_url: string }> = [];
  const linkActions: Array<{ product_id: number; ext_id: string; price: number; url: string; in_stock: boolean; ean: string; mpn: string; image_url: string }> = [];
  // v6.16: createActions now carries canonical_size + image_url
  const createActions: Array<{
    ext_id: string;
    name: string;
    brand: string;
    category: string;
    product_type: string;
    top_category: ImportTopCategory;
    subcategory: string;
    tags: string[];
    canonical_size: string | null;
    shade: string | null;
    match_key: string;
    price: number;
    url: string;
    in_stock: boolean;
    ean: string;
    mpn: string;
    image_url: string;
    description: string;
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

  // Descriptions are buffered and flushed on their OWN small batches, decoupled
  // from the price-action FLUSH_THRESHOLD. Holding multi-KB description text in
  // the large update/link arrays until the 1,000-action threshold was the v119
  // inline-path memory regression (#36); this keeps at most DESC_FLUSH
  // descriptions resident at once. Creates still carry their description inline
  // because it goes in the products INSERT row.
  const DESC_FLUSH = 150;
  const descBuffer: Array<{ product_id: number; description: string }> = [];
  async function flushDescriptions(): Promise<void> {
    if (descBuffer.length === 0) return;
    if (dryRun) { descBuffer.length = 0; return; }
    const batch = descBuffer.splice(0, descBuffer.length);
    for (let i = 0; i < batch.length; i += DESC_FLUSH) {
      const chunk = batch.slice(i, i + DESC_FLUSH).map(d => ({
        product_id: d.product_id, description: d.description, source_retailer_id: retailerId,
      }));
      const { error: descErr } = await supa.rpc("bulk_update_product_descriptions", { updates: chunk });
      if (descErr) errors.push(`bulk_update_product_descriptions (batch at ${i}): ${descErr.message}`);
    }
  }

  // Chunk size for every bulk RPC / upsert. A single statement over a whole large
  // batch exceeds the Postgres statement timeout and is silently cancelled
  // (v6.18 monitoring surfaced this). Chunking keeps each statement small.
  const INSERT_CHUNK = 500;
  // Image UPDATEs are PK-keyed and, via service_role, ran past the 8s
  // statement_timeout under DB I/O pressure (reliably reproduced under
  // multi-slice). A smaller chunk keeps each statement well under the cap.
  // Scoped to bulk_update_product_images only — price/insert/link flushes stay
  // at INSERT_CHUNK to avoid extra round-trips.
  const IMAGE_UPDATE_CHUNK = 150;

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
      for (let i = 0; i < imageUpdates.length; i += IMAGE_UPDATE_CHUNK) {
        const chunk = imageUpdates.slice(i, i + IMAGE_UPDATE_CHUNK);
        const { error: imgErr } = await supa.rpc("bulk_update_product_images", { updates: chunk });
        if (imgErr) errors.push(`bulk_update_product_images (updates chunk at ${i}): ${imgErr.message}`);
      }
      // Descriptions are applied separately via flushDescriptions() (#36) — not
      // batched here, so the description text never rides in updateActions.
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
      for (let i = 0; i < linkImageUpdates.length; i += IMAGE_UPDATE_CHUNK) {
        const chunk = linkImageUpdates.slice(i, i + IMAGE_UPDATE_CHUNK);
        const { error: linkImgErr } = await supa.rpc("bulk_update_product_images", { updates: chunk });
        if (linkImgErr) errors.push(`bulk_update_product_images (links chunk at ${i}): ${linkImgErr.message}`);
      }
      // Descriptions applied separately via flushDescriptions() (#36).
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
        shade: c.shade, match_key: c.match_key, image_url: c.image_url || null,
        description: c.description || null,
        description_source_retailer_id: c.description ? retailerId : null,
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
  // PER-RETAILER OPT-IN. Sibling coalesce is off by default and enabled one retailer
  // at a time via retailer_import_config.sibling_coalesce. This changes what matches on
  // the next import, so it is staged smallest-first: The Organic Pharmacy at 114 rows,
  // Boots at 35,912 last. A retailer with the flag off takes byte-identical paths to
  // before this change.
  // DRY-RUN-ONLY OVERRIDE. Without this, testing the coalesce would require enabling
  // the very flag under test, and the next scheduled import would then apply it before
  // anyone had read the dry run. `coalesce_override` is honoured ONLY when dry_run is
  // true, so it can never cause a write. Six gates, six reports, and the flag flips
  // after the report rather than before it.
  const coalesceOverride = dryRun && body.coalesce_override === true;
  const coalesceOn = coalesceOverride || config.sibling_coalesce === true;
  const coalesceStats: {
    ean_from_alt: number; category_path_from_alt: number; category_name_from_alt: number;
    barcode_rejected: number; barcode_reject_reasons: Record<string, number>;
    barcode_reject_samples: Array<{ raw: string; reason: string }>;
  } = {
    ean_from_alt: 0, category_path_from_alt: 0, category_name_from_alt: 0,
    barcode_rejected: 0, barcode_reject_reasons: {}, barcode_reject_samples: [],
  };

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

    // DECODED FIRST, ahead of the Debenhams hygiene below and everything after it, for
    // the same reason that hygiene runs early: excludes, match_key and categorisation
    // must all see one clean name. Item 284.
    let name = decodeFeedName(fields[idx.product_name]);
    // Debenhams (retailer 28) only: the AWIN feed's product_name field ships
    // pre-polluted with gender tags ("Men's"/"Mens"), a trailing " in {variant}"
    // colour/shade attribute, and a " | Size:" clause. This is a feed defect, not
    // an importer one, so hygiene is gated to this retailer rather than applied
    // feed-wide. Strip the junk out of the name BEFORE excludes / match_key /
    // categorisation so downstream sees a clean base name, and route the attribute
    // values to their proper columns (size -> canonical_size, real makeup shade ->
    // products.shade). No-op for any name without the pattern.
    let debenhamsSizeClause: string | null = null;
    let debenhamsShade: string | null = null;
    if (retailerId === DEBENHAMS_RETAILER_ID) {
      const hy = cleanDebenhamsName(name);
      debenhamsSizeClause = hy.sizeClause;
      debenhamsShade = hy.shade;
      if (hy.changed) {
        countDebenhamsCleaned++;
        if (hy.shade) countDebenhamsShadeRouted++;
        if (sampleDebenhamsCleaned.length < 50) {
          sampleDebenhamsCleaned.push({ raw: name, cleaned: hy.name, shade: hy.shade });
        }
        name = hy.name;
      }
    }
    // Pattern E: Beauty Flash (retailer 27) truncates product_name at ~64 chars,
    // breaking match_key generation → silent duplicates. The full name lives in
    // the merchant URL slug; reconstruct it BEFORE excludes / match_key /
    // categorisation so every downstream step sees the un-truncated name.
    // No-op (returns the original) for any name the slug doesn't confirm.
    if (retailerId === BEAUTY_FLASH_RETAILER_ID) {
      const rebuilt = reconstructBeautyFlashName(name, fields[idx.merchant_deep_link] || "");
      if (rebuilt !== name) {
        countBeautyFlashRebuilt++;
        if (sampleBeautyFlashRebuilt.length < 50) {
          sampleBeautyFlashRebuilt.push({ truncated: name, rebuilt });
        }
        name = rebuilt;
      }
    }
    const rawBrand = fields[idx.brand_name] || "";
    const brand = lookupCanonicalBrand(rawBrand);   // canonical from here down
    if (rawBrand) {
      if (brand !== rawBrand) countBrandCanonicalised++;
      else if (!brandAliasMap.has(rawBrand.toLowerCase().trim()))
        unmatchedBrandCounts.set(rawBrand, (unmatchedBrandCounts.get(rawBrand) ?? 0) + 1);
    }
    // Sibling coalesce, gated per retailer. Primary first, sibling only when empty.
    const catPathC = coalesceOn
      ? coalesceField(fields, idx.category_path, idx.category_path_alt)
      : { value: fields[idx.category_path] || "", usedAlt: false };
    const catNameC = coalesceOn
      ? coalesceField(fields, idx.category_name, idx.category_name_alt)
      : { value: fields[idx.category_name] || "", usedAlt: false };
    const categoryPath = catPathC.value;
    const categoryName = catNameC.value;
    if (catPathC.usedAlt) coalesceStats.category_path_from_alt++;
    if (catNameC.usedAlt) coalesceStats.category_name_from_alt++;

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
    // BARCODE. Coalesce then validate. Validation runs ONLY on the coalesced path so
    // that a retailer with coalesce off is byte-identical to before this change.
    // Derived through the SAME function as the tier-1 prefetch (loadChunkMaps). The
    // counters below are this site's job, not the helper's — the prefetch calls it too
    // and must not inflate them.
    const eanEx = extractFeedEan(fields, idx.ean, idx.ean_alt, coalesceOn);
    if (coalesceOn) {
      if (eanEx.usedAlt) coalesceStats.ean_from_alt++;
      if (eanEx.rejectReason) {
        coalesceStats.barcode_rejected++;
        coalesceStats.barcode_reject_reasons[eanEx.rejectReason] =
          (coalesceStats.barcode_reject_reasons[eanEx.rejectReason] || 0) + 1;
        if (coalesceStats.barcode_reject_samples.length < 10) {
          const rawForSample = coalesceField(fields, idx.ean, idx.ean_alt).value;
          coalesceStats.barcode_reject_samples.push({ raw: rawForSample.slice(0, 20), reason: eanEx.rejectReason });
        }
      }
    }
    const rawEan: string = eanEx.value;
    const rawMpn = idx.mpn >= 0 ? (fields[idx.mpn] || "").trim() : "";
    const normEan = normaliseEan(rawEan);
    const normMpn = normaliseMpn(rawMpn);
    // DENOMINATOR, STATED. rowsWithEan counts rows that REACH THE DECISION TREE with a
    // valid barcode. The decision tree below still drops some of them: duplicate
    // suppression, shade variants, size-mismatch rejection and the creates cap all
    // `continue` after this point. So rowsWithEan is ALWAYS >= the number of stored
    // rows carrying a barcode, and the two are different questions:
    //
    //   rowsWithEan  "how many feed rows offer us a usable barcode"   (feed quality)
    //   stored eans  "how many rows in retailer_prices carry one"     (catalogue state)
    //
    // Measured on stage 1, 4 Aug 2026: 78 here, 70 stored, 108 product_GTIN values in
    // the raw feed. THREE denominators, and none of them is wrong. Quote the one you
    // mean. The placement is deliberately NOT changed: it is a feed-quality metric and
    // moving it would silently redefine a scrape_log series that already has history.
    if (normEan) rowsWithEan++;
    if (normMpn) rowsWithMpn++;

    // Image URL - feed-provided product image. Used for catalogue display.
    // https, always -- see normaliseImageUrl. Item 296.
    const imageUrl = idx.image_url >= 0 ? normaliseImageUrl(fields[idx.image_url]) : "";

    // Description - prefer long form, fall back to short. Cleaned (HTML stripped,
    // entities decoded), capped, and nulled if empty / identical to the name.
    const rawLongDesc = idx.description >= 0 ? (fields[idx.description] || "") : "";
    const rawShortDesc = idx.short_description >= 0 ? (fields[idx.short_description] || "") : "";
    const description = pickDescription(rawLongDesc, rawShortDesc, name) || "";

    // Decision tree (tiered).
   const existing = existingByExtId.get(matchValue);
    if (existing) {
      countUpdate++;
      if (isOrdinary) ordinaryDiagnostic.matched_existing++;

      // REASSIGNMENT DETECTOR — COUNT, LOG, AND STILL WRITE. Deliberately does not
      // skip the write. A count-only mode that skipped would already be acting, so
      // there would be no untouched period to measure the rate against and the
      // per-retailer rate this exists to establish would be unobtainable. One
      // bounded cycle of continued corruption on rows already corrupted buys a
      // clean baseline. Work-list item 84.
      //
      // PRIMARY SIGNAL ONLY: feed name against the stored product's name, zero
      // token overlap. The URL-slug confirmatory signal was designed and DROPPED —
      // it needs a slug parser per retailer, maintained against URL formats that
      // change silently, whose only failure signal is the detector going quiet.
      //
      // THE THRESHOLD IS ZERO BECAUSE THE DATA IS EMPTY THERE, not because zero
      // seemed right. Measured on Stylevana's live feed: 137 rows at zero shared
      // tokens, then 19, 6, 13, 20 — a valley — then 7,485 at nine or more. A
      // monotonic fall would have meant naming drift with reassignments buried in
      // its tail and no principled cut anywhere.
      //
      // NOT SWITCHED ON FOR BOOTS, and that is the scope's reason rather than a
      // caveat. Boots inverts the distribution: 1 at zero, then 7, 46, 56 — it
      // RISES out of zero, so there is no gap to cut at and the threshold has no
      // evidence there. Rates: Stylevana 1.56%, Beauty Flash 0.16%, Escentual
      // 0.04%, Boots 0.004%. That spread is not one defect with varying incidence;
      // it is a Stylevana behaviour, consistent with a merchant reassigning
      // merchant_product_id.
      if (reassignmentDetect) {
        const storedName = productNameById.get(existing.product_id);
        if (storedName) {
          const shared = sharedNameTokens(name, storedName);
          if (shared === 0) {
            countReassignmentSuspect++;
            if (sampleReassignmentSuspect.length < 200) {
              sampleReassignmentSuspect.push({
                rp_id: existing.id,
                product_id: existing.product_id,
                external_product_id: matchValue,
                feed_name: name,
                stored_name: storedName,
                feed_url: rawMerchantUrl || wrappedUrl,
                feed_image: imageUrl,
                stored_ean: rawEan || null,
                price,
              });
            }
          }
        }
      }

      updateActions.push({ rp_id: existing.id, product_id: existing.product_id, price, url: wrappedUrl, in_stock: inStock, ean: rawEan, mpn: rawMpn, image_url: imageUrl });
      if (description) { descBuffer.push({ product_id: existing.product_id, description }); if (descBuffer.length >= DESC_FLUSH) await flushDescriptions(); }
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
    if (!matchedProductId && normMpn && !isPlaceholderMpn(normMpn) && mpnToProductId.has(normMpn)) {
      matchedProductId = mpnToProductId.get(normMpn);
      matchedVia = "mpn";
      countLinkViaMpn++; if (isOrdinary) ordinaryDiagnostic.linked_via_mpn++;
    }

    const productMatchKey = buildMatchKey(brand, name);
    const strippedMatchKey = stripSize(productMatchKey);
    const sourceSize = extractSize(productMatchKey);
    // Hard distinctness backstop: the full set of numbers in the raw name must
    // also match. Guards the bare-count cases stripSize/extractSize miss ("40S"
    // vs "20S", counts embedded mid-name) so different packs/sizes never merge
    // via the fuzzy stripped tier.
    const sourceNumbers = extractNameNumbers(name);

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
        if (sourceSize === candidate.size && sourceNumbers === candidate.numbers) {
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
    // Multipack guard, MATCHED branch. Compared against the matched product's
    // name, which is the actual determinant: the feed's own name is not a valid
    // proxy because the Tier-4 stripped matcher strips past the multiplier and
    // lands a "Duo" feed row on a single product. Falls back to the feed name
    // only if the chunk map somehow lacks the id, which would otherwise silently
    // disable the guard.
    if (multipackGuard && matchedProductId) {
      // NO fallback to the feed's name. Falling back to it is the proxy bug this
      // guard exists to eliminate, and it silently reopened the hole once
      // already. If the matched product's name cannot be resolved, DECLINE to
      // suppress: a missed suppression is recoverable, a wrongly-dropped row is
      // an invisible gap in the comparison.
      const matchedName = productNameById.get(matchedProductId);
      if (matchedName === undefined) countMultipackUnresolved++;
      if (matchedName !== undefined && isMultipackMismatch(rawMerchantUrl || wrappedUrl, matchedName)) {
        countSkippedMultipack++;
        if (sampleSkippedMultipack.length < 20) {
          sampleSkippedMultipack.push({ feed_name: name, matched_product_id: matchedProductId, matched_name: matchedName, url: rawMerchantUrl || wrappedUrl });
        }
        continue;
      }
    }

    // Multipack guard, CREATE-NEW branch. No matched product to compare against,
    // so the feed name is all there is. A multipack deeplink whose feed name
    // reads as a single item would create a product named like the single but
    // priced as a multipack.
    if (multipackGuard && !matchedProductId && isMultipackMismatch(rawMerchantUrl || wrappedUrl, name)) {
      countSkippedMultipack++;
      continue;
    }

    if (matchedProductId) {
      countLinkExisting++;
      linkActions.push({ product_id: matchedProductId, ext_id: matchValue, price, url: wrappedUrl, in_stock: inStock, ean: rawEan, mpn: rawMpn, image_url: imageUrl });
      if (description) { descBuffer.push({ product_id: matchedProductId, description }); if (descBuffer.length >= DESC_FLUSH) await flushDescriptions(); }
      // In-feed learning: write to BOTH the chunk map (for later rows in this
      // chunk) and the persistent seen-map (for later chunks).
      //
      // THE SKIP SETS ARE CONSULTED HERE, AND UNTIL NOW THEY WERE NOT (item 424).
      //
      // `tier1Skips` was written, counted and persisted, and read nowhere. A barcode
      // withheld from the map is ABSENT from it -- which is exactly the condition this
      // line tests. So the first row carrying an ambiguous barcode was skipped and the
      // NEXT row, matched by name, wrote that barcode straight back in, pointing at
      // whatever it had matched. From there it linked via Tier 1 for the rest of the run
      // and, through seenEanToProductId, every later chunk.
      //
      // The guard skipped the first row and adopted the second. It has been ineffective
      // since it was written: THE GUARD'S OWN DESIGN LEFT THE SLOT EMPTY FOR THE THING IT
      // EXCLUDED.
      if (normEan && !tier1Skips.has(normEan) && !eanToProductId.has(normEan)) {
        eanToProductId.set(normEan, matchedProductId); seenEanToProductId.set(normEan, matchedProductId);
      }
      if (normMpn && !tier2Skips.has(normMpn) && !isPlaceholderMpn(normMpn) && !mpnToProductId.has(normMpn)) {
        mpnToProductId.set(normMpn, matchedProductId); seenMpnToProductId.set(normMpn, matchedProductId);
      }
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
    // The 4th argument is the whole of the path-first supplements feature. Until
    // 14 Aug 2026 this call passed TWO arguments, so `onSupplementsPath` took its
    // `false` default for every row of every retailer and the branch added in #256
    // was unreachable — writing a prefix into a retailer's config would have done
    // nothing, silently. See work-list item 91 and instance 15.
    //
    // The 3rd argument is passed as `undefined` on purpose: it means "take the
    // EXTENDED_CATEGORIES_ENABLED default", and that constant is not exported here.
    // Positional defaults are why the gap existed; naming it is cheaper than a
    // second import.
    const onSupplementsPath = isOnSupplementsPath(categoryPath, supplementsPathPrefixes);
    if (onSupplementsPath) countOnSupplementsPath++;
    const cat = inferCategorisationForImport(name, brand, undefined, onSupplementsPath);

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
    let finalTopCategory: ImportTopCategory = cat.top_category;
    let finalTags: string[] = cat.tags;
    if (topCategoryDefault) {
      finalTopCategory = topCategoryDefault;
      // Replace the top_category tag (always at index 0 from inference)
      finalTags = [topCategoryDefault, ...cat.tags.slice(1)];
    }

    // PART 2: file the subcategory from the retailer's own taxonomy where the map says so.
    //
    // CREATES ONLY, because categorisation in this importer has ALWAYS been creates-only:
    // updateActions and linkActions do not write tags/top_category/subcategory (items 105,
    // 125). That is what makes product_exclusions durable and it is what makes THIS
    // durable too — but it also means this change does NOTHING for the 1,771 rows already
    // in the table. Those need the backfill. A run that reports zero here on an existing
    // retailer is reporting "no new products", not "the map did nothing".
    let finalSubcategory: string | null = cat.subcategory;
    // THE MAP KEYS ON THE FEED'S TAXONOMY AND THE SUBCATEGORY BELONGS TO OURS, AND NOTHING
    // MAKES THEM AGREE. Gated on the row's OWN final top_category so a mapped value can never
    // land on a product our categoriser filed somewhere else.
    //
    // MyProtein, 25 Aug 2026: 14 of 609 imported products carried a subcategory from another
    // category's vocabulary -- `skincare/sports` on Freja Bone Broth and KIKI Health Liquid
    // Chlorophyll, `bath_body/sports` on Origin Cream of Rice -- because merchant_category
    // "Sports Nutrition" fired the map on rows the categoriser had sent to skincare.
    //
    // THE CONFIG GUARD COVERED ONLY ONE DIRECTION. Every "Health and Beauty" value was mapped
    // to null precisely so a shower gel could not acquire a sports subcategory. The collision
    // running the other way -- a sports-nutrition value landing on a skincare row -- was not
    // considered, and `skincare/sports` is `bath_body/supplements` arriving from the other
    // side. A per-retailer config cannot fix that; only the application site can, because only
    // it knows both halves. Item 320.
    const mappedTopCategories = new Set(["supplements"]);
    if (subcategoryMapEnabled && subcategorySourceIdx !== -1 && mappedTopCategories.has(finalTopCategory)) {
      const sourceValue = (fields[subcategorySourceIdx] || "").trim();
      if (!sourceValue) {
        countSubcategoryMapSourceEmpty++;
      } else {
        const hit = matchSubcategoryPrefix(sourceValue, subcategoryPrefixMap);
        if (!hit.matched) {
          countSubcategoryMapUnmatched++;
        } else if (hit.subcategory === null) {
          // Deliberately out of scope. COUNTED AND REPORTED, AND NOTHING ELSE — the row is
          // still created and still keeps its inferred subcategory. Removing it is part 3.
          countSubcategoryMapOutOfScope++;
          subcategoryMapBreakdown[`out_of_scope|${hit.prefix}`] =
            (subcategoryMapBreakdown[`out_of_scope|${hit.prefix}`] || 0) + 1;
        } else {
          finalSubcategory = hit.subcategory;
          countSubcategoryFromMap++;
          subcategoryMapBreakdown[hit.subcategory] =
            (subcategoryMapBreakdown[hit.subcategory] || 0) + 1;
        }
      }
    }

    countCreateNew++;
    // Brand restriction: if existing_brands_only is on, skip products from
    // brands we don't already track.
    if (existingBrandsOnly) {
      const normBrand = normaliseForMatch(brand);   // match_brand parity (brand is already alias-canonicalised)
      if (!normBrand || !existingBrandSet.has(normBrand)) {
        countCreateNew--;
        countSkippedNewBrand++;
        if (isOrdinary) ordinaryDiagnostic.skipped_new_brand++;
        continue;
      }
    }

// v6.16: extract canonical_size from raw product name for the new product.
    // Debenhams (r28): prefer the size lifted from the "| Size:" attribute; fall
    // back to name extraction if that clause held no parseable size.
    const canonicalSize =
      (debenhamsSizeClause ? extractCanonicalSize(debenhamsSizeClause) : null) ??
      extractCanonicalSize(name);
    // v6.17: extract shade from raw product name for the new product. Debenhams
    // (r28): prefer the shade routed from the " in {shade}" attribute.
    const shade = debenhamsShade ?? extractShade(name, brand);

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
      subcategory: finalSubcategory,
      tags: finalTags,
      canonical_size: canonicalSize,
      shade: shade,
      match_key: productMatchKey,
      price,
      url: wrappedUrl,
      in_stock: inStock,
      ean: rawEan,
      mpn: rawMpn,
      image_url: imageUrl,
      description,
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
    // Stride sampling (item 425). `seenForSample` counts EVERY row the feed yields;
    // `stride` keeps one in N so the sample spans the file rather than its opening.
    // The stride is derived from feed_total_rows when the source reports it and falls
    // back to a fixed guess otherwise -- a slightly-wrong stride still samples across
    // the feed, which is the property that matters.
    const sampling = MAX_ROWS > 0 && dryRun;
    for await (const batch of batchSource()) {
      for (const rawFields of batch) {
        if (sampling) {
          const keep = (sampleSeen % SAMPLE_STRIDE) === 0 && sampleKept < MAX_ROWS;
          sampleSeen++;
          if (!keep) continue;
          sampleKept++;
        }
        chunkRows.push(rawFields);
        if (chunkRows.length >= CHUNK_SIZE) await runChunk();
      }
      if (sampling && sampleKept >= MAX_ROWS) break;
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
    // Reported so a guard that starts over- or under-firing is visible in the
    // run output rather than silently changing the landed row count.
    multipack_guard_enabled: multipackGuard,
    skipped_multipack_mismatch: countSkippedMultipack,
    multipack_name_unresolved: countMultipackUnresolved,
    sample_skipped_multipack: sampleSkippedMultipack,
    // Persisted into scrape_log.details so the trips are INSPECTABLE INDIVIDUALLY
    // rather than only totalled — 137 rows nobody can read is a number, not a
    // finding. Capped at 200; the counter is uncapped.
    sample_reassignment_suspect: sampleReassignmentSuspect,
    dry_run: dryRun,
    feed_total_rows: feedRows,
    // Present only when max_rows sampled the feed, so a sampled run can never be read
    // as a whole-feed run by accident. Item 425.
    ...(MAX_ROWS > 0 && dryRun
      ? { sampled: { max_rows: MAX_ROWS, stride: SAMPLE_STRIDE, rows_seen: sampleSeen, rows_kept: sampleKept,
                     tail_unsampled: sampleKept >= MAX_ROWS } }
      : {}),
    feed_fetch_ms: fetchMs,
    // BEFORE ADDING A COUNTER HERE, APPLY THIS TEST:
    //
    //   A ZERO IS ONLY WORTH PRINTING IF ITS ABSENCE WOULD HAVE MEANT SOMETHING ELSE.
    //
    // Three recorded instances, and they separate cleanly on exactly that:
    //
    //   NEGATIVE  product_merge_log.saved_routines_updated is hardcoded to 0. It reads
    //             as "checked, none found". The check does not exist, and every merge
    //             ever run has logged that zero. Work-list item 104.
    //   POSITIVE  on_supplements_path: 0 alongside supplements_path_unreachable: [].
    //             The empty list is what proves the check RAN, which is what made the
    //             inert and active states distinguishable. #268, work-list item 114.
    //   POSITIVE  monitor-retailer-feeds returns delivery_unknown: 0 in its all_healthy
    //             payload rather than omitting the field. An absent field and a zero
    //             field are different claims: absent means nobody asked, zero means
    //             somebody asked and the answer was none. Work-list item 131.
    //
    // So: if the counter can only ever be zero, it is decoration. If a reader could not
    // otherwise tell whether the code path ran, print it — and if the answer depends on
    // a list being empty rather than a number being zero, print the list too.
    counts: {
      excluded_path_not_in_scope: countExcludedPathNotInScope,
      excluded_by_category: countExcluded,
      excluded_no_price: countNoPrice,
      excluded_no_match_id: countNoMatchId,
      excluded_out_of_stock: countOOS,
      skipped_new_brand: countSkippedNewBrand,
      reassignment_suspect: countReassignmentSuspect,
      size_mismatch_rejected: countSizeMismatchRejected,
      v6_excluded: countV6Excluded,
      on_supplements_path: countOnSupplementsPath,
      supplements_path_unreachable: supplementsPathUnreachable,
      // PART 2, and it passes the test above the same way on_supplements_path does: the
      // NUMBERS are all zero on an inert run and would also be zero on a broken one, so
      // the number alone is decoration. `subcategory_map_source` is what carries the
      // information — it takes four distinguishable values and a reader can tell which:
      //   null              feature off, nothing configured        (inert, expected today)
      //   "half-set"        one of the pair set, the other not     (the item 91 no-op)
      //   "<col>:not-in-feed"  configured column absent from the header row
      //   "<col>"           resolved and read
      // Without it, "0 rows mapped" cannot be told apart from "never looked".
      subcategory_map_source: !subcategorySourceField
        ? (subcategoryMapHalfSet ? "half-set" : null)
        : subcategoryMapHalfSet
          ? "half-set"
          : subcategorySourceIdx === -1
            ? `${subcategorySourceField}:not-in-feed`
            : subcategorySourceField,
      subcategory_map_entries: subcategoryPrefixMap.length,
      subcategory_from_map: countSubcategoryFromMap,
      subcategory_map_out_of_scope: countSubcategoryMapOutOfScope,
      subcategory_map_unmatched: countSubcategoryMapUnmatched,
      subcategory_map_source_empty: countSubcategoryMapSourceEmpty,
      subcategory_map_breakdown: subcategoryMapBreakdown,
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
      // Counted BEFORE the decision tree: feed rows offering a usable barcode, not
      // rows stored with one. See the comment at the increment. Always >= stored.
      rows_with_ean: rowsWithEan,
      // Coalesce diagnostics, reported from the FIRST stage rather than added later,
      // so a feed whose barcodes start failing validation is visible per run rather
      // than discovered in aggregate months on.
      sibling_coalesce: coalesceOn,
      ean_from_sibling: coalesceStats.ean_from_alt,
      category_path_from_sibling: coalesceStats.category_path_from_alt,
      category_name_from_sibling: coalesceStats.category_name_from_alt,
      barcode_rejected: coalesceStats.barcode_rejected,
      barcode_reject_reasons: coalesceStats.barcode_reject_reasons,
      barcode_reject_samples: coalesceStats.barcode_reject_samples,
      rows_with_mpn: rowsWithMpn,
      // COUNT ONLY. The rows themselves go to tier1_ean_skips, not into this jsonb —
      // item 44 is what happens to structured diagnostics stored here, and a skip list
      // that has to be parsed out of a log blob is not a merge queue.
      tier1_ambiguous_skipped: tier1Skips.size,
      tier2_ambiguous_skipped: tier2Skips.size,
      beauty_flash_names_rebuilt: countBeautyFlashRebuilt,
      debenhams_names_cleaned: countDebenhamsCleaned,
      debenhams_shades_routed: countDebenhamsShadeRouted,
    },
    sample_beauty_flash_rebuilt: sampleBeautyFlashRebuilt,
    sample_debenhams_cleaned: sampleDebenhamsCleaned,
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

  // Persist the ambiguity list. Written on DRY RUNS TOO, deliberately: a dry run is
  // where the set is meant to be read before anything is applied, and a diagnostic that
  // only exists on the live path cannot inform the decision to take the live path.
  // Failure here must never fail the import — the skips are a finding, not a result.
  if (tier1Skips.size > 0) {
    try {
      const skipRows = [...tier1Skips.entries()].map(([ean, ids]) => ({
        retailer_id: retailerId,
        dry_run: dryRun,
        ean,
        candidate_product_ids: ids,
      }));
      for (let i = 0; i < skipRows.length; i += 500) {
        const { error: skipErr } = await supa.from("tier1_ean_skips").insert(skipRows.slice(i, i + 500));
        if (skipErr) { console.error("tier1_ean_skips insert failed:", skipErr.message); break; }
      }
    } catch (e) {
      console.error("tier1_ean_skips write threw:", e instanceof Error ? e.message : String(e));
    }
  }

  // Same contract as tier1_ean_skips above: written on dry runs too, and a failure here
  // never fails the import. `reason` separates the two refusals -- 'ambiguous' wants a
  // merge or better feed data, 'placeholder' wants nothing, because the value was never
  // an identifier. Item 424.
  if (tier2Skips.size > 0) {
    try {
      const mpnSkipRows = [...tier2Skips.entries()].map(([mpn, ids]) => ({
        retailer_id: retailerId,
        dry_run: dryRun,
        mpn,
        reason: isPlaceholderMpn(mpn) ? "placeholder" : "ambiguous",
        candidate_product_ids: ids,
      }));
      for (let i = 0; i < mpnSkipRows.length; i += 500) {
        const { error: skipErr } = await supa.from("tier2_mpn_skips").insert(mpnSkipRows.slice(i, i + 500));
        if (skipErr) { console.error("tier2_mpn_skips insert failed:", skipErr.message); break; }
      }
    } catch (e) {
      console.error("tier2_mpn_skips write threw:", e instanceof Error ? e.message : String(e));
    }
  }

  if (dryRun) {
    return new Response(JSON.stringify(result, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  // ============================ APPLY ============================
  // The match loop already streamed most actions to disk via flush() as the
  // accumulators crossed FLUSH_THRESHOLD; this applies whatever's still buffered.
  // dry_run returned above, so this is real-run only. updatesApplied /
  // linksApplied / createsApplied / errors were accumulated across all flushes.
  await flush();
  await flushDescriptions(); // flush any description tail below the DESC_FLUSH threshold

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
    // Merge by KIND, not by addition. See _shared/merge-counts.ts for why, and for
    // why the previous version's test passed without ever running this code.
    const prevCounts = (runMeta.counts && typeof runMeta.counts === "object") ? runMeta.counts : {};
    const mergedCounts = mergeSliceCounts(
      prevCounts as Record<string, unknown>,
      result.counts as Record<string, unknown>,
    );

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
    const absenceReport = await finaliseRun(supa, {
      retailerId, runStartedAt, startTimeMs: startTime, hadError: runHadError,
      feedRows: runMeta.staged_rows || 0,
      matched: mergedApplied.updates,
      inserted: mergedApplied.links + mergedApplied.creates,
      counts: mergedCounts,
      errorMessage: runHadError ? mergedApplied.errors.slice(0, 3).join("; ").slice(0, 500) : null,
    });
    // Cleanup: staging slice files + all run_state rows for this run.
    try { const { data: f } = await supa.storage.from(STAGING_BUCKET).list(runId); if (f?.length) await supa.storage.from(STAGING_BUCKET).remove(f.map((x) => `${runId}/${x.name}`)); } catch { /* best effort */ }
    await supa.from("import_run_state").delete().eq("run_id", runId);
    // Refresh ISR caches for the brands/categories this run touched (best-effort).
    await triggerRevalidation(supa, retailerId, runStartedAt);
    result.applied = { final: true, total_slices: totalSlices, updates_applied: mergedApplied.updates, links_applied: mergedApplied.links, creates_applied: mergedApplied.creates, capped_creates: mergedApplied.capped, error_count: mergedApplied.errors.length, sample_errors: mergedApplied.errors.slice(0, 10), absence: absenceReport };
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

  const absenceReport = await finaliseRun(supa, {
    // hadError, not errors.length: a create-cap hit means the run is partial
    // even though every write succeeded, and a partial run must not be used as
    // an absence baseline or be allowed to flip rows.
    retailerId, runStartedAt, startTimeMs: startTime, hadError,
    feedRows,
    matched: updatesApplied,
    inserted: linksApplied + createsApplied,
    counts: (result as any)?.counts,
    errorMessage: hadError ? [capMsg, ...errors.slice(0, 3)].filter(Boolean).join("; ").slice(0, 500) : null,
  });

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
    absence: absenceReport,
  };
  result.duration_ms = Date.now() - startTime;

  return new Response(JSON.stringify(result, null, 2), { headers: { "Content-Type": "application/json" } });
});// touch 1779206234
