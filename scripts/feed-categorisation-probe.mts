/**
 * READ-ONLY categorisation + match probe for a candidate AWIN feed.
 *
 * WHY THIS EXISTS, and why it is not a one-off. The importer's `dry_run` cannot
 * answer these questions on a large feed, and the reason is structural rather than
 * a resourcing accident: dry-runs are never sliced (import-awin-feed/index.ts:573 —
 * cross-slice state relies on each slice COMMITTING), so `dry_run: true` forces the
 * whole feed through a single worker and bypasses `sliced_import`. Niche Beauty at
 * 14,636 rows returned WORKER_RESOURCE_LIMIT twice, including with
 * `streaming_enabled: true`. The Organic Pharmacy at 114 rows dry-runs fine.
 *
 * So dry_run is usable on exactly the feeds that do not need inspecting, and
 * unusable on the create-heavy ones that do. This probe fills that gap and is
 * reusable for The Fragrance Shop and every prestige feed after it.
 *
 * WRITES NOTHING. Reads a feed file from disk and the catalogue over SELECT only.
 * No Storage upload, no import trigger, no DB mutation, no retailer_import_config
 * row required — which is the other reason it exists, since a dry run needs a
 * config row and therefore a retailers row before it can run at all.
 *
 * It imports the SAME modules the importer uses — inferCategorisationForImport,
 * normaliseEan, validateBarcode — rather than reimplementing them, so its verdict
 * cannot drift from what an import would actually do. All three are import-free and
 * Deno-free, so tsx loads them directly.
 *
 * Usage (see .github/workflows/feed-categorisation-probe.yml):
 *   FEED_FILE=./feed.csv SUPABASE_URL=... SUPABASE_KEY=... \
 *     npx --yes tsx scripts/feed-categorisation-probe.mts
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { inferCategorisationForImport } from "../supabase/functions/_shared/categorisation.ts";
import { normaliseEan, buildMatchKey } from "../supabase/functions/_shared/match-key.ts";
import { validateBarcode, coalesceField } from "../supabase/functions/_shared/barcode.ts";

const FEED_FILE = process.env.FEED_FILE || "./feed.csv";
const LABEL = process.env.LABEL || "(unnamed feed)";
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;
// Terms to test as a supplements exclusion. Matched the way isExcludedCategory
// does it (index.ts:338-339): against `${categoryPath} ${categoryName}`, NOT
// against the product name. Passed in so the probe reports what a given config
// WOULD exclude rather than hardcoding one retailer's answer.
const EXCLUDE_TERMS = (process.env.CATEGORY_EXCLUDES || "Vitamins & Supplements,Supplements")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

if (!SB_URL || !SB_KEY) throw new Error("SUPABASE_URL and SUPABASE_KEY are required");
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ── CONTRACT WITH _shared/categorisation.ts ────────────────────────────────
// THIS PROBE'S ONLY VALUE IS THAT IT IMPORTS THE IMPORTER'S CATEGORISER RATHER
// THAN REIMPLEMENTING IT. That is also the thing that will rot: if
// categorisation.ts changes and this does not follow, the probe keeps running and
// keeps printing a verdict that no longer matches what an import would do, with
// nothing anywhere to say so. A stale probe is worse than no probe, because its
// output looks exactly as authoritative as a correct one.
//
// A version constant would only catch someone remembering to bump it. These
// assertions catch a BEHAVIOUR change, which is the thing that actually matters,
// and they fail loudly at startup before a single row is read.
//
// If one of these fires, the categoriser changed. Do not "fix" the expectation to
// make it pass — read the change, decide whether the probe's reporting is still
// meaningful, and update both ends together. The mirror of this note lives in
// _shared/categorisation.ts.
const CONTRACT: Array<{ name: string; brand: string; expect: string; why: string }> = [
  {
    name: "Cinq Mondes Bergamot Eau de Parfum 100ml", brand: "Cinq Mondes", expect: "fragrance",
    why: "hard fragrance form is detected",
  },
  {
    name: "Cinq Mondes Bergamot", brand: "Cinq Mondes", expect: "skincare",
    why: "brand + botanical with NO fragrance noun is indistinguishable from botanical skincare — the unfixable case, item 46",
  },
];
for (const c of CONTRACT) {
  const got = inferCategorisationForImport(c.name, c.brand);
  const actual = got.excluded ? `EXCLUDED:${got.excluded}` : (got.top_category ?? "(null)");
  if (actual !== c.expect) {
    console.error("CONTRACT VIOLATION — _shared/categorisation.ts has changed behaviour.");
    console.error(`  "${c.name}" (${c.brand})`);
    console.error(`  expected ${c.expect}, got ${actual}`);
    console.error(`  the expectation exists because: ${c.why}`);
    console.error("  This probe's output is no longer known to match an import. Aborting.");
    process.exit(1);
  }
}
console.log(`categoriser contract: ${CONTRACT.length} assertions passed\n`);

// ── CSV ────────────────────────────────────────────────────────────────────
// AWIN quotes fields containing commas; a naive split corrupts product names,
// which are the categoriser's only input. Minimal RFC4180 reader.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const table = parseCsv(readFileSync(FEED_FILE, "utf8"));
const header = table[0].map((h) => h.trim().replace(/^﻿/, ""));
const body = table.slice(1).filter((r) => r.length > 1);
const ix = (n: string) => header.indexOf(n);
const get = (r: string[], n: string) => { const i = ix(n); return i >= 0 ? (r[i] ?? "").trim() : ""; };

console.log("==============================================");
console.log(` CATEGORISATION PROBE — ${LABEL}`);
console.log(" READ-ONLY: nothing is written anywhere");
console.log("==============================================");
console.log(`rows: ${body.length}`);
console.log(`columns: ${header.join(", ")}\n`);

// ── 1. CATEGORY DISTRIBUTION ───────────────────────────────────────────────
// The importer categorises from NAME AND BRAND ONLY (index.ts:2149). The feed's
// category columns never reach the categoriser — they are used for exclusion. So
// every created row's top_category is inferred, not carried over, and this section
// is the whole of what a create-heavy first import would assign.
const iPath = ix("merchant_product_category_path"), iPathAlt = ix("merchant_category");
const iName = ix("category_name"), iNameAlt = ix("product_type");
const iEan = ix("ean"), iEanAlt = ix("product_GTIN");

const topCat = new Map<string, number>();
const excluded = new Map<string, number>();
const subcat = new Map<string, number>();
const examples = new Map<string, string[]>();
let supplementHits = 0;
const supplementExamples: string[] = [];

type Row = { name: string; brand: string; gtin: string; top: string; mkey: string };
const rows: Row[] = [];

for (const r of body) {
  const name = get(r, "product_name");
  const brand = get(r, "brand_name");
  const cat = inferCategorisationForImport(name, brand);

  const top = cat.excluded ? `EXCLUDED:${cat.excluded}` : (cat.top_category ?? "(null)");
  topCat.set(top, (topCat.get(top) || 0) + 1);
  if (cat.excluded) excluded.set(cat.excluded, (excluded.get(cat.excluded) || 0) + 1);
  if (!cat.excluded && cat.subcategory) {
    const k = `${cat.top_category} / ${cat.subcategory}`;
    subcat.set(k, (subcat.get(k) || 0) + 1);
  }
  const ex = examples.get(top) || [];
  if (ex.length < 6) { ex.push(`${brand} — ${name}`.slice(0, 96)); examples.set(top, ex); }

  // Supplements: matched exactly as isExcludedCategory does, on path + name.
  const path = coalesceField(r, iPath, iPathAlt).value;
  const cname = coalesceField(r, iName, iNameAlt).value;
  const haystack = `${path} ${cname}`.toLowerCase();
  if (EXCLUDE_TERMS.some((t) => haystack.includes(t))) {
    supplementHits++;
    if (supplementExamples.length < 10) supplementExamples.push(`${brand} — ${name}`.slice(0, 96));
  }

  rows.push({ name, brand, gtin: coalesceField(r, iEan, iEanAlt).value, top, mkey: buildMatchKey(brand, name) });
}

console.log("=== 1. CATEGORY DISTRIBUTION (inferred from name+brand only) ===");
for (const [k, n] of [...topCat.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(6)}  ${(100 * n / body.length).toFixed(1).padStart(5)}%  ${k}`);
  for (const e of examples.get(k) || []) console.log(`          · ${e}`);
}

console.log("\n=== 2. SUBCATEGORY (top 20, non-excluded) ===");
for (const [k, n] of [...subcat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${String(n).padStart(6)}  ${k}`);
}

console.log(`\n=== 3. SUPPLEMENTS EXCLUSION — terms [${EXCLUDE_TERMS.join(", ")}] ===`);
console.log(`  rows a category_excludes with these terms WOULD drop: ${supplementHits}`);
console.log("  NOTE: matched on category path + category_name, per isExcludedCategory.");
console.log("  A term that also appears in product names would over-match; check the examples.");
for (const e of supplementExamples) console.log(`    · ${e}`);
if (supplementHits === 0) console.log("    (none — either no supplements, or the terms do not match this feed's strings)");

// ── 4. BARCODE + MATCH SPLIT ───────────────────────────────────────────────
// What would MATCH an existing catalogue row versus CREATE a new one, and on what.
// Barcode is the only tier this probe can test offline; name-tier matching depends
// on the importer's staged state and is deliberately not guessed at here.
console.log("\n=== 4. BARCODE QUALITY AND MATCH SPLIT ===");
let gtinPresent = 0, gtinValid = 0;
const rejectReasons = new Map<string, number>();
const validEans = new Set<string>();
for (const r of rows) {
  if (!r.gtin) continue;
  gtinPresent++;
  const v = validateBarcode(r.gtin);
  if (v.value) { gtinValid++; validEans.add(normaliseEan(v.value) ?? v.value); }
  else if (v.reason) rejectReasons.set(v.reason, (rejectReasons.get(v.reason) || 0) + 1);
}
console.log(`  rows with a barcode (ean or product_GTIN): ${gtinPresent} (${(100*gtinPresent/body.length).toFixed(1)}%)`);
console.log(`  passing validateBarcode:                   ${gtinValid} (${(100*gtinValid/body.length).toFixed(1)}%)`);
console.log(`  distinct valid barcodes:                   ${validEans.size}`);
if (rejectReasons.size) {
  console.log("  rejected, by reason:");
  for (const [k, n] of [...rejectReasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(6)}  ${k}`);
}

// ── CATALOGUE LOOKUP: TWO TIERS, AND THE DIFFERENCE BETWEEN THEM ──────────
// "Present in retailer_prices" is NOT the same question as "would join a live
// comparison". The former includes out-of-stock rows, rows at inactive retailers,
// and rows whose product is merged or a variant child. products_active already
// excludes merged/variant/unimaged and requires a price row at an ACTIVE retailer,
// but does NOT require in_stock — so BUCKET A adds that.
//
// Reported separately because a gap between the two is usually the two measures
// answering different questions, not either being wrong. Establish that before
// concluding anything about a matcher.
const all = [...validEans];
const present = new Set<string>();          // any retailer_prices row
const liveA = new Set<string>();            // BUCKET A: in stock, active retailer, in products_active
for (let i = 0; i < all.length; i += 300) {
  const chunk = all.slice(i, i + 300);
  const { data, error } = await sb
    .from("retailer_prices")
    .select("ean_normalised, product_id, in_stock, retailers!inner(active)")
    .in("ean_normalised", chunk);
  if (error) { console.error(`  catalogue lookup failed: ${error.message}`); break; }
  const candidates: Array<{ ean: string; pid: number }> = [];
  for (const d of (data || []) as any[]) {
    if (!d.ean_normalised) continue;
    present.add(d.ean_normalised);
    if (d.in_stock === true && d.retailers?.active === true) candidates.push({ ean: d.ean_normalised, pid: d.product_id });
  }
  const pids = [...new Set(candidates.map((c) => c.pid))];
  for (let j = 0; j < pids.length; j += 300) {
    const { data: pa } = await sb.from("products_active").select("id").in("id", pids.slice(j, j + 300));
    const live = new Set((pa || []).map((x: any) => x.id));
    for (const c of candidates) if (live.has(c.pid)) liveA.add(c.ean);
  }
}

const cov = 100 * gtinValid / body.length;
const confidence = cov >= 95 ? "HIGH — nearly all rows carry a usable barcode"
  : cov >= 70 ? "MODERATE — a minority of rows can only match by name"
  : cov >= 40 ? "LOW — a large share of rows are invisible to this method"
  : "VERY LOW — most rows cannot be assessed by barcode at all";

console.log(`\n  barcode coverage: ${gtinValid}/${body.length} = ${cov.toFixed(1)}%  [${confidence}]`);
console.log(`  present in retailer_prices (ANY row):        ${present.size} of ${validEans.size}`);
console.log(`  BUCKET A — in stock, active retailer, in products_active: ${liveA.size}`);
console.log(`     -> would join a LIVE comparison:          ~${liveA.size}  (at ${cov.toFixed(1)}% coverage)`);
console.log(`     -> present but NOT live (oos / inactive / merged / variant): ${present.size - liveA.size}`);
console.log(`  -> would CREATE: <=${body.length - present.size}  (UPPER BOUND at ${cov.toFixed(1)}% coverage — name-tier matches counted as creates)`);

// ── 5. TIER DISAGREEMENT ──────────────────────────────────────────────────
// feed-diag matches on match_key; this probe matches on normalised barcode. If
// barcode finds depth match_key misses, that is a finding about the MATCHER, not
// about the candidate feed — and it is the sibling-coalesce premise, which exists
// because advertisers populate product_GTIN where we read ean.
console.log("\n=== 5. TIER DISAGREEMENT (barcode vs match_key) ===");
const byEan = new Map<string, string>();    // ean -> match_key, for rows that matched on barcode
for (const r of rows) {
  if (!r.gtin) continue;
  const v = validateBarcode(r.gtin);
  const n = v.value ? (normaliseEan(v.value) ?? v.value) : null;
  if (n && liveA.has(n)) byEan.set(n, r.mkey);
}
const mkeys = [...new Set([...byEan.values()])].filter(Boolean);
const mkeyHit = new Set<string>();
for (let i = 0; i < mkeys.length; i += 300) {
  const { data } = await sb.from("products_active").select("match_key").in("match_key", mkeys.slice(i, i + 300));
  for (const d of (data || []) as any[]) if (d.match_key) mkeyHit.add(d.match_key);
}
const bothTiers = [...byEan.values()].filter((k) => k && mkeyHit.has(k)).length;
const barcodeOnly = byEan.size - bothTiers;
console.log(`  live barcode matches:                 ${byEan.size}`);
console.log(`  of those, match_key ALSO matches:     ${bothTiers}`);
console.log(`  BARCODE-ONLY (match_key misses them): ${barcodeOnly}`);
console.log("  A large barcode-only figure is the sibling-coalesce premise confirmed:");
console.log("  the advertiser names products differently from our catalogue, so only the");
console.log("  barcode tier finds them. That is a property of the MATCHER, not this feed.");

console.log("\nDone. Nothing was written.");
