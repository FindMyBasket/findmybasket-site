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
// Section 5 sizes admissions with THE SHIPPED RULE, not a copy of it. See the
// comment at section 5 for why: the Boots ~900 was produced by a local v1.0
// reimplementation that had already diverged from what the importer does.
import { isSupplementPathTopical } from "../supabase/functions/_shared/categorisation.ts";

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

// === 0. FIELD QUALITY =======================================================
// Fill rate for every requested column, and explicitly for the sibling pairs.
//
// Why the pairs matter: AWIN exposes more than one column per concept and
// advertisers disagree about which to populate. The importer requests `ean` and
// never `product_GTIN`, and five active retailers sit at exactly 0.0% EAN across
// 56,821 rows while six sit at 98.8-100%. If the GTIN side of the pair is
// populated on those feeds, that is an importer column-name bug, not an
// advertiser data gap, and EAN is the strongest matching signal we have.
{
  const fill = (name: string) => {
    if (col(name) < 0) return null;
    const n = body.filter((r) => get(r, name) !== "").length;
    return { n, pct: body.length ? (n / body.length) * 100 : 0 };
  };
  const line = (name: string) => {
    const f = fill(name);
    if (!f) return `  ${name.padEnd(34)}  COLUMN NOT RETURNED`;
    return `  ${name.padEnd(34)}  ${String(f.n).padStart(6)}  ${f.pct.toFixed(1).padStart(5)}%`;
  };

  console.log("\n=== 0. FIELD QUALITY (fill rate, % of rows) ===");
  for (const c of [
    "product_name", "brand_name", "aw_deep_link", "merchant_deep_link",
    "merchant_image_url", "search_price", "store_price", "rrp_price", "in_stock",
    "mpn",
  ]) console.log(line(c));

  console.log("\n  -- sibling pairs: which half does this advertiser populate? --");
  const pairs: [string, string][] = [
    ["ean", "product_GTIN"],
    ["merchant_category", "merchant_product_category_path"],
    ["category_name", "product_type"],
  ];
  for (const [a, b] of pairs) {
    console.log(line(a));
    console.log(line(b));
    const fa = fill(a), fb = fill(b);
    const pa = fa?.pct ?? 0, pb = fb?.pct ?? 0;
    let verdict: string;
    if (pa < 1 && pb < 1) verdict = `NEITHER populated — genuinely absent from this feed`;
    else if (pa >= 1 && pb < 1) verdict = `only "${a}" populated`;
    else if (pb >= 1 && pa < 1) verdict = `only "${b}" populated — IMPORTER READS "${a}", SO THIS IS LOST`;
    else verdict = `both populated (${a} ${pa.toFixed(1)}%, ${b} ${pb.toFixed(1)}%)`;
    console.log(`    -> ${verdict}\n`);
  }

  const eanF = fill("ean"), gtinF = fill("product_GTIN");
  const bearing = Math.max(eanF?.pct ?? 0, gtinF?.pct ?? 0);
  console.log(`  VERDICT: ${bearing >= 50 ? "EAN-BEARING" : (fill("mpn")?.pct ?? 0) >= 50 ? "MPN-ONLY" : "NEITHER"}` +
    ` (best barcode coverage ${bearing.toFixed(1)}%, mpn ${(fill("mpn")?.pct ?? 0).toFixed(1)}%)`);
}

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
// Pick the first candidate that EXISTS **and carries data**. Picking on
// existence alone silently produced a 100%-blank category mix on both legacy
// feeds diagnosed so far (Gorgeous Shop fid 110188, Counter Culture fid 95461):
// each declares merchant_product_category_path and leaves it empty on every
// row, while category_name holds the real values.
const CAT_CANDIDATES = ["google_product_category", "product_type", "merchant_product_category_path", "category_name"];
const catField = CAT_CANDIDATES.find((c) => col(c) >= 0 && body.some((r) => get(r, c) !== ""))
  ?? CAT_CANDIDATES.find((c) => col(c) >= 0)
  ?? "product_type";
console.log(`(category field in use: ${catField}${col(catField) < 0 ? " — ABSENT" : body.some((r) => get(r, catField) !== "") ? "" : " — present but EMPTY on every row"})`);
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

