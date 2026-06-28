/**
 * Read-only preview for the STAGE 2 extended detector
 *   classifyFragranceOrPersonalCare()  in  _shared/categorisation.ts
 *
 * Runs the detector over every LIVE product currently stored as top_category
 * 'skincare' (read over the public anon REST endpoint; no writes, no service
 * key) and reports what it WOULD reclassify to fragrance / personal_care once
 * those categories are enabled, plus a proof that the 115 fragrance-free rows
 * are correctly NOT caught as fragrance.
 *
 * NOTHING is written to the database. This is a blast-radius / accuracy preview
 * only; enabling the categories and migrating data are separate reviewed steps.
 *
 * Run:  npx tsx scripts/fragrance-personalcare-preview.mts
 * Full lists are written to scripts/.fragrance-personalcare-preview.gen.json
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

type Row = { id: number; name: string | null; brand: string | null; product_type: string | null };

// ── Read all live skincare products ───────────────────────────────────────────
const rows: Row[] = [];
const PAGE = 1000;
for (let offset = 0; ; offset += PAGE) {
  const url = `${URL}/rest/v1/products?select=id,name,brand,product_type` +
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

const FRAG_FREE = /\b(fragrance[\s-]?free|without fragrance|non[\s-]?fragrance|zero fragrance)\b/i;

let toFragrance = 0, toPersonalCare = 0, untouched = 0;
const fragByType: Record<string, number> = {};
const fragByRule: Record<string, number> = {};
const pcByType: Record<string, number> = {};
const sampleFragrance: unknown[] = [];
const samplePersonalCare: unknown[] = [];
const allFragrance: unknown[] = [];
const allPersonalCare: unknown[] = [];

// Proof set: rows carrying a fragrance-free phrase must NOT become fragrance.
let fragFreeRows = 0, fragFreeCaughtAsFragrance = 0;
const sampleFragFreeNotCaught: unknown[] = [];

for (const p of rows) {
  if (!p.name || !String(p.name).trim()) { untouched++; continue; }
  const r = classifyFragranceOrPersonalCare(p.name, p.brand ?? "");
  const isFragFree = FRAG_FREE.test(p.name);
  if (isFragFree) fragFreeRows++;

  if (!r) { untouched++; }
  else if (r.top_category === "fragrance") {
    toFragrance++;
    fragByType[r.product_type] = (fragByType[r.product_type] ?? 0) + 1;
    fragByRule[r.rule] = (fragByRule[r.rule] ?? 0) + 1;
    const rec = { id: p.id, name: p.name, brand: p.brand, product_type: r.product_type, rule: r.rule };
    allFragrance.push(rec);
    if (sampleFragrance.length < 25) sampleFragrance.push(rec);
    if (isFragFree) fragFreeCaughtAsFragrance++; // should stay 0
  } else {
    toPersonalCare++;
    pcByType[r.product_type] = (pcByType[r.product_type] ?? 0) + 1;
    const rec = { id: p.id, name: p.name, brand: p.brand, product_type: r.product_type, rule: r.rule };
    allPersonalCare.push(rec);
    if (samplePersonalCare.length < 25) samplePersonalCare.push(rec);
  }

  // Record fragrance-free rows that the detector correctly leaves OUT of fragrance.
  if (isFragFree && (!r || r.top_category !== "fragrance") && sampleFragFreeNotCaught.length < 20) {
    sampleFragFreeNotCaught.push({ id: p.id, name: p.name, brand: p.brand, detector: r ? r.top_category : "skincare (null)" });
  }
}

const sortDesc = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
const summary = {
  skincare_scanned: rows.length,
  would_route_fragrance: toFragrance,
  would_route_personal_care: toPersonalCare,
  left_as_skincare: untouched,
  fragrance_by_product_type: sortDesc(fragByType),
  fragrance_by_rule: sortDesc(fragByRule),
  personal_care_by_product_type: sortDesc(pcByType),
  fragrance_free_rows_seen: fragFreeRows,
  fragrance_free_wrongly_caught_as_fragrance: fragFreeCaughtAsFragrance, // MUST be 0
};

const show = (label: string, arr: unknown[]) => {
  console.log(`\n--- ${label} ---`);
  for (const e of arr as { name: string; brand: string | null; product_type?: string; rule?: string; detector?: string }[]) {
    const tail = e.product_type ? `${e.product_type} / ${e.rule}` : (e.detector ?? "");
    console.log(`   ${(e.name || "").slice(0, 66).padEnd(66)} | ${(e.brand ?? "").slice(0, 20).padEnd(20)} | ${tail}`);
  }
};

console.log("\n=== classifyFragranceOrPersonalCare() DRY-RUN preview (no writes) ===");
console.log(JSON.stringify(summary, null, 2));
show("WOULD CATCH as FRAGRANCE (sample 25)", sampleFragrance);
show("WOULD CATCH as PERSONAL CARE (sample 25)", samplePersonalCare);
show("FRAGRANCE-FREE rows correctly NOT caught as fragrance (sample 20)", sampleFragFreeNotCaught);

const out = join(__dirname, ".fragrance-personalcare-preview.gen.json");
writeFileSync(out, JSON.stringify({ summary, sample_fragrance: sampleFragrance, sample_personal_care: samplePersonalCare, sample_fragrance_free_not_caught: sampleFragFreeNotCaught, all_fragrance: allFragrance, all_personal_care: allPersonalCare }, null, 2));
console.log(`\nFull lists (${allFragrance.length} fragrance, ${allPersonalCare.length} personal care) written to ${out}`);

if (fragFreeCaughtAsFragrance > 0) {
  console.log(`\n⚠️  GUARD FAILURE: ${fragFreeCaughtAsFragrance} fragrance-free row(s) were caught as fragrance.`);
  process.exit(1);
}
