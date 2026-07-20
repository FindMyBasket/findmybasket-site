/**
 * READ-ONLY diagnosis of the Atelier De Glow AWIN Darwin feed (fid 119037).
 * Fetches the Darwin (Google-Shopping) CSV, and reports:
 *   1. brand distribution (retailer-vs-brand shape)
 *   2. category mix + K-beauty signal
 *   3. overlap vs our catalogue (deepens existing comparison / same-brand new SKU / net-new)
 *
 * Usage:  FEED_URL='https://ui.awin.com/productdata-darwin-download/.../fid/119037/...' \
 *         npx tsx scripts/atelier-feed-diag.mts
 *   or:   npx tsx scripts/atelier-feed-diag.mts '<url>'
 *   or:   FEED_FILE=./atelier.csv npx tsx scripts/atelier-feed-diag.mts   (already-decompressed CSV)
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { buildMatchKey, normaliseForMatch } from "../supabase/functions/_shared/match-key.ts";

// Credentials come from the process environment when present (CI), falling back
// to .env.local for local runs. CI has no .env.local, so reading it
// unconditionally would throw before the diagnosis starts.
function loadEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync("./.env.local", "utf8").split(/\n/).filter((l) => l.includes("="))
        .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
    );
  } catch { return {}; }
}
const env = loadEnv();
const SB_URL = process.env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SB_URL || !SB_KEY) throw new Error("Need SUPABASE_URL + SUPABASE_KEY (or .env.local NEXT_PUBLIC_* pair).");
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ---- 1. Load the feed CSV (gz URL, or plain file) ----
async function loadFeed(): Promise<string> {
  const file = process.env.FEED_FILE;
  if (file) return readFileSync(file, "utf8");
  const url = process.env.FEED_URL || process.argv[2];
  if (!url) throw new Error("Provide FEED_URL env or arg (the Darwin download URL for fid 119037).");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`feed fetch ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // gzip magic 0x1f 0x8b
  if (buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf).toString("utf8");
  return buf.toString("utf8");
}

// ---- CSV parser (quoted fields, embedded commas/newlines, BOM) ----
function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c === "\r") { /* skip */ }
      else cell += c;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const raw = await loadFeed();
const table = parseCsv(raw);
const header = table[0].map((h) => h.trim());
const body = table.slice(1).filter((r) => r.length > 1);
const col = (name: string) => header.indexOf(name);
const get = (r: string[], name: string) => { const i = col(name); return i >= 0 ? (r[i] ?? "").trim() : ""; };

console.log("=== FEED SHAPE ===");
console.log("rows (products):", body.length);
console.log("columns:", header.join(", "));

// ---- 1. Brand distribution ----
const brandField = col("brand") >= 0 ? "brand" : (col("brand_name") >= 0 ? "brand_name" : "brand");
const brandCounts = new Map<string, number>();
for (const r of body) { const b = get(r, brandField) || "(blank)"; brandCounts.set(b, (brandCounts.get(b) || 0) + 1); }
const brandsSorted = [...brandCounts.entries()].sort((a, b) => b[1] - a[1]);
console.log("\n=== 1. BRAND DISTRIBUTION ===");
console.log("distinct brands:", brandsSorted.length);
const top1Share = brandsSorted.length ? (brandsSorted[0][1] / body.length * 100).toFixed(1) : "0";
console.log(`top brand share: ${brandsSorted[0]?.[0]} = ${brandsSorted[0]?.[1]} (${top1Share}%)`);
console.log("verdict:", brandsSorted.length <= 2 ? "SINGLE-BRAND (brand selling direct)" :
  Number(top1Share) > 80 ? "DOMINANT-BRAND (mostly one brand)" : "MULTI-BRAND RETAILER");
console.log("top 25 brands:");
for (const [b, n] of brandsSorted.slice(0, 25)) console.log(`  ${String(n).padStart(4)}  ${b}`);

// ---- 2. Category mix + K-beauty ----
console.log("\n=== 2. CATEGORY MIX ===");
// Darwin feeds carry google_product_category/product_type; LEGACY AWIN CSV
// carries merchant_product_category_path/category_name instead. Without the
// legacy names the category mix comes back entirely "(blank)".
const catField = ["google_product_category", "product_type", "merchant_product_category_path", "category_name"]
  .find((c) => col(c) >= 0) ?? "product_type";
