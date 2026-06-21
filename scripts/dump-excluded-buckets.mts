/**
 * Dump the full per-bucket list of products the categoriser now EXCLUDES, with
 * name + brand + retailer_id(s), for human review before any deletes fire.
 *
 * Source of truth for the excluded set + reason: scripts/.recategorise-preview.gen.json
 * (produced by recategorise-preview.mts, which runs the real _shared categoriser).
 * Retailer associations are joined in from retailer_prices -> retailers over the
 * public anon REST endpoint (read-only, no writes, no service-role key).
 *
 * Run:  npx tsx scripts/recategorise-preview.mts && npx tsx scripts/dump-excluded-buckets.mts
 * Outputs: scripts/.excluded-buckets.gen.csv  and  scripts/.excluded-buckets.gen.md
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", ".env.local"), "utf8")
    .split(/\n/).filter(Boolean)
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !KEY) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
const H = { apikey: KEY, authorization: `Bearer ${KEY}` };

type Excluded = { id: number; name: string | null; brand: string | null; excluded: string };
const gen = JSON.parse(readFileSync(join(__dirname, ".recategorise-preview.gen.json"), "utf8"));
const excluded: Excluded[] = gen.all_excluded;
const ids = excluded.map((e) => e.id);

// ── retailers: id -> name ─────────────────────────────────────────────────────
const retRes = await fetch(`${URL}/rest/v1/retailers?select=id,name`, { headers: H });
if (!retRes.ok) throw new Error(`retailers read failed: ${retRes.status}`);
const retailerName = new Map<number, string>(
  ((await retRes.json()) as { id: number; name: string }[]).map((r) => [r.id, r.name]),
);

// ── retailer_prices for the excluded ids (chunked) ────────────────────────────
type RP = { product_id: number; retailer_id: number; in_stock: boolean | null };
const byProduct = new Map<number, RP[]>();
const CHUNK = 150;
for (let i = 0; i < ids.length; i += CHUNK) {
  const chunk = ids.slice(i, i + CHUNK);
  const url = `${URL}/rest/v1/retailer_prices?select=product_id,retailer_id,in_stock&product_id=in.(${chunk.join(",")})`;
  const res = await fetch(url, { headers: H });
  if (!res.ok) throw new Error(`retailer_prices read failed @${i}: ${res.status} ${await res.text()}`);
  for (const rp of (await res.json()) as RP[]) {
    if (!byProduct.has(rp.product_id)) byProduct.set(rp.product_id, []);
    byProduct.get(rp.product_id)!.push(rp);
  }
}

// ── assemble rows ─────────────────────────────────────────────────────────────
const fmtRetailers = (rps: RP[]) =>
  rps.map((r) => `${r.retailer_id}:${retailerName.get(r.retailer_id) ?? "?"}${r.in_stock ? "" : "(OOS)"}`).join("; ");

const rows = excluded
  .map((e) => {
    const rps = byProduct.get(e.id) ?? [];
    return {
      reason: e.excluded,
      id: e.id,
      brand: (e.brand ?? "").trim(),
      name: (e.name ?? "").trim(),
      retailer_ids: rps.map((r) => r.retailer_id).join("|"),
      retailers: fmtRetailers(rps),
    };
  })
  .sort((a, b) => a.reason.localeCompare(b.reason) || a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name));

// ── CSV ───────────────────────────────────────────────────────────────────────
const csvEsc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
const csv = [
  "reason,product_id,brand,name,retailer_ids,retailers",
  ...rows.map((r) => [r.reason, r.id, csvEsc(r.brand), csvEsc(r.name), csvEsc(r.retailer_ids), csvEsc(r.retailers)].join(",")),
].join("\n");
writeFileSync(join(__dirname, ".excluded-buckets.gen.csv"), csv);

// ── grouped markdown ──────────────────────────────────────────────────────────
const byReason = new Map<string, typeof rows>();
for (const r of rows) { if (!byReason.has(r.reason)) byReason.set(r.reason, []); byReason.get(r.reason)!.push(r); }
const reasonsSorted = [...byReason.entries()].sort((a, b) => b[1].length - a[1].length);

let md = `# Excluded products by bucket (${rows.length} total)\n\n`;
md += reasonsSorted.map(([reason, rs]) => `- **${reason}**: ${rs.length}`).join("\n") + "\n\n";
for (const [reason, rs] of reasonsSorted) {
  md += `\n## ${reason} (${rs.length})\n\n`;
  md += "| id | brand | name | retailers |\n|---|---|---|---|\n";
  for (const r of rs) {
    md += `| ${r.id} | ${r.brand || "—"} | ${r.name.replace(/\|/g, "/")} | ${r.retailers || "—"} |\n`;
  }
}
writeFileSync(join(__dirname, ".excluded-buckets.gen.md"), md);

// ── console summary ───────────────────────────────────────────────────────────
console.log(`\n=== Excluded buckets (${rows.length} products) ===`);
for (const [reason, rs] of reasonsSorted) console.log(`  ${reason.padEnd(16)} ${rs.length}`);
const noRetailer = rows.filter((r) => !r.retailer_ids).length;
console.log(`\nproducts with NO retailer_prices row: ${noRetailer}`);
console.log(`CSV  -> scripts/.excluded-buckets.gen.csv`);
console.log(`MD   -> scripts/.excluded-buckets.gen.md`);
