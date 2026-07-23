// Edge function: import-rakuten-feed (v6.21-rakuten.0 — sliced_import)
//
// Generic, retailer-agnostic Rakuten LinkShare datafeed importer.
//
// v6.21-rakuten.0 changes (port of import-awin-feed sliced_import, inline staging):
//   - Superdrug (retailer 12) grew past the 150s edge wall-clock on its single
//     apply pass (102s on 2026-07-07 -> 504 on 2026-07-08, and climbing with the
//     catalogue). This ports the proven sliced_import machinery (already live on
//     the awin importer for retailers 11/25/26/27) so no single invocation does
//     the whole feed.
//   - Three modes now, chosen by effectiveMode (see dispatch):
//       'single'  — the legacy whole-feed path. Used for ALL dry-runs and any
//                   retailer with sliced_import=false. Byte-for-byte unchanged.
//       'stage'   — a fresh real-apply on a sliced retailer: download+decompress
//                   the NDJSON feed, split it into slice_<i>.jsonl files in the
//                   import-staging bucket, init import_run_state meta, fire slice 0.
//                   No matching / categorisation / DB apply happens here (that is
//                   exactly the work that blows the wall-clock), so staging is cheap.
//       'process' — one slice invocation: load its slice file, run the identical
//                   match+categorise+apply over just those rows, advance the meta
//                   cursor, then chain the next slice (or finalize on the last).
//   - Chaining is fire-and-forget via fmb_invoke_import_slice (pg_net self-POST),
//     with a `fn` routing key so the chain targets import-rakuten-feed (the RPC
//     defaults to import-awin-feed). The fmb-import-watchdog cron re-fires a
//     stalled slice from run_state.meta (also fn-aware). See migration
//     20260708120000_rakuten_sliced_import_routing.sql.
//   - Exactly-once: the feed is partitioned into disjoint slice files (whole
//     lines, never cut), each row processed by exactly one slice. Cross-slice
//     visibility of a product created/linked in an earlier slice comes from the
//     COMMITTED DB — each slice re-derives existingByExtId + the live
//     ean_product_index / mpn_product_index views before matching. Link writes go
//     through upsert_retailer_prices_lowest with a run-wide run_started_at anchor,
//     so lowest-price-wins is deterministic regardless of slice order, and a
//     re-fired slice is idempotent (a re-created row is found by ext_id/EAN/MPN).
//   - There is NO out-of-stock / stale sweep in this importer (and none is added),
//     so there is no cross-slice reconciliation to get wrong.
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
//   - Feed bucket: "rakuten-feeds" (private) — path feeds/<slug>/latest.ndjson.gz
//   - Slice bucket: "import-staging" (private) — path <run_id>/slice_<i>.jsonl
//
// Call:
//   POST /functions/v1/import-rakuten-feed
//   body: {
//     "retailer_id": 12,
//     "feed_path": "feeds/superdrug/latest.ndjson.gz",  // stage/single only
//     "feed_bucket": "rakuten-feeds",  // optional
//     "dry_run": true,
//     // sliced_import knobs (optional; a fresh real-apply on a sliced retailer
//     // auto-stages, so callers normally pass none of these):
//     "mode": "stage" | "process",
//     "run_id": "<uuid>",
//     "slice_index": 0,
//     "slice_rows": 9000,
//     "auto_chain": true   // false = canary; stage/process without firing next
//   }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { finaliseRun } from "../_shared/run-metrics.ts";
import { inferCategorisationForImport } from "../_shared/categorisation.ts";
import { normaliseDescription } from "../_shared/description.ts";
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
// ============================================================================
// Constants
// ============================================================================
const STAGING_BUCKET = "import-staging";
const SLICE_ROWS_DEFAULT = 9000;
const CREATE_CAP = 20000;            // global across slices via meta.creates_enqueued
const INSERT_CHUNK = 500;
const DESC_CHUNK = 150;
const IMAGE_UPDATE_CHUNK = 150;
const SELF_FN = "import-rakuten-feed";
const slicePath = (runId, i) => `${runId}/slice_${i}.jsonl`;
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
// ── match-key normalisation, size/shade extraction, EAN/MPN normalisation ──
// Single source of truth: imported from _shared/match-key.ts (see top of file)
// so the three importers and the dedup backfill cannot drift.

// Records the outcome of an import attempt on the retailer's config row so that
// monitor-retailer-feeds can alert on failures immediately (instead of waiting
// for the 48h staleness backstop). Best-effort: never throws.
// status: "ok" | "error" | "running"
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
const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), {
  status,
  headers: {
    "Content-Type": "application/json"
  }
});

// ── Fresh per-run accumulator of every counter / action array / sample. One acc
//    per invocation; for a 'process' slice it covers only that slice's rows and
//    is merged into the run's meta afterwards.
function makeAcc() {
  return {
    feedRows: 0,
    countExcludedPathNotInScope: 0,
    countExcluded: 0,
    countNoPrice: 0,
    countNoMatchId: 0,
    countOOS: 0,
    countUpdate: 0,
    countLinkExisting: 0,
    countCreateNew: 0,
    countSkippedNewBrand: 0,
    countSizeMismatchRejected: 0,
    countParseErrors: 0,
    countV6Excluded: 0,
    countLinkViaEan: 0,
    countLinkViaMpn: 0,
    countLinkViaNameExact: 0,
    countLinkViaNameStripped: 0,
    rowsWithEan: 0,
    rowsWithMpn: 0,
    countBrandCanonicalised: 0,
    v6ExclusionBreakdown: {},
    v6TopCategoryBreakdown: { skincare: 0, makeup: 0, hair: 0 },
    sampleV6Excluded: [],
    sampleExcluded: [],
    sampleLinkExisting: [],
    sampleCreateNew: [],
    sampleRawCategoryData: [],
    unmatchedBrandCounts: new Map(),
    updateActions: [],
    linkActions: [],
    createActions: []
  };
}
const SAMPLE_LIMIT_EXCLUDED = 50;
const SAMPLE_LIMIT_CREATE_NEW = 50;