// === 4. IMPORT-PATH AUDIT ============================================================
// WHY THIS SECTION EXISTS. `retailer_import_config.category_path_must_contain` is an
// ALLOWLIST matched against `merchant_product_category_path`. Boots drops ~13,750 rows a
// run through it. Section 2 above reports whichever category field has the best fill,
// which for most feeds is `product_type` or `merchant_category` — DIFFERENT FIELDS with
// DIFFERENT TAXONOMIES. So the decision that discards a third of a feed has been keyed on
// a column no diagnostic printed, and "what are we excluding?" was unanswerable.
//
// Prints the excluded population grouped by the field the allowlist actually reads, and
// cross-tabs it against the supplements definition (docs/supplements-definition.md v1.0)
// so "surgical or wholesale" can be decided from counts rather than argued.
{
  const ALLOW = (process.env.MUST_CONTAIN || "").split("|").map(s => s.trim()).filter(Boolean);
  const pathCol = col("merchant_product_category_path");
  if (pathCol < 0) {
    console.log("\n=== 4. IMPORT-PATH AUDIT ===\n  feed has no merchant_product_category_path column — allowlist would drop everything");
  } else if (!ALLOW.length) {
    console.log("\n=== 4. IMPORT-PATH AUDIT ===\n  set MUST_CONTAIN='A|B|C' to audit an allowlist");
  } else {
    // Definition v1.0, Rule 1 + Rule 2. Tokens deliberately match the committed file.
    const FORM = /\b(supplement|supplements|multivitamin|probiotic|prebiotic|capsules|tablets|softgels|gummies|effervescent|lozenges)\b/i;
    const BOUND = /\b(collagen|biotin|keratin)\b[^,]{0,30}\b(powder|drink|sachets|shots)\b|\b(powder|drink|sachets|shots)\b[^,]{0,30}\b(collagen|biotin|keratin)\b/i;
    const TOPICAL = /\b(serum|cream|lotion|balm|butter|mask|masque|gel|oil|spray|mist|toner|essence|cleanser|shampoo|conditioner|scrub|peel|patch|patches|candle|diffuser|perfume|eau de|deodorant|soap|wash|foundation|lipstick|mascara|primer|concealer|polish|varnish|ampoule|booster|tint|highlighter)\b/i;
    const SPORT = /\b(protein|whey|creatine|pre-?workout|bcaa|electrolyte|sports)\b/i;
    const isSupp = (n: string) => (FORM.test(n) || BOUND.test(n)) && !TOPICAL.test(n);

    const excluded = body.filter(r => {
      const p = (r[pathCol] ?? "").trim();
      return !ALLOW.some(a => p.includes(a));
    });
    const byPath = new Map<string, { n: number; supp: number; sport: number }>();
    for (const r of excluded) {
      const p = ((r[pathCol] ?? "").trim()) || "(empty path)";
      const nm = get(r, "product_name");
      const e = byPath.get(p) ?? { n: 0, supp: 0, sport: 0 };
      e.n++; if (isSupp(nm)) e.supp++; if (SPORT.test(nm)) e.sport++;
      byPath.set(p, e);
    }
    const tot = excluded.length;
    const totSupp = [...byPath.values()].reduce((a, b) => a + b.supp, 0);
    const totSport = [...byPath.values()].reduce((a, b) => a + b.sport, 0);
    console.log("\n=== 4. IMPORT-PATH AUDIT (allowlist: " + ALLOW.join(" | ") + ") ===");
    console.log("  feed rows            :", body.length);
    console.log("  EXCLUDED by allowlist:", tot, "(" + (100 * tot / body.length).toFixed(1) + "%)");
    console.log("  of the excluded — supplements per definition v1.0:", totSupp,
                "(" + (100 * totSupp / Math.max(tot, 1)).toFixed(1) + "%)");
    console.log("  of the excluded — sports-nutrition-shaped        :", totSport);
    console.log("  NON-supplement excluded rows                    :", tot - totSupp);
    console.log("\n  excluded paths, by volume (supp = supplements v1.0 within that path):");
    for (const [p, e] of [...byPath.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 30)) {
      console.log("   " + String(e.n).padStart(6) + "  supp " + String(e.supp).padStart(5) + "  " + p.slice(0, 86));
    }
    // Concentration: how many paths hold the supplements, and where the tail starts.
    const suppPaths = [...byPath.entries()].filter(([, e]) => e.supp > 0).sort((a, b) => b[1].supp - a[1].supp);
    console.log("\n  paths containing ANY supplement:", suppPaths.length);
    let run = 0;
    suppPaths.slice(0, 12).forEach(([p, e], i) => {
      run += e.supp;
      console.log("   " + String(i + 1).padStart(2) + ". " + String(e.supp).padStart(5) +
                  "  cum " + (100 * run / Math.max(totSupp, 1)).toFixed(1) + "%  " + p.slice(0, 76));
    });
    console.log("  -> top 12 paths cover " + (100 * run / Math.max(totSupp, 1)).toFixed(1) + "% of supplements");
  }
}

