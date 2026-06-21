/**
 * Read-only DRY-RUN preview for the recategorise-products edge function.
 *
 * Mirrors that function's dry_run path exactly: it re-applies the CURRENT
 * categoriser (inferCategorisation from _shared/categorisation.ts — the single
 * source of truth, imported directly) to every product and reports which rows
 * are STALE (stored top_category/product_type/subcategory/tags differ from what
 * the categoriser now says) or now EXCLUDED. No database writes — apply happens
 * via the deployed edge function, this is just the blast-radius preview.
 *
 * Reads the catalogue over the public anon REST endpoint (products is
 * public-read), so it needs no service-role key.
 *
 * Run:  npx tsx scripts/recategorise-preview.mts
 * Full stale/excluded lists are written to scripts/.recategorise-preview.gen.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { inferCategorisation } from "../supabase/functions/_shared/categorisation.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", ".env.local"), "utf8")
    .split(/\n/).filter(Boolean)
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !KEY) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");

type Row = {
  id: number; name: string | null; brand: string | null;
  top_category: string | null; product_type: string | null; subcategory: string | null; tags: string[] | null;
};

const sameTags = (a: string[] | null, b: string[]) => {
  const x = [...(a ?? [])].sort(), y = [...(b ?? [])].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

// ── Read all products ────────────────────────────────────────────────────────
const rows: Row[] = [];
const PAGE = 1000;
for (let offset = 0; ; offset += PAGE) {
  const url = `${URL}/rest/v1/products?select=id,name,brand,top_category,product_type,subcategory,tags&order=id.asc&offset=${offset}&limit=${PAGE}`;
  const res = await fetch(url, { headers: { apikey: KEY, authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`read failed @${offset}: ${res.status} ${await res.text()}`);
  const batch = (await res.json()) as Row[];
  if (!batch.length) break;
  rows.push(...batch);
  process.stderr.write(`\rread ${rows.length}`);
  if (batch.length < PAGE) break;
}
process.stderr.write(`\rread ${rows.length} products\n`);

// ── Re-apply categoriser ──────────────────────────────────────────────────────
// Mirror the edge function default: don't let the skincare catchall clobber a
// more specific stored tag. Pass --clobber to preview the raw re-apply instead.
const clobberWithCatchall = process.argv.includes("--clobber");
let scanned = 0, staleFound = 0, excludedFound = 0, skippedEmpty = 0, protectedFromCatchall = 0;
const topChanges: Record<string, number> = {};
const typeChanges: Record<string, number> = {};
const excludedByReason: Record<string, number> = {};
const sampleStale: unknown[] = [];
const sampleExcluded: unknown[] = [];
const allStale: unknown[] = [];
const allExcluded: unknown[] = [];

for (const p of rows) {
  scanned++;
  if (!p.name || !String(p.name).trim()) { skippedEmpty++; continue; }
  const cat = inferCategorisation(p.name, p.brand ?? "");
  const old = { top_category: p.top_category, product_type: p.product_type, subcategory: p.subcategory, tags: p.tags ?? [] };

  if (cat.excluded) {
    excludedFound++;
    excludedByReason[cat.excluded] = (excludedByReason[cat.excluded] ?? 0) + 1;
    const rec = { id: p.id, name: p.name, brand: p.brand, excluded: cat.excluded, old };
    allExcluded.push(rec);
    if (sampleExcluded.length < 50) sampleExcluded.push(rec);
    continue;
  }

  const freshTop = cat.top_category ?? null, freshType = cat.product_type ?? "", freshSub = cat.subcategory ?? "", freshTags = cat.tags ?? [];
  const stale =
    (p.top_category ?? null) !== freshTop ||
    (p.product_type ?? "") !== freshType ||
    (p.subcategory ?? "") !== freshSub ||
    !sameTags(p.tags, freshTags);
  if (!stale) continue;

  const freshIsCatchall = freshTop === "skincare" && (freshType === "" || freshType === "Skincare");
  const storedIsCatchall = (p.top_category ?? null) === "skincare" && ((p.product_type ?? "") === "" || (p.product_type ?? "") === "Skincare");
  if (freshIsCatchall && !storedIsCatchall && !clobberWithCatchall) { protectedFromCatchall++; continue; }

  staleFound++;
  if ((p.top_category ?? null) !== freshTop) {
    const k = `${p.top_category ?? "null"}→${freshTop ?? "null"}`;
    topChanges[k] = (topChanges[k] ?? 0) + 1;
  }
  if ((p.product_type ?? "") !== freshType) {
    const k = `${p.product_type || "—"}→${freshType || "—"}`;
    typeChanges[k] = (typeChanges[k] ?? 0) + 1;
  }
  const rec = { id: p.id, name: p.name, brand: p.brand, old, new: { top_category: freshTop, product_type: freshType, subcategory: freshSub, tags: freshTags } };
  allStale.push(rec);
  if (sampleStale.length < 50) sampleStale.push(rec);
}

const sortDesc = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));

const summary = {
  products_scanned: scanned,
  skipped_empty_name: skippedEmpty,
  stale_found: staleFound,
  protected_from_catchall: protectedFromCatchall,
  excluded_found: excludedFound,
  top_category_changes: sortDesc(topChanges),
  product_type_changes: sortDesc(typeChanges),
  excluded_by_reason: sortDesc(excludedByReason),
};

console.log("\n=== recategorise-products DRY RUN preview ===");
console.log(JSON.stringify(summary, null, 2));
console.log("\n--- sample_stale (first 15) ---");
console.log(JSON.stringify(sampleStale.slice(0, 15), null, 2));
console.log("\n--- sample_excluded (first 15) ---");
console.log(JSON.stringify(sampleExcluded.slice(0, 15), null, 2));

const out = join(__dirname, ".recategorise-preview.gen.json");
writeFileSync(out, JSON.stringify({ summary, sample_stale: sampleStale, sample_excluded: sampleExcluded, all_stale: allStale, all_excluded: allExcluded }, null, 2));
console.log(`\nFull lists (${allStale.length} stale, ${allExcluded.length} excluded) written to ${out}`);
