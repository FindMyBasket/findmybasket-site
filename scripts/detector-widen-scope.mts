/**
 * Read-only scope scan for the DETECTOR-WIDEN change (Home Fragrance +
 * Aromatherapy brand + plural-form coverage) in _shared/categorisation.ts
 * classifyFragranceOrPersonalCare().
 *
 * Scans every LIVE top_category='skincare' product (the bucket where the OLD
 * detector's null verdicts landed) and reports which rows the CURRENT detector
 * now routes to bath_body / fragrance, broken down by rule. home_fragrance +
 * aromatherapy_brand are brand-new rules, so every skincare hit there is a
 * NET-NEW claim (NEW-vs-STORED bucketing — surfaces already-mis-stored rows an
 * edit-diff would miss).
 *
 * NOTHING is written. Run: npx tsx scripts/detector-widen-scope.mts
 * Full lists -> scripts/.detector-widen-scope.gen.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyFragranceOrPersonalCare } from "../supabase/functions/_shared/categorisation.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", ".env.local"), "utf8")
    .split(/\n/).filter(Boolean)
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !KEY) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");

type Row = { id: number; name: string | null; brand: string | null; product_type: string | null; subcategory: string | null };
const rows: Row[] = [];
const PAGE = 1000;
for (let offset = 0; ; offset += PAGE) {
  const url = `${URL}/rest/v1/products?select=id,name,brand,product_type,subcategory` +
    `&top_category=eq.skincare&merged_into=is.null&order=id.asc&offset=${offset}&limit=${PAGE}`;
  const res = await fetch(url, { headers: { apikey: KEY, authorization: `Bearer ${KEY}` } });
  if (!res.ok) throw new Error(`read failed @${offset}: ${res.status} ${await res.text()}`);
  const batch = (await res.json()) as Row[];
  if (!batch.length) break;
  rows.push(...batch);
  process.stderr.write(`\rread ${rows.length}`);
  if (batch.length < PAGE) break;
}
process.stderr.write(`\rread ${rows.length} skincare products\n`);

const byRule: Record<string, Row[]> = {};
const frag: Row[] = [];
let toBathBody = 0;
for (const p of rows) {
  if (!p.name?.trim()) continue;
  const r = classifyFragranceOrPersonalCare(p.name, p.brand ?? "");
  if (!r) continue;
  if (r.top_category === "fragrance") { frag.push(p); continue; }
  toBathBody++;
  (byRule[`${r.product_type}|${r.subcategory}`] ??= []).push(p);
}

console.log(`\n=== DETECTOR-WIDEN scope — ${rows.length} skincare rows scanned ===`);
console.log(`would route to bath_body: ${toBathBody}   to fragrance: ${frag.length}\n`);
const ruleOrder = Object.entries(byRule).sort((a, b) => b[1].length - a[1].length);
for (const [rule, list] of ruleOrder) {
  console.log(`\n── ${rule}  (${list.length}) ──`);
  for (const p of list.slice(0, 30)) {
    console.log(`   ${String(p.id).padStart(7)} | ${(p.name ?? "").slice(0, 60).padEnd(60)} | ${(p.brand ?? "").slice(0, 22)}`);
  }
  if (list.length > 30) console.log(`   … +${list.length - 30} more`);
}
console.log(`\n── fragrance (${frag.length}) ──`);
for (const p of frag) console.log(`   ${String(p.id).padStart(7)} | ${(p.name ?? "").slice(0, 60)} | ${p.brand}`);

writeFileSync(join(__dirname, ".detector-widen-scope.gen.json"), JSON.stringify({
  scanned: rows.length, toBathBody, toFragrance: frag.length,
  byRule: Object.fromEntries(ruleOrder), fragrance: frag,
}, null, 2));