// === 5. ADMISSION PREVIEW ===========================================================
// Answers the two questions that decide a path-allowlist change BEFORE it is made:
//   (a) what ELSE arrives if a branch is admitted, grouped to 3 path segments, and
//   (b) whether EXCLUDE_PATTERNS.supplements would then drop what the path admits.
//
// (b) matters because the two switches fight. Opening the path lets supplements in;
// the shared code constant then removes a slice of them, and the category launches with
// a hole shaped like whatever that regex happens to catch. Deciding them separately is
// how that hole gets shipped.
{
  const pathCol = col("merchant_product_category_path");
  const PREFIX = (process.env.ADMIT_PREFIX || "").split("|").map(s => s.trim()).filter(Boolean);
  if (pathCol >= 0 && PREFIX.length) {
    // The live shared constant, copied verbatim from _shared/categorisation.ts.
    const EXCLUDE_SUPP = /\b(supplement|vitamin tablet|capsule|gummies|protein shake|meal replacement|powder drink|fish oil|cod liver oil|effervescent tablet)\b/i;
    // THE SHIPPED RULE, IMPORTED. Not a copy — this used to be a local
    // reimplementation of definition v1.0 and it is what produced the Boots sizing
    // (3,115 admitted / 936 supplement-shaped / 2,179 alongside, 12 Aug 2026).
    //
    // WHAT THE COPY GOT WRONG, both errors pushing the supplement count DOWN and
    // the "arriving alongside" count UP:
    //
    //   1. NO SPORTS TOKENS. Sports nutrition moved into scope on 10 Aug 2026, two
    //      days BEFORE that measurement. The whole MyProtein / Optimum Nutrition
    //      population that item 72's brand allowlist exists to route to `sports`
    //      was counted as non-supplement.
    //   2. IT VETOED DOSAGE FORMS AS TOPICALS. Its veto list held `oil`, `gel`,
    //      `butter`, `wash` — application words on a beauty path, dosage forms on a
    //      health one. "Seven Seas Evening Primrose Oil 30 Capsules" and "Boots IBS
    //      Relief 30 Soft Gel Capsules" were both subtracted from the 936.
    //
    // THE SHIPPED RULE DOES NOT WORK THAT WAY, and copying v1.1's APPLY list would
    // NOT have fixed it — that list still contains `oil` and `gel`. The path-first
    // branch uses the far narrower SUPP_TOPICAL_FORM (serum|toner|cream|lotion|
    // mask|shampoo|conditioner|moistur*|body spray) precisely because a row already
    // known to be on a supplements path needs a different question asked of it.
    // That is the substance of the feature, and a reimplementation could not have
    // captured it by regex-matching alone.
    //
    // So section 5 no longer reimplements: ON A SUPPLEMENTS PATH, A ROW IS A
    // SUPPLEMENT UNLESS THE SHIPPED TOPICAL TEST SAYS OTHERWISE. If the rule
    // changes, this number changes with it. Work-list item 88.
    const isSupp = (n: string) => !isSupplementPathTopical(n);

    console.log("\n=== 5. ADMISSION PREVIEW (prefix: " + PREFIX.join(" | ") + ") ===");
    const admitted = body.filter(r => { const p = (r[pathCol] ?? "").trim(); return PREFIX.some(x => p.startsWith(x)); });
    const supp = admitted.filter(r => isSupp(get(r, "product_name")));
    const clash = supp.filter(r => EXCLUDE_SUPP.test(get(r, "product_name")));
    console.log("  rows admitted by this prefix        :", admitted.length);
    console.log("  of those, supplements per SHIPPED rule:", supp.length);
    console.log("  ** of those supplements, EXCLUDE_PATTERNS.supplements would DROP:", clash.length,
                "(" + (100 * clash.length / Math.max(supp.length, 1)).toFixed(1) + "%) **");
    console.log("  topical rows arriving alongside      :", admitted.length - supp.length);
    const seg3 = new Map<string, number>();
    for (const r of admitted) {
      const k = ((r[pathCol] ?? "").split(">").slice(0, 3).map(x => x.trim()).join(" > ")) || "(empty)";
      seg3.set(k, (seg3.get(k) ?? 0) + 1);
    }
    console.log("\n  what arrives, grouped to 3 path segments:");
    for (const [k, n] of [...seg3.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log("   " + String(n).padStart(6) + "  " + k.slice(0, 84));
    }
    if (clash.length) {
      console.log("\n  sample of the supplements EXCLUDE_PATTERNS would drop:");
      clash.slice(0, 10).forEach(r => console.log("   x " + get(r, "product_name").slice(0, 80)));
    }

    // --- 5b. SIBLING TAXONOMY CROSS-TAB ---------------------------------------------
    //
    // WHY THIS EXISTS. Section 5 above groups the admitted rows by the path we FILTER
    // ON, and for Boots that path is flat: it terminates at "Vitamins & Supplements"
    // with no fifth segment, so grouping by it tells you nothing about what is inside.
    // Measured 16 Aug 2026 on fid 115009: 1,771 admitted rows, zero occurrences of
    // "Vitamins & Supplements >".
    //
    // BUT AN ADVERTISER SHIPS MORE THAN ONE TAXONOMY. Boots populates product_type on
    // 100.0% of 38,077 rows with a DIFFERENT and visibly richer hierarchy --
    // "Health & Pharmacy > Medicines & Treatments" (1,761 rows), "Health & Pharmacy >
    // Lifestyle & Wellbeing" (924), "Baby & Child > Feeding" (647). The importer reads
    // merchant_product_category_path and never product_type, so that hierarchy has
    // never been looked at.
    //
    // THIS IS THE PATH FINDING ON A SECOND FIELD: the retailer's own filing beating our
    // inference. If one of these columns separates medicines, paediatric and sports
    // inside the leaf, the subcategory set is DERIVED from it rather than from name
    // tokens -- and a name-token set leaves a 14% residual that no token list closes,
    // because the tail is long-tail single actives and opaque brand codes.
    //
    // The supplement-shaped count per value is the discriminating measure, not the row
    // count: a value is USEFUL when it is nearly all supplements or nearly none, and
    // useless when it splits down the middle.
    for (const field of ["product_type", "merchant_category", "category_name"]) {
      const fc = col(field);
      if (fc < 0) { console.log(`\n  [5b] ${field}: column not requested`); continue; }
      const filled = admitted.filter(r => (r[fc] ?? "").trim()).length;
      // Sports name tokens. INDEPENDENT of the shipped path rule, which is the point:
      // `supp` below cannot disagree with the path, this can.
      const SPORT_TOK = /\b(whey|casein|creatine|electrolyte|electrolytes|hydration|hydrate|isotonic|pre[\s-]?workout|bcaa|eaa|amino|glutamine|endurance|protein|isolate|gainer|energy gel)\b/i;
      const tab = new Map<string, { n: number; supp: number; sport: number }>();
      for (const r of admitted) {
        const k = ((r[fc] ?? "").trim()) || "(empty)";
        const e = tab.get(k) ?? { n: 0, supp: 0, sport: 0 };
        e.n++;
        const nm = get(r, "product_name");
        if (isSupp(nm)) e.supp++;
        if (SPORT_TOK.test(nm)) e.sport++;
        tab.set(k, e);
      }
      console.log(`\n  [5b] ADMITTED ROWS BY ${field}  (filled ${filled}/${admitted.length}` +
                  `, ${tab.size} distinct value(s))`);
      if (tab.size === 1) console.log("       -> SINGLE VALUE: this column cannot discriminate inside the leaf.");
      console.log("       cols: rows | supp = shipped rule (SEE CAUTION) | sport = sports name tokens");
      // FULL ENUMERATION, not a top-N. A prefix map inherits the tail from its parents,
      // so the question that decides the map is not "what are the big values" but
      // "does every value descend from a mapped parent". A truncated list cannot answer it.
      const SHOW = Number(process.env.TAXONOMY_ROWS || "30");
      for (const [k, e] of [...tab.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, SHOW)) {
        const pct = (100 * e.supp / Math.max(e.n, 1)).toFixed(0);
        console.log("   " + String(e.n).padStart(6) + "  supp " + String(e.supp).padStart(5) +
                    " (" + pct.padStart(3) + "%)  sport " + String(e.sport).padStart(4) +
                    "  " + k.slice(0, 66));
      }
      // CAUTION, printed next to the number it applies to rather than only in the work
      // list: the `supp` column is the SHIPPED RULE READING ITSELF. On a configured
      // supplements path a row is a supplement unless visibly topical, so it says
      // "supplement" for nearly everything here BY CONSTRUCTION, whatever this column
      // says. It is not a second signal agreeing. The discriminating power is in the
      // VALUES. `sport` IS independent -- it is name tokens, not the path rule.
      console.log("       CAUTION: `supp` is the shipped path rule reading itself, not a");
      console.log("                second signal agreeing. Discrimination is in the VALUES.");
    }

    // --- 5c. WHAT IS INSIDE A BARE PARENT NODE -------------------------------------
    //
    // A hierarchical column is only as useful as it is DEEP. For Boots two parent nodes
    // carry the majority of the leaf with no child node beneath them, so a mapping built
    // on this column groups them correctly and says nothing about what is in them. 5c
    // dumps names from the nodes named in BARE_NODES so that limit is visible in the
    // report rather than inferred from a count.
    const BARE = (process.env.BARE_NODES || "").split("|").map(s => s.trim()).filter(Boolean);
    const ptc = col("product_type");
    if (BARE.length && ptc >= 0) {
      const SPORT = /\b(whey|casein|creatine|electrolyte|electrolytes|hydration|hydrate|isotonic|pre[\s-]?workout|bcaa|eaa|amino|glutamine|endurance|protein|isolate|gainer|energy gel)\b/i;
      for (const node of BARE) {
        const rows = admitted.filter(r => (r[ptc] ?? "").trim() === node);
        const sport = rows.filter(r => SPORT.test(get(r, "product_name")));
        console.log(`\n  [5c] INSIDE "${node}"`);
        console.log(`       rows ${rows.length}, of which sports name tokens: ${sport.length}` +
                    ` (${(100 * sport.length / Math.max(rows.length, 1)).toFixed(0)}%)`);
        console.log("       -- sports-token names (up to 30) --");
        sport.slice(0, 30).forEach(r => console.log("        S " + get(r, "product_name").slice(0, 88)));
        console.log("       -- non-sports names (up to 30) --");
        rows.filter(r => !SPORT.test(get(r, "product_name"))).slice(0, 30)
            .forEach(r => console.log("        . " + get(r, "product_name").slice(0, 88)));
      }
    }
  }
}

// === 6. RULE VERDICT SAMPLE ==========================================================
// WHY: the supplements classification rule (docs/supplements-definition.md) was written
// and validated against CATALOGUE products — rows that have already been through
// categorisation, brand canonicalisation and, for some retailers, name reconstruction.
// The rows that arrive when a path allowlist opens have been through NONE of that. They
// are raw feed strings.
//
// A rule validated on cleaned data and applied to raw data is an untested rule. This
// prints its verdict on a random sample of the rows a proposed path change would admit,
// so the transfer can be checked BEFORE the config change rather than inferred after.
//
// Prints only. Set SAMPLE_PATHS to the paths under consideration.
{
  const pathCol = col("merchant_product_category_path");
  const PATHS = (process.env.SAMPLE_PATHS || "").split("|").map(s => s.trim()).filter(Boolean);
  const N = Number(process.env.SAMPLE_N || 40);
  if (pathCol >= 0 && PATHS.length) {
    // docs/supplements-definition.md v1.1 — form / application, with the default stated.
    const FORM = /\b(supplement|supplements|multivitamin|probiotic|prebiotic|capsules?|tablets?|softgels?|gummies|effervescent|lozenges?|whey|creatine|pre-?workout|bcaa|protein powder|protein shake|protein bar|mass gainer|electrolyte)\b/i;
    const APPLY = /\b(serum|cream|lotion|balm|butter|mask|masque|gel|oil|spray|mist|toner|essence|cleanser|cleansing|foam|sunscreen|spf|shampoo|conditioner|scrub|peel|patch|patches|candle|diffuser|perfume|eau de|deodorant|soap|wash|pack|foundation|lipstick|mascara|primer|concealer|polish|varnish|ampoule|booster|tint|highlighter)\b/i;
    // Truncation is the rule's only observed failure mode on the catalogue: the
    // application word exists and the feed cut it off. Flag, do not classify.
    const TRUNC = /(\s\S{1,3}|[a-z])$|\.\.\.$|…$|\s&$|\swith$/;

    const rows = body.filter(r => { const p = (r[pathCol] ?? "").trim(); return PATHS.some(x => p.startsWith(x)); });
    const verdict = (n: string) => {
      const f = FORM.test(n), a = APPLY.test(n);
      if (!f) return "not-a-supplement";
      if (a) return "topical (both signals)";
      return "SUPPLEMENT (default fired)";
    };
    const counts = new Map<string, number>();
    let trunc = 0;
    for (const r of rows) {
      const n = get(r, "product_name");
      counts.set(verdict(n), (counts.get(verdict(n)) ?? 0) + 1);
      if (TRUNC.test(n.trim())) trunc++;
    }
    console.log("\n=== 6. RULE VERDICT SAMPLE (paths: " + PATHS.join(" | ") + ") ===");
    console.log("  rows in those paths:", rows.length);
    for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log("   " + String(v).padStart(6) + "  " + k);
    }
    console.log("   " + String(trunc).padStart(6) + "  names that LOOK TRUNCATED (rule's known failure mode — review, do not trust)");
    console.log("\n  random sample for hand-checking (verdict | brand | name):");
    // Deterministic shuffle so a re-run of the same feed samples the same rows.
    const shuffled = rows.map((r, i) => ({ r, k: (i * 2654435761) % 4294967291 })).sort((a, b) => a.k - b.k).slice(0, N);
    for (const { r } of shuffled) {
      const n = get(r, "product_name");
      const flag = TRUNC.test(n.trim()) ? " [TRUNC?]" : "";
      console.log("   " + verdict(n).padEnd(26) + flag.padEnd(9) + " | " + get(r, "brand_name").slice(0, 22).padEnd(22) + " | " + n.slice(0, 72));
    }
  }
}