console.log(`(category field in use: ${catField})`);
const catCounts = new Map<string, number>();
for (const r of body) { const c = get(r, catField) || "(blank)"; catCounts.set(c, (catCounts.get(c) || 0) + 1); }
for (const [c, n] of [...catCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${String(n).padStart(4)}  ${c}`);

// crude beauty/skincare keyword signal over title+category+product_type
const beautyRe = /(serum|cream|cleanser|toner|moisturis|spf|sunscreen|essence|ampoule|mask|foundation|lipstick|mascara|concealer|blush|skincare|skin care|makeup|make-up|cosmetic|fragrance|perfume|shampoo|conditioner|balm|exfoliat|retinol|niacinamide|hyaluronic)/i;
let beautyHits = 0;
for (const r of body) {
  // include product_name so LEGACY feeds (no `title` column) still register
  const blob = `${get(r, "title")} ${get(r, "product_name")} ${get(r, catField)} ${get(r, "product_type")}`;
  if (beautyRe.test(blob)) beautyHits++;
}
console.log(`beauty/skincare keyword hits: ${beautyHits}/${body.length} (${(beautyHits / body.length * 100).toFixed(0)}%)`);

// ---- 2b. Fragrance share ----
// Fragrance is gated off in the categoriser (EXTENDED_CATEGORIES_ENABLED=false),
// so fragrance rows import but never surface on the site. A large fragrance
// block is therefore dead weight until that flag flips, and needs sizing before
// onboarding rather than after.
const fragranceRe = /(eau de parfum|eau de toilette|eau de cologne|\bedp\b|\bedt\b|\bedc\b|aftershave|after shave|parfum|cologne|fragrance mist|body mist)/i;
let fragranceHits = 0;
const fragranceBrands = new Map<string, number>();
for (const r of body) {
  const blob = `${get(r, "title")} ${get(r, "product_name")} ${get(r, catField)}`;
  if (!fragranceRe.test(blob)) continue;
  fragranceHits++;
  const b = get(r, brandField) || "(blank)";
  fragranceBrands.set(b, (fragranceBrands.get(b) || 0) + 1);
}
const fragPct = (fragranceHits / body.length * 100);
console.log(`\nFRAGRANCE share: ${fragranceHits}/${body.length} (${fragPct.toFixed(1)}%)`);
console.log(fragPct >= 20
  ? "  WARNING: large fragrance block — imports but does NOT surface while EXTENDED_CATEGORIES_ENABLED=false"
  : "  (fragrance block is small enough not to dominate the import)");
for (const [b, n] of [...fragranceBrands.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(4)}  ${b}`);
}

// K-beauty: cross-ref feed brands against brands we already carry under K-beauty retailers (11 Stylevana, 25 YesStyle, 7 Skin Cupid)
const { data: krows } = await sb.from("retailer_prices").select("product_id").in("retailer_id", [7, 11, 25]).limit(100000);
const kProductIds = new Set((krows || []).map((x: any) => x.product_id));
const kbBrandSet = new Set<string>();
if (kProductIds.size) {
  const ids = [...kProductIds];
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await sb.from("products").select("id, brand").in("id", ids.slice(i, i + 500));
    for (const p of (data || []) as any[]) if (p.brand) kbBrandSet.add(normaliseForMatch(p.brand));
  }
}
const feedKbBrands = brandsSorted.filter(([b]) => kbBrandSet.has(normaliseForMatch(b)));
console.log(`\nK-beauty signal: ${feedKbBrands.length} feed brand(s) also sold by our K-beauty retailers (Stylevana/YesStyle/Skin Cupid):`);
for (const [b, n] of feedKbBrands.slice(0, 20)) console.log(`  ${String(n).padStart(4)}  ${b}`);

// ---- 3. Overlap vs our catalogue ----
console.log("\n=== 3. OVERLAP vs CATALOGUE ===");
// live products_active: id, match_key, brand
const liveKeys = new Set<string>(); const liveBrands = new Set<string>();
for (let off = 0; ; off += 1000) {
  const { data } = await sb.from("products_active").select("match_key, brand").order("id").range(off, off + 999);
  if (!data?.length) break;
  for (const p of data as any[]) { if (p.match_key) liveKeys.add(p.match_key); if (p.brand) liveBrands.add(normaliseForMatch(p.brand)); }
  if (data.length < 1000) break;
}
// all products (incl hidden) match_keys
const allKeys = new Set<string>();
for (let off = 0; ; off += 1000) {
  const { data } = await sb.from("products").select("match_key").order("id").range(off, off + 999);
  if (!data?.length) break;
  for (const p of data as any[]) if (p.match_key) allKeys.add(p.match_key);
  if (data.length < 1000) break;
}

let tierDeepenLive = 0, tierDeepenAny = 0, tierSameBrandNew = 0, tierNetNew = 0;
const netNewBrandCounts = new Map<string, number>();
for (const r of body) {
  const brand = get(r, brandField); const name = get(r, "title") || get(r, "product_name");
  if (!name) continue;
  const mk = buildMatchKey(brand || "", name);
  const nb = normaliseForMatch(brand || "");
  if (liveKeys.has(mk)) tierDeepenLive++;             // matches a LIVE comparison page -> adds an offer
  else if (allKeys.has(mk)) tierDeepenAny++;          // matches a hidden/merged row
  else if (liveBrands.has(nb)) tierSameBrandNew++;    // same brand we carry, new SKU -> enriches brand page
  else { tierNetNew++; netNewBrandCounts.set(brand || "(blank)", (netNewBrandCounts.get(brand || "(blank)") || 0) + 1); }
}
console.log(`A. deepen LIVE comparison (match_key hits products_active):   ${tierDeepenLive}`);
console.log(`B. match a hidden/merged row (match_key in products only):    ${tierDeepenAny}`);
console.log(`C. same-brand NEW sku (brand carried, no product match):      ${tierSameBrandNew}`);
console.log(`D. NET-NEW (brand we don't carry at all):                     ${tierNetNew}`);
const feedBrandsWeCarry = brandsSorted.filter(([b]) => liveBrands.has(normaliseForMatch(b)));
console.log(`\nfeed brands we already carry (live): ${feedBrandsWeCarry.length}/${brandsSorted.length}`);
for (const [b, n] of feedBrandsWeCarry.slice(0, 25)) console.log(`  ${String(n).padStart(4)}  ${b}`);