// ── Load the retailer config plus every DB-derived match map. Re-run per slice
//    so a slice always sees the committed effects of earlier slices (that is the
//    cross-slice exactly-once mechanism). Returns { ok:false, response } on a DB
//    read failure so the caller can bail with the right status + status stamp.
async function buildContext(supa, config, retailerId) {
  const categoryExcludes = Array.isArray(config.category_excludes) ? config.category_excludes : [];
  const nameExcludes = Array.isArray(config.name_excludes) ? config.name_excludes : [];
  const categoryPathMustContain = Array.isArray(config.category_path_must_contain) ? config.category_path_must_contain : [];
  const existingBrandsOnly = config.existing_brands_only === true;
  const skipNameMatch = config.skip_name_match === true;
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
  // Existing retailer_prices rows for this retailer
  const existingRows = [];
  let from = 0;
  while(true){
    const { data, error } = await supa.from("retailer_prices").select("id, product_id, external_product_id, price, in_stock, ean, mpn").eq("retailer_id", retailerId).order("id", { ascending: true }).range(from, from + 999);
    if (error) return { ok: false, error: `DB read failed (retailer_prices): ${error.message ?? error}` };
    if (!data || data.length === 0) break;
    existingRows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const existingByExtId = new Map();
  for (const r of existingRows){
    if (r.external_product_id) existingByExtId.set(r.external_product_id, r);
  }
  // Cross-retailer EAN/MPN lookup tables (live views over retailer_prices)
  const eanToProductId = new Map();
  const mpnToProductId = new Map();
  {
    let efrom = 0;
    while(true){
      const { data, error } = await supa.from("ean_product_index").select("ean, product_id").order("ean", { ascending: true }).range(efrom, efrom + 999);
      if (error) return { ok: false, error: `DB read failed (ean_product_index): ${error.message ?? error}` };
      if (!data || data.length === 0) break;
      for (const r of data){
        const k = String(r.ean || "").trim();
        if (k && r.product_id != null && !eanToProductId.has(k)) eanToProductId.set(k, r.product_id);
      }
      if (data.length < 1000) break;
      efrom += 1000;
    }
  }
  {
    let mfrom = 0;
    while(true){
      const { data, error } = await supa.from("mpn_product_index").select("mpn, product_id").order("mpn", { ascending: true }).range(mfrom, mfrom + 999);
      if (error) return { ok: false, error: `DB read failed (mpn_product_index): ${error.message ?? error}` };
      if (!data || data.length === 0) break;
      for (const r of data){
        const k = String(r.mpn || "").trim();
        if (k && r.product_id != null && !mpnToProductId.has(k)) mpnToProductId.set(k, r.product_id);
      }
      if (data.length < 1000) break;
      mfrom += 1000;
    }
  }
  // All products for fuzzy name matching — skipped for high-EAN retailers.
  const allProducts = [];
  if (!skipNameMatch) {
    from = 0;
    while(true){
      // Redirect soft-merged rows to their keeper: index the dead row's match_key
      // against the KEEPER id, so a re-imported feed row that matches a merged
      // product's name links to the keeper, never the hidden dead row.
      const { data, error } = await supa.from("products").select("id, name, brand, merged_into").order("id", { ascending: true }).range(from, from + 999);
      if (error) return { ok: false, error: `DB read failed (products): ${error.message ?? error}` };
      if (!data || data.length === 0) break;
      allProducts.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  const productByExact = new Map();
  const productByStripped = new Map();
  const sizeByProductId = new Map();
  const numbersByProductId = new Map();
  const existingBrandSet = new Set();
  for (const p of allProducts){
    const exactKey = buildMatchKey(p.brand || "", p.name);
    if (!exactKey) continue;
    const mergedTargetId = p.merged_into ?? p.id;
    if (!productByExact.has(exactKey)) productByExact.set(exactKey, mergedTargetId);
    const strippedKey = stripSize(exactKey);
    if (strippedKey && !productByStripped.has(strippedKey)) productByStripped.set(strippedKey, mergedTargetId);
    sizeByProductId.set(p.id, extractSize(exactKey));
    numbersByProductId.set(p.id, extractNameNumbers(p.name));
    if (p.brand) {
      const normBrand = normaliseForMatch(p.brand);   // match_brand parity (fold punctuation/accents)
      if (normBrand) existingBrandSet.add(normBrand);
    }
  }
  return {
    ok: true,
    ctx: {
      config, categoryExcludes, nameExcludes, categoryPathMustContain,
      existingBrandsOnly, skipNameMatch,
      brandAliasMap, lookupCanonicalBrand,
      existingByExtId, eanToProductId, mpnToProductId,
      productByExact, productByStripped, sizeByProductId, numbersByProductId,
      existingBrandSet
    }
  };
}

// ── Classify one feed product into acc (update / link / create / excluded).
//    Verbatim port of the original processProduct closure; ctx supplies the maps.
function classify(product, ctx, acc) {
  const config = ctx.config;
  acc.feedRows++;
  const name = String(product.name || "");
  const skuNumber = String(product.sku || "");
  const productIdAttr = String(product.product_id || "");
  const rawBrand = String(product.brand || "");
  const brand = ctx.lookupCanonicalBrand(rawBrand);   // canonical from here down
  if (rawBrand) {
    if (brand !== rawBrand) acc.countBrandCanonicalised++;
    else if (!ctx.brandAliasMap.has(rawBrand.toLowerCase().trim()))
      acc.unmatchedBrandCounts.set(rawBrand, (acc.unmatchedBrandCounts.get(rawBrand) ?? 0) + 1);
  }
  const primaryCat = String(product.category_primary || "");
  const secondaryCat = String(product.category_secondary || "");
  const categoryPath = `${primaryCat} > ${secondaryCat}`.replace(/~~/g, " > ");
  const categoryName = primaryCat;
  if (acc.sampleRawCategoryData.length < 8) {
    acc.sampleRawCategoryData.push({ name, category_path: categoryPath, category_name: categoryName });
  }
  const pathInclusion = isPathIncluded(categoryPath, ctx.categoryPathMustContain);
  if (!pathInclusion.included) {
    acc.countExcludedPathNotInScope++;
    return;
  }
  const categoryExclusion = isExcludedCategory(categoryPath, categoryName, ctx.categoryExcludes);
  if (categoryExclusion.excluded) {
    acc.countExcluded++;
    if (acc.sampleExcluded.length < SAMPLE_LIMIT_EXCLUDED) {
      acc.sampleExcluded.push({ name, brand, reason: "category", matched_term: categoryExclusion.matched_term, category_path: categoryPath });
    }
    return;
  }
  const nameExclusion = isExcludedName(name, ctx.nameExcludes);
  if (nameExclusion.excluded) {
    acc.countExcluded++;
    if (acc.sampleExcluded.length < SAMPLE_LIMIT_EXCLUDED) {
      acc.sampleExcluded.push({ name, brand, reason: "name", matched_term: nameExclusion.matched_term });
    }
    return;
  }
  const matchValue = config.match_column === "aw_product_id" ? productIdAttr : skuNumber;
  if (!matchValue) {
    acc.countNoMatchId++;
    return;
  }
  const price = parseFloat(String(product.price));
  if (!isFinite(price) || price <= 0) {
    acc.countNoPrice++;
    return;
  }
  const availStr = String(product.availability || "").toLowerCase();
  const inStock = availStr === "in-stock" || availStr === "instock" || availStr === "in_stock";
  if (!inStock) {
    acc.countOOS++;
    return;
  }
  const merchantUrl = String(product.url || "");
  const wrappedUrl = passthroughUrl(merchantUrl);
  const rawEan = String(product.upc || "").trim();
  const rawMpn = String(product.mpn || "").trim();
  const normEan = normaliseEan(rawEan);
  const normMpn = normaliseMpn(rawMpn);
  if (normEan) acc.rowsWithEan++;
  if (normMpn) acc.rowsWithMpn++;
  const imageUrl = String(product.image_url || "").trim();
  const description = normaliseDescription(String(product.description || ""), name) || "";
  const existing = ctx.existingByExtId.get(matchValue);
  if (existing) {
    acc.countUpdate++;
    acc.updateActions.push({
      rp_id: existing.id,
      product_id: existing.product_id,
      price, url: wrappedUrl, in_stock: inStock,
      ean: rawEan, mpn: rawMpn, image_url: imageUrl, description
    });
    return;
  }
  let matchedProductId = undefined;
  let matchedVia = undefined;
  if (normEan && ctx.eanToProductId.has(normEan)) {
    matchedProductId = ctx.eanToProductId.get(normEan);
    matchedVia = "ean";
    acc.countLinkViaEan++;
  }
  if (!matchedProductId && normMpn && ctx.mpnToProductId.has(normMpn)) {
    matchedProductId = ctx.mpnToProductId.get(normMpn);
    matchedVia = "mpn";
    acc.countLinkViaMpn++;
  }
  const productMatchKey = buildMatchKey(brand, name);
  const strippedMatchKey = stripSize(productMatchKey);
  const sourceSize = extractSize(productMatchKey);
  const sourceNumbers = extractNameNumbers(name);
  if (!matchedProductId) {
    const id = ctx.productByExact.get(productMatchKey);
    if (id) {
      matchedProductId = id;
      matchedVia = "name_exact";
      acc.countLinkViaNameExact++;
    }
  }
  if (!matchedProductId) {
    const candidates = [
      ctx.productByStripped.get(productMatchKey),
      ctx.productByExact.get(strippedMatchKey),
      ctx.productByStripped.get(strippedMatchKey)
    ];
    for (const candidateId of candidates){
      if (!candidateId) continue;
      const targetSize = ctx.sizeByProductId.get(candidateId) || "";
      const targetNumbers = ctx.numbersByProductId.get(candidateId) || "";
      if (sourceSize === targetSize && sourceNumbers === targetNumbers) {
        matchedProductId = candidateId;
        matchedVia = "name_stripped";
        acc.countLinkViaNameStripped++;
        break;
      }
      acc.countSizeMismatchRejected++;
    }
  }
  if (matchedProductId) {
    acc.countLinkExisting++;
    acc.linkActions.push({
      product_id: matchedProductId, ext_id: matchValue,
      price, url: wrappedUrl, in_stock: inStock,
      ean: rawEan, mpn: rawMpn, image_url: imageUrl, description
    });
    // Within THIS invocation, later rows dedupe to the same product.
    if (normEan && !ctx.eanToProductId.has(normEan)) ctx.eanToProductId.set(normEan, matchedProductId);
    if (normMpn && !ctx.mpnToProductId.has(normMpn)) ctx.mpnToProductId.set(normMpn, matchedProductId);
    if (acc.sampleLinkExisting.length < 25) {
      acc.sampleLinkExisting.push({ name, brand, matched_product_id: matchedProductId, price, matched_via: matchedVia });
    }
    return;
  }
  // V6 INFERENCE
  const cat = inferCategorisationForImport(name, brand);
  if (cat.excluded) {
    acc.countV6Excluded++;
    acc.v6ExclusionBreakdown[cat.excluded] = (acc.v6ExclusionBreakdown[cat.excluded] || 0) + 1;
    if (acc.sampleV6Excluded.length < SAMPLE_LIMIT_EXCLUDED) {
      acc.sampleV6Excluded.push({ name, brand, reason: cat.excluded });
    }
    return;
  }
  if (ctx.existingBrandsOnly) {
    const normBrand = normaliseForMatch(brand);   // match_brand parity (brand is already alias-canonicalised)
    if (!normBrand || !ctx.existingBrandSet.has(normBrand)) {
      acc.countSkippedNewBrand++;
      return;
    }
  }
  acc.countCreateNew++;
  if (cat.top_category) {
    acc.v6TopCategoryBreakdown[cat.top_category] = (acc.v6TopCategoryBreakdown[cat.top_category] || 0) + 1;
  }
  const canonicalSize = extractCanonicalSize(name);
  const shade = extractShade(name, brand);
  acc.createActions.push({
    ext_id: matchValue, name, brand,
    top_category: cat.top_category || "skincare",
    product_type: cat.product_type, subcategory: cat.subcategory, tags: cat.tags,
    canonical_size: canonicalSize, shade,
    match_key: productMatchKey,
    price, url: wrappedUrl, in_stock: inStock,
    ean: rawEan, mpn: rawMpn, image_url: imageUrl, description
  });
  if (acc.sampleCreateNew.length < SAMPLE_LIMIT_CREATE_NEW) {
    acc.sampleCreateNew.push({ name, brand, top_category: cat.top_category, product_type: cat.product_type, subcategory: cat.subcategory, canonical_size: canonicalSize, shade, price });
  }
}

function buildCounts(acc) {
  const v6CanonicalSizeExtracted = acc.createActions.filter((a)=>a.canonical_size != null).length;
  const v6ShadeExtracted = acc.createActions.filter((a)=>a.shade != null).length;
  return {
    excluded_path_not_in_scope: acc.countExcludedPathNotInScope,
    excluded_by_category: acc.countExcluded,
    excluded_no_price: acc.countNoPrice,
    excluded_no_match_id: acc.countNoMatchId,
    excluded_out_of_stock: acc.countOOS,
    skipped_new_brand: acc.countSkippedNewBrand,
    size_mismatch_rejected: acc.countSizeMismatchRejected,
    v6_excluded: acc.countV6Excluded,
    would_update_existing: acc.countUpdate,
    would_link_to_existing_product: acc.countLinkExisting,
    would_link_via_ean: acc.countLinkViaEan,
    would_link_via_mpn: acc.countLinkViaMpn,
    would_link_via_name_exact: acc.countLinkViaNameExact,
    would_link_via_name_stripped: acc.countLinkViaNameStripped,
    would_create_new_product: acc.countCreateNew,
    canonical_size_extracted_on_new: v6CanonicalSizeExtracted,
    shade_extracted_on_new: v6ShadeExtracted,
    rows_with_ean: acc.rowsWithEan,
    rows_with_mpn: acc.rowsWithMpn
  };
}

// ── Apply the classified actions to the DB. `lowestUpsert` selects the link
//    write strategy: false = legacy plain upsert (single path, unchanged);
//    true = upsert_retailer_prices_lowest with the run-wide runStartedAt anchor
//    (sliced path — order-independent lowest-price-wins across slices).
async function applyActions(supa, retailerId, acc, { runStartedAtIso, lowestUpsert }) {
  let updatesApplied = 0;
  let linksApplied = 0;
  let createsApplied = 0;
  const errors = [];
  // 1. Updates — chunked price + image + description backfill RPCs.
  if (acc.updateActions.length > 0) {
    const nowIso = new Date().toISOString();
    for(let i = 0; i < acc.updateActions.length; i += INSERT_CHUNK){
      const chunk = acc.updateActions.slice(i, i + INSERT_CHUNK);
      const payload = chunk.map((u)=>({ id: u.rp_id, price: u.price, in_stock: u.in_stock, last_updated: nowIso, url: u.url || "", ean: u.ean || "", mpn: u.mpn || "" }));
      const { data: rpcResult, error: rpcErr } = await supa.rpc("bulk_update_retailer_prices", { updates: payload });
      if (rpcErr) errors.push(`bulk_update_retailer_prices (chunk at ${i}): ${rpcErr.message}`);
      else updatesApplied += typeof rpcResult === "number" ? rpcResult : chunk.length;
    }
    const imageUpdates = acc.updateActions.filter((u)=>u.image_url).map((u)=>({ product_id: u.product_id, image_url: u.image_url }));
    for(let i = 0; i < imageUpdates.length; i += IMAGE_UPDATE_CHUNK){
      const chunk = imageUpdates.slice(i, i + IMAGE_UPDATE_CHUNK);
      const { error: imgErr } = await supa.rpc("bulk_update_product_images", { updates: chunk });
      if (imgErr) errors.push(`bulk_update_product_images (updates chunk at ${i}): ${imgErr.message}`);
    }
    const descUpdates = acc.updateActions.filter((u)=>u.description).map((u)=>({ product_id: u.product_id, description: u.description, source_retailer_id: retailerId }));
    for(let i = 0; i < descUpdates.length; i += DESC_CHUNK){
      const chunk = descUpdates.slice(i, i + DESC_CHUNK);
      const { error: descErr } = await supa.rpc("bulk_update_product_descriptions", { updates: chunk });
      if (descErr) errors.push(`bulk_update_product_descriptions (updates chunk at ${i}): ${descErr.message}`);
    }
  }
  // 2. Links — dedupe by product_id (lowest price) so no chunk conflicts a row
  //    with itself, then upsert.
  const dedupedLinks = new Map();
  for (const l of acc.linkActions){
    const existing = dedupedLinks.get(l.product_id);
    if (!existing || l.price < existing.price) dedupedLinks.set(l.product_id, l);
  }
  const dedupedLinkArray = Array.from(dedupedLinks.values());
  for(let i = 0; i < dedupedLinkArray.length; i += INSERT_CHUNK){
    const chunk = dedupedLinkArray.slice(i, i + INSERT_CHUNK);
    const nowIso = new Date().toISOString();
    const rows = chunk.map((l)=>({ product_id: l.product_id, retailer_id: retailerId, price: l.price, url: l.url, in_stock: l.in_stock, external_product_id: l.ext_id, ean: l.ean || null, mpn: l.mpn || null, last_updated: nowIso }));
    if (lowestUpsert) {
      const { error } = await supa.rpc("upsert_retailer_prices_lowest", { p_rows: rows, p_run_started_at: runStartedAtIso });
      if (error) errors.push(`link batch (lowest) at ${i}: ${error.message}`);
      else linksApplied += chunk.length;
    } else {
      const { error } = await supa.from("retailer_prices").upsert(rows, { onConflict: "product_id,retailer_id" });
      if (error) errors.push(`link batch starting at ${i}: ${error.message}`);
      else linksApplied += chunk.length;
    }
  }
  const linkImageUpdates = dedupedLinkArray.filter((l)=>l.image_url).map((l)=>({ product_id: l.product_id, image_url: l.image_url }));
  for(let i = 0; i < linkImageUpdates.length; i += IMAGE_UPDATE_CHUNK){
    const chunk = linkImageUpdates.slice(i, i + IMAGE_UPDATE_CHUNK);
    const { error: linkImgErr } = await supa.rpc("bulk_update_product_images", { updates: chunk });
    if (linkImgErr) errors.push(`bulk_update_product_images (links chunk at ${i}): ${linkImgErr.message}`);
  }
  const linkDescUpdates = dedupedLinkArray.filter((l)=>l.description).map((l)=>({ product_id: l.product_id, description: l.description, source_retailer_id: retailerId }));
  for(let i = 0; i < linkDescUpdates.length; i += DESC_CHUNK){
    const chunk = linkDescUpdates.slice(i, i + DESC_CHUNK);
    const { error: linkDescErr } = await supa.rpc("bulk_update_product_descriptions", { updates: chunk });
    if (linkDescErr) errors.push(`bulk_update_product_descriptions (links chunk at ${i}): ${linkDescErr.message}`);
  }
  // 3. Creates — two-phase bulk insert (products then retailer_prices).
  for(let i = 0; i < acc.createActions.length; i += INSERT_CHUNK){
    const chunk = acc.createActions.slice(i, i + INSERT_CHUNK);
    const productRows = chunk.map((c)=>({
      name: c.name, brand: c.brand,
      normalised_brand: c.brand ? String(c.brand).toLowerCase().trim() || null : null,
      category: c.product_type, product_type: c.product_type, top_category: c.top_category,
      subcategory: c.subcategory, tags: c.tags, canonical_size: c.canonical_size, shade: c.shade,
      match_key: c.match_key, image_url: c.image_url || null,
      description: c.description || null, description_source_retailer_id: c.description ? retailerId : null
    }));
    const { data: insertedProducts, error: pErr } = await supa.from("products").insert(productRows).select("id");
    if (pErr || !insertedProducts || insertedProducts.length !== chunk.length) {
      errors.push(`create products batch at ${i}: ${pErr?.message || "row count mismatch"}`);
      continue;
    }
    const nowIso = new Date().toISOString();
    const priceRows = chunk.map((c, idx)=>({ product_id: insertedProducts[idx].id, retailer_id: retailerId, price: c.price, url: c.url, in_stock: c.in_stock, external_product_id: c.ext_id, ean: c.ean || null, mpn: c.mpn || null, last_updated: nowIso }));
    const { error: rpErr } = await supa.from("retailer_prices").insert(priceRows);
    if (rpErr) errors.push(`create rps batch at ${i}: ${rpErr.message}`);
    else createsApplied += chunk.length;
  }
  return { updatesApplied, linksApplied, createsApplied, errors };
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
  // sliced_import knobs
  const reqMode = body.mode;
  const runId = typeof body.run_id === "string" && body.run_id ? body.run_id : crypto.randomUUID();
  const sliceIndex = (typeof body.slice_index === "number" && body.slice_index >= 0) ? Math.floor(body.slice_index) : 0;
  const SLICE_ROWS = (typeof body.slice_rows === "number" && body.slice_rows > 0) ? Math.floor(body.slice_rows) : SLICE_ROWS_DEFAULT;
  const autoChain = body.auto_chain !== false;
  const isProcess = reqMode === "process";
  if (!retailerId || typeof retailerId !== "number") {
    return jsonResponse({ error: "retailer_id (number) required in request body" }, 400);
  }
  // feed_path is needed to fetch+stage the feed; a 'process' slice reads slice
  // files from import-staging by run_id instead, so it does not require it.
  if (!feedPath && !isProcess) {
    return jsonResponse({ error: "feed_path (string) required in request body — e.g. 'feeds/superdrug/latest.ndjson.gz'" }, 400);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supa = createClient(supabaseUrl, serviceKey);
  // Load retailer config
  const { data: config, error: configErr } = await supa.from("retailer_import_config").select("*").eq("retailer_id", retailerId).single();
  if (configErr || !config) {
    return jsonResponse({ error: "No retailer_import_config row for this retailer_id", retailer_id: retailerId }, 404);
  }
  if (!config.enabled) {
    return jsonResponse({ error: "Retailer import is disabled (config.enabled = false)", retailer_id: retailerId }, 400);
  }
  // Dispatch: explicit mode wins; a fresh real-apply on a sliced retailer stages;
  // everything else (all dry-runs, non-sliced retailers) is the legacy single path.
  const slicedImport = config.sliced_import === true;
  const effectiveMode =
    reqMode === "process" ? "process"
    : (reqMode === "stage" || (slicedImport && !dryRun && !reqMode)) ? "stage"
    : "single";

  // ========================================================================
  // STAGE — split the NDJSON feed into slice files, init run_state, fire slice 0
  // ========================================================================
  if (effectiveMode === "stage") {
    await recordImportStatus(supa, retailerId, "running", `staging run ${runId}`);
    const { data: storageBlob, error: storageErr } = await supa.storage.from(feedBucket).download(feedPath);
    if (storageErr || !storageBlob) {
      await recordImportStatus(supa, retailerId, "error", `Storage download failed (${feedBucket}/${feedPath}): ${String(storageErr?.message || storageErr || "unknown")}`);
      return jsonResponse({ error: "Failed to download feed from Storage", bucket: feedBucket, path: feedPath, details: String(storageErr?.message || storageErr || "unknown").substring(0, 500) }, 502);
    }
    // Decompress (streamed) and collect whole lines. Cheap: no matching/DB work.
    let inflatedText = "";
    try {
      const isGzipped = feedPath.endsWith(".gz");
      const src = isGzipped ? storageBlob.stream().pipeThrough(new DecompressionStream("gzip")) : storageBlob.stream();
      const textStream = src.pipeThrough(new TextDecoderStream("utf-8"));
      const reader = textStream.getReader();
      const parts = [];
      while(true){
        const { value, done } = await reader.read();
        if (done) break;
        parts.push(value);
      }
      inflatedText = parts.join("");
    } catch (e) {
      await recordImportStatus(supa, retailerId, "error", `stage decompress failed: ${String(e)}`);
      return jsonResponse({ error: "stage decompress failed", run_id: runId, details: String(e).substring(0, 500) }, 500);
    }
    const lines = inflatedText.split("\n").map((l)=>l.trim()).filter((l)=>l.length > 0);
    const stagedRows = lines.length;
    if (stagedRows < 50) {
      await recordImportStatus(supa, retailerId, "error", `Feed contains fewer than 50 products (${stagedRows}) — likely partial upload or wrong feed`);
      return jsonResponse({ error: "Feed contains fewer than 50 products — aborting (likely partial upload or wrong feed)", products_found: stagedRows }, 502);
    }
    const inflatedBytes = new TextEncoder().encode(inflatedText).length;
    const totalSlices = Math.ceil(stagedRows / SLICE_ROWS);
    // Write slice files (whole lines only — no JSON row is ever split).
    for(let i = 0; i < totalSlices; i++){
      const sliceLines = lines.slice(i * SLICE_ROWS, (i + 1) * SLICE_ROWS);
      const payload = new TextEncoder().encode(sliceLines.join("\n"));
      const { error: upErr } = await supa.storage.from(STAGING_BUCKET).upload(slicePath(runId, i), payload, { contentType: "application/x-ndjson", upsert: true });
      if (upErr) {
        await recordImportStatus(supa, retailerId, "error", `stage slice upload failed (slice ${i}): ${upErr.message}`);
        return jsonResponse({ error: "stage slice upload failed", run_id: runId, slice: i, details: upErr.message }, 500);
      }
    }
    const runStartedAt = new Date().toISOString();
    const { error: metaErr } = await supa.from("import_run_state").insert({
      run_id: runId, retailer_id: retailerId, kind: "meta", key: "",
      meta: {
        fn: SELF_FN,
        run_started_at: runStartedAt,
        total_slices: totalSlices,
        next_slice: 0,
        creates_enqueued: 0,
        slice_rows: SLICE_ROWS,
        staging_mode: "inline_ndjson",
        feed_format: "rakuten_xml",
        feed_bucket: feedBucket,
        feed_path: feedPath,
        staged_rows: stagedRows,
        inflated_total_bytes: inflatedBytes,
        counts: {},
        applied: { updates: 0, links: 0, creates: 0, capped: 0, errors: [] }
      }
    });
    if (metaErr) {
      await recordImportStatus(supa, retailerId, "error", `stage run_state init failed: ${metaErr.message}`);
      return jsonResponse({ error: "stage run_state init failed", run_id: runId, details: metaErr.message }, 500);
    }
    if (autoChain) {
      // dry_run:false REQUIRED — omitting it defaults the slice to dry-run and
      // discards all writes. fn routes the chain back to THIS function.
      const { error: trigErr } = await supa.rpc("fmb_invoke_import_slice", { p_body: { fn: SELF_FN, retailer_id: retailerId, run_id: runId, mode: "process", slice_index: 0, dry_run: false, slice_rows: SLICE_ROWS } });
      if (trigErr) {
        await recordImportStatus(supa, retailerId, "error", `stage: failed to trigger slice 0: ${trigErr.message}`);
        return jsonResponse({ error: "slice 0 trigger failed", run_id: runId, details: trigErr.message }, 500);
      }
    }
    return jsonResponse({ staged: true, mode: "inline_ndjson", run_id: runId, total_slices: totalSlices, staged_rows: stagedRows, inflated_total_bytes: inflatedBytes, slice_rows: SLICE_ROWS, auto_chain: autoChain, stage_ms: Date.now() - startTime });
  }

  // ========================================================================
  // PROCESS — apply one slice, advance the cursor, chain the next (or finalize)
  // ========================================================================
  if (effectiveMode === "process") {
    const { data: metaRow, error: metaErr } = await supa.from("import_run_state").select("meta").eq("run_id", runId).eq("kind", "meta").eq("key", "").maybeSingle();
    if (metaErr || !metaRow || !metaRow.meta) {
      await recordImportStatus(supa, retailerId, "error", `process: run_state meta missing for run ${runId}`);
      return jsonResponse({ error: "run_state meta missing", run_id: runId }, 410);
    }
    const meta = metaRow.meta;
    const totalSlices = typeof meta.total_slices === "number" ? meta.total_slices : 0;
    const runStartedAtIso = meta.run_started_at || new Date().toISOString();
    const priorCreatesEnqueued = typeof meta.creates_enqueued === "number" ? meta.creates_enqueued : 0;
    // Download this slice's file
    const { data: sliceBlob, error: sliceErr } = await supa.storage.from(STAGING_BUCKET).download(slicePath(runId, sliceIndex));
    if (sliceErr || !sliceBlob) {
      await recordImportStatus(supa, retailerId, "error", `process: slice file missing (${slicePath(runId, sliceIndex)}): ${String(sliceErr?.message || sliceErr || "unknown")}`);
      return jsonResponse({ error: "slice file missing", run_id: runId, slice_index: sliceIndex }, 410);
    }
    let sliceText;
    try {
      sliceText = await sliceBlob.text();
    } catch (e) {
      await recordImportStatus(supa, retailerId, "error", `process: slice read failed: ${String(e)}`);
      return jsonResponse({ error: "slice read failed", run_id: runId, slice_index: sliceIndex, details: String(e).substring(0, 500) }, 500);
    }
    // Re-derive all match maps from the COMMITTED DB (this is what makes a product
    // created/linked by an earlier slice visible here — cross-slice exactly-once).
    const builtP = await buildContext(supa, config, retailerId);
    if (!builtP.ok) {
      await recordImportStatus(supa, retailerId, "error", builtP.error);
      return jsonResponse({ error: builtP.error, run_id: runId, slice_index: sliceIndex }, 500);
    }
    const ctxP = builtP.ctx;
    const acc = makeAcc();
    for (const line of sliceText.split("\n")){
      const t = line.trim();
      if (!t) continue;
      try {
        classify(JSON.parse(t), ctxP, acc);
      } catch  {
        acc.countParseErrors++;
      }
    }
    // Global create cap across the whole run. Superdrug is a stable catalogue so
    // this effectively never binds; it is a runaway safety valve.
    let capped = 0;
    if (priorCreatesEnqueued + acc.createActions.length > CREATE_CAP) {
      const allowed = Math.max(0, CREATE_CAP - priorCreatesEnqueued);
      capped = acc.createActions.length - allowed;
      acc.createActions.length = allowed;   // truncate; skip the overflow creates
    }
    const applied = await applyActions(supa, retailerId, acc, { runStartedAtIso, lowestUpsert: true });
    // Merge this slice's tallies into the run meta.
    const prevCounts = (meta.counts && typeof meta.counts === "object") ? meta.counts : {};
    const sliceCounts = buildCounts(acc);
    const mergedCounts: Record<string, number> = { ...prevCounts };
    for (const k of Object.keys(sliceCounts)) mergedCounts[k] = (mergedCounts[k] || 0) + sliceCounts[k];
    const prevApplied = (meta.applied && typeof meta.applied === "object") ? meta.applied : { updates: 0, links: 0, creates: 0, capped: 0, errors: [] };
    const mergedApplied = {
      updates: (prevApplied.updates || 0) + applied.updatesApplied,
      links: (prevApplied.links || 0) + applied.linksApplied,
      creates: (prevApplied.creates || 0) + applied.createsApplied,
      capped: (prevApplied.capped || 0) + capped,
      errors: [ ...(Array.isArray(prevApplied.errors) ? prevApplied.errors : []), ...applied.errors ].slice(0, 20)
    };
    const nextSlice = sliceIndex + 1;
    const isLast = nextSlice >= totalSlices;
    // Persist cursor + tallies. The BEFORE-UPDATE trigger bumps updated_at, which
    // the watchdog uses to detect a stalled run.
    const { error: updErr } = await supa.from("import_run_state").update({
      meta: { ...meta, counts: mergedCounts, applied: mergedApplied, creates_enqueued: priorCreatesEnqueued + applied.createsApplied, next_slice: isLast ? totalSlices : nextSlice }
    }).eq("run_id", runId).eq("kind", "meta").eq("key", "");
    if (updErr) {
      // Do not chain if we could not record progress — a re-fire would repeat this
      // slice (idempotent) rather than skip ahead.
      await recordImportStatus(supa, retailerId, "error", `process: run_state update failed (slice ${sliceIndex}): ${updErr.message}`);
      return jsonResponse({ error: "run_state update failed", run_id: runId, slice_index: sliceIndex, details: updErr.message }, 500);
    }
    const sliceResult: Record<string, unknown> = {
      mode: "process", run_id: runId, slice_index: sliceIndex, total_slices: totalSlices,
      is_last: isLast, slice_rows_in_file: acc.feedRows, capped_this_slice: capped,
      slice_counts: sliceCounts,
      slice_applied: { updates_applied: applied.updatesApplied, links_applied: applied.linksApplied, creates_applied: applied.createsApplied, error_count: applied.errors.length, sample_errors: applied.errors.slice(0, 10) },
      slice_ms: Date.now() - startTime
    };
    if (!isLast) {
      await recordImportStatus(supa, retailerId, "running", `processing slice ${nextSlice}/${totalSlices} (run ${runId})`);
      if (autoChain) {
        const { error: trigErr } = await supa.rpc("fmb_invoke_import_slice", { p_body: { fn: SELF_FN, retailer_id: retailerId, run_id: runId, mode: "process", slice_index: nextSlice, dry_run: false, slice_rows: SLICE_ROWS } });
        if (trigErr) {
          // Leave status 'running' so the watchdog re-fires next_slice.
          sliceResult.chain_error = trigErr.message;
        }
      }
      return jsonResponse(sliceResult);
    }
    // LAST slice — finalize the run.
    const runHadError = mergedApplied.errors.length > 0 || mergedApplied.capped > 0;
    await supa.from("retailer_import_config").update({
      last_imported_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(),
      last_import_status: runHadError ? "error" : "ok",
      last_import_error: runHadError ? ([mergedApplied.capped > 0 ? `capped ${mergedApplied.capped} creates` : null, ...mergedApplied.errors.slice(0, 5)].filter(Boolean).join("; ").slice(0, 1000)) : null
    }).eq("retailer_id", retailerId);
    const absenceReport = await finaliseRun(supa, {
      retailerId, runStartedAt: runStartedAtIso, startTimeMs: startTime, hadError: runHadError,
      feedRows: meta.staged_rows ?? mergedCounts.would_update_existing ?? 0,
      matched: mergedApplied.updates,
      inserted: mergedApplied.links + mergedApplied.creates,
      counts: mergedCounts,
      errorMessage: runHadError ? mergedApplied.errors.slice(0, 3).join("; ").slice(0, 500) : null,
    });
    // Cleanup: remove slice files + run_state (best-effort; the 24h orphan reaper
    // and watchdog are the backstop if this fails).
    try {
      const paths = Array.from({ length: totalSlices }, (_, i)=>slicePath(runId, i));
      await supa.storage.from(STAGING_BUCKET).remove(paths);
    } catch  {}
    try {
      await supa.from("import_run_state").delete().eq("run_id", runId);
    } catch  {}
    sliceResult.applied = { final: true, updates_applied: mergedApplied.updates, links_applied: mergedApplied.links, creates_applied: mergedApplied.creates, capped: mergedApplied.capped, error_count: mergedApplied.errors.length, sample_errors: mergedApplied.errors.slice(0, 10) };
    sliceResult.run_counts = mergedCounts;
    return jsonResponse(sliceResult);
  }

  // ========================================================================
  // SINGLE — legacy whole-feed path (all dry-runs, non-sliced retailers)
  // ========================================================================
  if (!dryRun) {
    // §7 silent-staleness: stamp 'running' before any feed work so a hard kill
    // leaves the row at 'running' (monitor-retailer-feeds flags a mid-flight death).
    await recordImportStatus(supa, retailerId, "running", null);
  }
  const built = await buildContext(supa, config, retailerId);
  if (!built.ok) {
    await recordImportStatus(supa, retailerId, "error", built.error);
    return jsonResponse({ error: built.error }, 500);
  }
  const ctx = built.ctx;
  const acc = makeAcc();
  // Download + stream-process the whole feed line by line.
  const fetchT0 = Date.now();
  const { data: storageBlob, error: storageErr } = await supa.storage.from(feedBucket).download(feedPath);
  if (storageErr || !storageBlob) {
    await recordImportStatus(supa, retailerId, "error", `Storage download failed (${feedBucket}/${feedPath}): ${String(storageErr?.message || storageErr || "unknown")}`);
    return jsonResponse({ error: "Failed to download feed from Storage", bucket: feedBucket, path: feedPath, details: String(storageErr?.message || storageErr || "unknown").substring(0, 500) }, 502);
  }
  const isGzipped = feedPath.endsWith(".gz");
  const blobStream = storageBlob.stream();
  const sourceStream = isGzipped ? blobStream.pipeThrough(new DecompressionStream("gzip")) : blobStream;
  const textStream = sourceStream.pipeThrough(new TextDecoderStream("utf-8"));
  const reader = textStream.getReader();
  let lineBuffer = "";
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
          classify(JSON.parse(line), ctx, acc);
        } catch (e) {
          acc.countParseErrors++;
        }
      }
    }
    if (lineBuffer.trim()) {
      try {
        classify(JSON.parse(lineBuffer.trim()), ctx, acc);
      } catch (e) {
        acc.countParseErrors++;
      }
    }
  } catch (e) {
    await recordImportStatus(supa, retailerId, "error", `Stream read failed: ${String(e)}`);
    return jsonResponse({ error: "Stream read failed", details: String(e).substring(0, 500), rows_processed_so_far: acc.feedRows }, 500);
  }
  const fetchMs = Date.now() - fetchT0;
  if (acc.feedRows < 50) {
    await recordImportStatus(supa, retailerId, "error", `Feed contains fewer than 50 products (${acc.feedRows}) — likely partial upload or wrong feed`);
    return jsonResponse({ error: "Feed contains fewer than 50 products — aborting (likely partial upload or wrong feed)", products_found: acc.feedRows, parse_errors: acc.countParseErrors }, 502);
  }
  // Safety cap — 20K creates in one run.
  if (acc.countCreateNew > CREATE_CAP) {
    if (!dryRun) {
      await recordImportStatus(supa, retailerId, "error", `Would create more than ${CREATE_CAP} new products (${acc.countCreateNew}) in one run — aborting as a safety cap`);
    }
    return jsonResponse({
      error: `Would create more than ${CREATE_CAP} new products in one run — aborting as a safety cap`,
      retailer_id: retailerId, feed_format: "rakuten_xml", feed_total_rows: acc.feedRows,
      counts: buildCounts(acc), v6_top_category_breakdown: acc.v6TopCategoryBreakdown,
      v6_exclusion_breakdown: acc.v6ExclusionBreakdown, sample_v6_excluded: acc.sampleV6Excluded,
      sample_excluded_by_category: acc.sampleExcluded, sample_link_to_existing: acc.sampleLinkExisting,
      sample_create_new: acc.sampleCreateNew, sample_raw_category_data: acc.sampleRawCategoryData
    }, 200);
  }
  const unmatchedLowFreq = Array.from(acc.unmatchedBrandCounts.entries()).filter(([, n]) => n < 5).sort((a, b) => b[1] - a[1]).slice(0, 100).map(([brand, count]) => ({ brand, count }));
  if (unmatchedLowFreq.length) console.log(`brand_canonicalisation: ${unmatchedLowFreq.length} low-freq unmatched brands (<5 rows) for review`);
  const result: Record<string, unknown> = {
    retailer_id: retailerId, feed_format: "rakuten_xml", match_column_used: config.match_column,
    dry_run: dryRun, feed_total_rows: acc.feedRows, feed_parse_ms: fetchMs,
    counts: buildCounts(acc), v6_top_category_breakdown: acc.v6TopCategoryBreakdown,
    v6_exclusion_breakdown: acc.v6ExclusionBreakdown,
    brand_canonicalisation: { alias_map_size: ctx.brandAliasMap.size, rows_canonicalised: acc.countBrandCanonicalised, distinct_unmatched_brands: acc.unmatchedBrandCounts.size, unmatched_lowfreq_sample: unmatchedLowFreq },
    sample_v6_excluded: acc.sampleV6Excluded, sample_excluded_by_category: acc.sampleExcluded,
    sample_link_to_existing: acc.sampleLinkExisting, sample_create_new: acc.sampleCreateNew,
    sample_raw_category_data: acc.sampleRawCategoryData, duration_ms_so_far: Date.now() - startTime
  };
  if (dryRun) return jsonResponse(result);
  // APPLY — single path keeps the legacy plain link upsert (lowestUpsert=false).
  // Anchor on the request's own start, not "now": rows written during this run
  // must never read as older than the run when absence handling compares them.
  const singleRunStartedAt = new Date(startTime).toISOString();
  const applied = await applyActions(supa, retailerId, acc, { runStartedAtIso: singleRunStartedAt, lowestUpsert: false });
  await supa.from("retailer_import_config").update({
    last_imported_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(),
    last_import_status: applied.errors.length > 0 ? "error" : "ok",
    last_import_error: applied.errors.length > 0 ? applied.errors.slice(0, 5).join("; ").slice(0, 1000) : null
  }).eq("retailer_id", retailerId);
  const absenceReport = await finaliseRun(supa, {
    retailerId, runStartedAt: singleRunStartedAt, startTimeMs: startTime, hadError: applied.errors.length > 0,
    feedRows: acc.feedRows,
    matched: applied.updatesApplied,
    inserted: applied.linksApplied + applied.createsApplied,
    counts: buildCounts(acc),
    errorMessage: applied.errors.length > 0 ? applied.errors.slice(0, 3).join("; ").slice(0, 500) : null,
  });
  result.applied = { updates_applied: applied.updatesApplied, links_applied: applied.linksApplied, creates_applied: applied.createsApplied, error_count: applied.errors.length, sample_errors: applied.errors.slice(0, 10), absence: absenceReport };
  result.duration_ms = Date.now() - startTime;
  return jsonResponse(result);
});