// === 7. REASSIGNMENT DETECTOR SIZING ==================================================
// WHY: work-list item 84. Sizes the reassignment detector's PRIMARY signal — the feed
// row's name against the stored product's name, zero token overlap — WITHOUT building
// the detector. This is the only honest measurement of its false-positive rate, because
// feed names are not retained: only one side of the comparison survives an import, so
// it cannot be reconstructed from stored data afterwards (item 47's retention point).
//
// The defect it exists to catch: commit a43e2ed. Stylevana reassigned
// merchant_product_id 112499 from an Isntree sunscreen to a Euthymol toothbrush set.
// Tier 0 matches on external_product_id and returns BEFORE the tier ladder, so it
// overwrote url, image_url and description while the sticky-EAN COALESCE preserved the
// old barcode. 121 rows share the shape, and 121 is a floor.
//
// EVERY ROW LANDS IN A NAMED BUCKET, and could-not-parse is REPORTED rather than
// filtered. That is item 84's general form: a guard that excludes is a guard that lies;
// a guard that categorises cannot. The previous attempt at this measurement used
// `WHERE n_slug > 0` and reported three retailers as clean when they were unexamined.
//
// Set REASSIGN_RETAILER_ID to the retailer whose feed this is. Read-only.
{
  const rid = Number(process.env.REASSIGN_RETAILER_ID || 0);
  const matchCol = process.env.REASSIGN_MATCH_COLUMN || "merchant_product_id";
  if (rid > 0) {
    const idIdx = col(matchCol);
    console.log("\n=== 7. REASSIGNMENT DETECTOR SIZING (retailer " + rid + ", match column " + matchCol + ") ===");
    if (idIdx < 0) {
      console.log("  feed has no " + matchCol + " column — cannot size");
    } else {
      // Stored side: external_product_id -> product name, for this retailer.
      const stored = new Map<string, string>();
      const storedIds = new Map<string, number>();
      let from = 0;
      for (;;) {
        const { data, error } = await sb
          .from("retailer_prices")
          .select("external_product_id, product_id, products!inner(name)")
          .eq("retailer_id", rid)
          .not("external_product_id", "is", null)
          .range(from, from + 999);
        if (error) { console.log("  stored-side read failed:", error.message); break; }
        if (!data || !data.length) break;
        for (const r of data as any[]) {
          const k = String(r.external_product_id ?? "").trim();
          const nm = r.products?.name;
          if (k && typeof nm === "string" && nm) {
            stored.set(k, nm);
            if (r.product_id != null) storedIds.set(k, Number(r.product_id));
          }
        }
        if (data.length < 1000) break;
        from += 1000;
      }
      console.log("  stored rows with an ext id and a product name:", stored.size);

      // Tokens: alphabetic, length >= 3, so sizes and ids can never create overlap.
      //
      // PLUS ADJACENT-PAIR CONCATENATIONS, because brands are spelled inconsistently
      // across a feed and its catalogue: "ByWishtrend" tokenises to {bywishtrend} and
      // "By Wishtrend" to {by, wishtrend}, which share NOTHING. That pair is a true
      // reassignment either way, but it trips for partly the wrong reason — and the
      // same inconsistency on a genuinely-matching pair is a false positive waiting.
      // Joining adjacent words (by+wishtrend -> bywishtrend) makes the two spellings
      // meet without loosening the threshold. Item 84.
      const toks = (s: string) => {
        const words = s.toLowerCase().replace(/[^a-z]+/g, " ").split(" ").filter(Boolean);
        const out = new Set(words.filter(t => t.length >= 3));
        for (let i = 0; i + 1 < words.length; i++) {
          const j = words[i] + words[i + 1];
          if (j.length >= 6) out.add(j);
        }
        return out;
      };

      const buckets = new Map<string, number>();
      const bump = (k: string) => buckets.set(k, (buckets.get(k) ?? 0) + 1);
      const dist = new Map<number, number>();
      const zeroRows: { id: string; feed: string; stored: string }[] = [];
      const allZeroProductIds: number[] = [];

      for (const r of body) {
        const key = String(r[idIdx] ?? "").trim();
        const feedName = get(r, "product_name");
        if (!key)                      { bump("could-not-parse: feed row has no match id"); continue; }
        const storedName = stored.get(key);
        if (storedName === undefined)  { bump("not in catalogue (new or unmatched row)");   continue; }
        if (!feedName)                 { bump("could-not-parse: feed row has no name");      continue; }
        const a = toks(feedName), b = toks(storedName);
        if (!a.size || !b.size)        { bump("could-not-parse: no usable tokens either side"); continue; }
        let shared = 0;
        for (const t of a) if (b.has(t)) shared++;
        bump("compared");
        dist.set(shared, (dist.get(shared) ?? 0) + 1);
        if (shared === 0) {
          const pid = storedIds.get(key);
          if (pid != null) allZeroProductIds.push(pid);
          if (zeroRows.length < 60) zeroRows.push({ id: key, feed: feedName, stored: storedName });
        }
      }

      console.log("\n  EVERY ROW ACCOUNTED FOR:");
      let total = 0;
      for (const [k, v] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
        console.log("   " + String(v).padStart(7) + "  " + k); total += v;
      }
      console.log("   " + String(total).padStart(7) + "  TOTAL (feed rows: " + body.length + ")");

      console.log("\n  TOKEN-OVERLAP DISTRIBUTION over compared rows:");
      const maxK = Math.max(...[...dist.keys()], 0);
      let cum = 0;
      const compared = buckets.get("compared") ?? 0;
      for (let k = 0; k <= Math.min(maxK, 8); k++) {
        const v = dist.get(k) ?? 0; cum += v;
        console.log("   " + String(k).padStart(2) + " shared: " + String(v).padStart(7) +
                    "  cum " + (100 * cum / Math.max(compared, 1)).toFixed(2) + "%");
      }
      const tail = [...dist.entries()].filter(([k]) => k > 8).reduce((s, [, v]) => s + v, 0);
      if (tail) console.log("   9+ shared: " + String(tail).padStart(7));

      console.log("\n  ZERO-OVERLAP ROWS — hand-check against item 84's false-positive table:");
      for (const z of zeroRows) {
        console.log("   " + z.id.padEnd(14) + " feed: " + z.feed.slice(0, 58));
        console.log("   " + "".padEnd(14) + " db  : " + z.stored.slice(0, 58));
      }

      // THE DIVERGENT PRODUCT IDS, PRINTED IN FULL. The split is NOT computed here.
      //
      // This block used to compute a "recoverable split" via a PostgREST embed
      // (`retailers!inner(active)` with `.eq("retailers.active", true)`). It returned
      // NOTHING for all 137 products and printed that as "0 recoverable". SQL over the
      // same ids found survivors in 4 of the first 12 checked. A lookup that resolved
      // nothing and an answer of genuinely none produced the SAME OUTPUT — which is
      // work-list item 84's rule, broken by the very query written to apply it.
      //
      // It was also asking the WRONG QUESTION, which matters more than the broken join.
      // "Has a row at another active retailer" is not the recoverable condition. "Is
      // still present in that retailer's CURRENT FEED" is. A retailer_prices row
      // persists long after the product leaves a feed — that is what the absence
      // threshold exists to handle — and such a row re-sources nothing. Product 7547 is
      // the worked example: its only survivor was a YesStyle row last confirmed 30 May,
      // so nothing was overwriting Stylevana's wrong image.
      //
      // So this prints ids and stops. The split belongs in SQL, where the join is
      // inspectable, the intermediate counts can be read, and row freshness can be
      // tested against each retailer's own last successful import rather than guessed.
      if (allZeroProductIds.length) {
        const ids = [...new Set(allZeroProductIds)].sort((a, b) => a - b);
        console.log("\n  DIVERGENT PRODUCT IDS — " + ids.length + " distinct. Derive the split in SQL:");
        for (let i = 0; i < ids.length; i += 20) {
          console.log("   " + ids.slice(i, i + 20).join(","));
        }
      }
    }
  }
}

// === 8. SUBCATEGORY MAP PREVIEW AND BACKFILL SQL =====================================
// READ-ONLY, like every other section here. It prints an UPDATE batch; it does not run
// one. The write goes through a presented diff, which is the same standard the exclusion
// batch and the departure gone-sets were held to.
//
// Answers three things in one pass over the feed:
//   (a) what the group A map actually does to the admitted rows, against the PREDICTION
//       written down before it ran (306 specific / 1,330 general / 133 out of scope);
//   (b) the backfill itself — product_id -> subcategory, joined through the retailer's
//       match column, with every row that fails to join REPORTED rather than dropped;
//   (c) work-list item 143's question 4, which could not be answered while product_type
//       was unstored: do the product_exclusions ids sit in nodes the map suppresses?
//
// Set SUBCAT_PREVIEW=1 and SUBCAT_RETAILER_ID. Uses ADMIT_PREFIX for the leaf.
{
  const rid = Number(process.env.SUBCAT_RETAILER_ID || 0);
  const on = process.env.SUBCAT_PREVIEW === "1";
  const PREFIX = (process.env.ADMIT_PREFIX || "").split("|").map(s => s.trim()).filter(Boolean);
  const matchCol = process.env.SUBCAT_MATCH_COLUMN || "merchant_product_id";
  if (on && rid > 0 && PREFIX.length) {
    const { BOOTS_SUBCATEGORY_MAP, matchSubcategory } = await import("./boots-subcategory-map.ts");
    const pathCol = col("merchant_product_category_path");
    const ptCol = col("product_type");
    const idIdx = col(matchCol);
    console.log("\n=== 8. SUBCATEGORY MAP PREVIEW (retailer " + rid + ", " +
                BOOTS_SUBCATEGORY_MAP.length + " map entries) ===");
    if (pathCol < 0 || ptCol < 0 || idIdx < 0) {
      console.log("  missing a required column (path/product_type/" + matchCol + ") — cannot preview");
    } else {
      const admitted = body.filter(r => { const p = (r[pathCol] ?? "").trim(); return PREFIX.some(x => p.startsWith(x)); });
      console.log("  admitted rows:", admitted.length);

      // (a) THE MAP AGAINST THE PREDICTION.
      const bySub = new Map<string, number>();
      let oos = 0, unmatched = 0, emptySource = 0;
      const unmatchedValues = new Map<string, number>();
      const oosByPrefix = new Map<string, number>();
      for (const r of admitted) {
        const v = (r[ptCol] ?? "").trim();
        if (!v) { emptySource++; continue; }
        const hit = matchSubcategory(v);
        if (!hit.matched) {
          unmatched++;
          unmatchedValues.set(v, (unmatchedValues.get(v) ?? 0) + 1);
        } else if (hit.subcategory === null) {
          oos++;
          oosByPrefix.set(hit.prefix!, (oosByPrefix.get(hit.prefix!) ?? 0) + 1);
        } else {
          bySub.set(hit.subcategory, (bySub.get(hit.subcategory) ?? 0) + 1);
        }
      }
      const specific = [...bySub.entries()].filter(([k]) => k !== "general").reduce((a, [, n]) => a + n, 0);
      const general = bySub.get("general") ?? 0;
      console.log("\n  --- (a) MAP OUTPUT vs PREDICTION ---");
      console.log("                        predicted   actual");
      console.log("    specific subcategory      306   " + String(specific).padStart(6));
      console.log("    general (bare parent)   1,330   " + String(general).padStart(6));
      console.log("    out of scope (null)       133   " + String(oos).padStart(6));
      console.log("    unmatched on purpose        2   " + String(unmatched).padStart(6));
      console.log("    source column empty         0   " + String(emptySource).padStart(6));
      console.log("\n    by subcategory:");
      for (const [k, n] of [...bySub.entries()].sort((a, b) => b[1] - a[1])) {
        console.log("      " + k.padEnd(20) + String(n).padStart(6));
      }
      console.log("\n    out of scope by prefix:");
      for (const [k, n] of [...oosByPrefix.entries()].sort((a, b) => b[1] - a[1])) {
        console.log("      " + String(n).padStart(5) + "  " + k);
      }
      console.log("\n    UNMATCHED VALUES (each one is an open question, not a defect):");
      for (const [k, n] of [...unmatchedValues.entries()].sort((a, b) => b[1] - a[1])) {
        console.log("      " + String(n).padStart(5) + "  " + k);
      }

      // (b) THE JOIN. Feed match id -> stored product_id, for this retailer.
      const storedIds = new Map<string, number>();
      let from = 0;
      for (;;) {
        const { data, error } = await sb
          .from("retailer_prices")
          .select("external_product_id, product_id")
          .eq("retailer_id", rid)
          .not("external_product_id", "is", null)
          .range(from, from + 999);
        if (error) { console.log("  stored-side read failed:", error.message); break; }
        if (!data || !data.length) break;
        for (const r of data as any[]) {
          const k = String(r.external_product_id ?? "").trim();
          if (k && r.product_id != null) storedIds.set(k, Number(r.product_id));
        }
        if (data.length < 1000) break;
        from += 1000;
      }
      console.log("\n  --- (b) BACKFILL JOIN ---");
      console.log("    stored rows for retailer " + rid + " with an ext id:", storedIds.size);

      const assign = new Map<number, string>();   // product_id -> subcategory
      const nodeOf = new Map<number, string>();   // product_id -> raw product_type
      let noJoin = 0;
      const noJoinSample: string[] = [];
      for (const r of admitted) {
        const key = String(r[idIdx] ?? "").trim();
        const v = (r[ptCol] ?? "").trim();
        const pid = storedIds.get(key);
        if (pid === undefined) {
          noJoin++;
          if (noJoinSample.length < 10) noJoinSample.push(key + "  " + get(r, "product_name").slice(0, 60));
          continue;
        }
        nodeOf.set(pid, v);
        const hit = matchSubcategory(v);
        if (hit.matched && hit.subcategory) assign.set(pid, hit.subcategory);
      }
      console.log("    feed rows that JOINED to a product      :", admitted.length - noJoin);
      console.log("    feed rows with NO stored row (REPORTED) :", noJoin);
      for (const s of noJoinSample) console.log("        " + s);
      console.log("    distinct product ids to update          :", assign.size);

      // (c) ITEM 143 QUESTION 4, now a measurement rather than an inference.
      console.log("\n  --- (c) ITEM 143 Q4: product_exclusions UNDER THE MAP ---");
      const { data: excl, error: exErr } = await sb
        .from("product_exclusions")
        .select("product_id, reason");
      if (exErr) {
        console.log("    product_exclusions read failed:", exErr.message);
      } else {
        const rows = (excl ?? []) as any[];
        console.log("    exclusion rows:", rows.length);
        let suppressed = 0, kept = 0, absent = 0;
        const byReason = new Map<string, { suppressed: number; kept: number; absent: number }>();
        const keptNodes = new Map<string, number>();
        for (const e of rows) {
          const pid = Number(e.product_id);
          const reason = String(e.reason ?? "?");
          const b = byReason.get(reason) ?? { suppressed: 0, kept: 0, absent: 0 };
          const v = nodeOf.get(pid);
          if (v === undefined) { absent++; b.absent++; }
          else {
            const hit = matchSubcategory(v);
            if (hit.matched && hit.subcategory === null) { suppressed++; b.suppressed++; }
            else { kept++; b.kept++; keptNodes.set(v, (keptNodes.get(v) ?? 0) + 1); }
          }
          byReason.set(reason, b);
        }
        console.log("\n    PREDICTION (written before this ran): ~6 suppressed, ~45 kept.");
        console.log("      suppressed by the map (out-of-scope node):", suppressed);
        console.log("      KEPT by the map (group A node)           :", kept);
        console.log("      not in the admitted feed rows at all     :", absent);
        console.log("\n      by reason:");
        for (const [k, b] of [...byReason.entries()].sort()) {
          console.log("        " + k.padEnd(20) + " suppressed " + String(b.suppressed).padStart(3) +
                      "  kept " + String(b.kept).padStart(3) + "  absent " + String(b.absent).padStart(3));
        }
        console.log("\n      nodes the map KEEPS that hold an excluded product:");
        for (const [k, n] of [...keptNodes.entries()].sort((a, b) => b[1] - a[1])) {
          console.log("        " + String(n).padStart(4) + "  " + k);
        }
      }

      // (d) THE SQL, PRINTED NOT RUN.
      //
      // TWO DECISIONS FROM ITEM 145 ARE ENCODED HERE, NOT LEFT TO THE READER OF THE OUTPUT.
      //
      // 1. `general` IS NEVER WRITTEN. products.subcategory publishes a URL — one product
      //    carrying a value puts it in active_category_subcategories and therefore in the
      //    sitemap, with no threshold anywhere in between. /supplements/general would be a
      //    page named for having nothing to say about 75% of the category. `general` stays
      //    the honest INTERNAL answer for a row on a bare parent and stops being written to
      //    the column that publishes pages.
      //
      // 2. NOTHING OVERWRITES A MORE SPECIFIC EXISTING VALUE. Item 144's second defect: the
      //    first draft of this batch would have relabelled 194 products already filed
      //    `sports` as `general`, silently, because the UPDATEs were keyed on product id
      //    alone. "Group B stays out" meant do not ship a new name rule; it did not mean
      //    un-file what the existing inference already filed.
      //
      // THE SPECIFICITY ORDER IS EXPLICIT BECAUSE IT IS NOT OBVIOUS. NULL, `general` and
      // `supplements` all mean "no subcategory information" and are overwritable; anything
      // else is a real classification and is not. Writing the guard as "only where NULL"
      // would have written nothing at all, since every Boots row already carries
      // `supplements`.
      const OVERWRITABLE = ["supplements", "general"];
      console.log("\n  --- (d) BACKFILL SQL (printed, NOT executed) ---");
      const byTarget = new Map<string, number[]>();
      let declinedGeneral = 0;
      for (const [pid, sub] of assign) {
        if (sub === "general") { declinedGeneral++; continue; }
        const a = byTarget.get(sub) ?? [];
        a.push(pid);
        byTarget.set(sub, a);
      }
      console.log("    DECLINED, decision 1: " + declinedGeneral + " rows that map to `general` " +
                  "and would publish /supplements/general. They keep whatever they have.");
      console.log("    GUARDED, decision 2: every UPDATE writes only where the existing value " +
                  "is one of " + JSON.stringify(OVERWRITABLE) + " or NULL.");
      const guard = " AND (subcategory IS NULL OR subcategory IN (" +
                    OVERWRITABLE.map(v => JSON.stringify(v)).join(",") + "))";
      console.log("BEGIN;");
      for (const [sub, ids] of [...byTarget.entries()].sort()) {
        ids.sort((a, b) => a - b);
        console.log("-- " + sub + ": " + ids.length + " products offered");
        for (let i = 0; i < ids.length; i += 200) {
          console.log("UPDATE public.products SET subcategory = " + JSON.stringify(sub) +
                      " WHERE id IN (" + ids.slice(i, i + 200).join(",") + ")" + guard + ";");
        }
      }
      console.log("COMMIT;");
      // A GUARD THAT SILENTLY WRITES FEWER ROWS THAN IT WAS GIVEN IS THE SAME DEFECT ONE
      // LEVEL UP, so print the count to check the applied result against.
      console.log("\n-- CHECK AFTER APPLYING: rows offered per value, above. A statement that");
      console.log("-- updates FEWER rows than offered means the guard declined some, which is");
      console.log("-- correct behaviour and must still be reported rather than noticed.");
    }
  }
}
