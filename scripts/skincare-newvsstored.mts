/**
 * READ-ONLY NEW-vs-STORED preview for the Step 3c colour-cosmetics decontam.
 * WRITES NOTHING to products.
 *
 * Runs BOTH the pre-change categoriser (git HEAD, saved to
 * .categorisation-old.gen.ts) and the CURRENT shipped inferCategorisation over
 * every stored top_category='skincare' row, so we can isolate exactly what the
 * Step 3c change reclassifies OUT of skincare (the DELTA), grouped by
 * destination class with per-class counts + samples. This is a FIRST review of
 * the shipped function, not a diff against any prior reviewed set.
 *
 * Uses products_active and excludes cleanup_remove, so the counts scope what a
 * reviewed backfill would actually touch.
 *
 * Run:  npx tsx scripts/skincare-newvsstored.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { inferCategorisation as inferNew } from "../supabase/functions/_shared/categorisation.ts";
import { inferCategorisation as inferOld } from "./.categorisation-old.gen.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", ".env.local"), "utf8").split(/\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

type Row = { id: number; name: string | null; brand: string | null; subcategory: string | null; product_type: string | null };

async function fetchAll(): Promise<Row[]> {
  const byId = new Map<number, Row>();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from("products_active")
      .select("id, name, brand, subcategory, product_type")
      .eq("top_category", "skincare")
      .not("tags", "cs", "{cleanup_remove}")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data as Row[]) byId.set(r.id, r);
    if (data.length < PAGE) break;
  }
  return [...byId.values()];
}

const rows = await fetchAll();
console.log(`stored skincare rows scanned (products_active, excl cleanup_remove): ${rows.length}\n`);

type Move = { r: Row; top: string; sub: string; pt: string };
const delta: Move[] = [];        // NEW moves out of skincare that OLD kept as skincare
const preExisting: Move[] = [];  // NEW moves that OLD already moved (not attributable to 3c)
let newExcluded = 0;

for (const r of rows) {
  const name = r.name || "", brand = r.brand || "";
  const nu = inferNew(name, brand);
  const ol = inferOld(name, brand);
  if (nu.excluded) { newExcluded++; continue; }
  if (nu.top_category === "skincare") continue; // still skincare under new → not a move
  const m: Move = { r, top: nu.top_category ?? "?", sub: nu.subcategory, pt: nu.product_type };
  if (ol.excluded || ol.top_category !== "skincare") preExisting.push(m);
  else delta.push(m);
}

// ── per-class grouping of the DELTA (Step 3c's net effect) ──────────────────
function classOf(m: Move): string { return `${m.top}/${m.sub}/${m.pt}`; }
const byClass = new Map<string, Move[]>();
for (const m of delta) (byClass.get(classOf(m)) ?? byClass.set(classOf(m), []).get(classOf(m))!).push(m);

console.log(`=== NEW vs STORED (shipped inferCategorisation) ===`);
console.log(`  moves out of skincare under NEW function total: ${delta.length + preExisting.length}`);
console.log(`    - pre-existing (OLD already moved; NOT from Step 3c): ${preExisting.length}`);
console.log(`    - DELTA attributable to Step 3c change:              ${delta.length}`);
console.log(`  excluded under NEW: ${newExcluded}\n`);

console.log(`=== Step 3c DELTA grouped by destination class (${delta.length}) ===`);
for (const [k, arr] of [...byClass.entries()].sort((a, b) => b[1].length - a[1].length))
  console.log(`  ${String(arr.length).padStart(5)}  ${k}`);

// ── risk buckets to spot-check ──────────────────────────────────────────────
const reComplexionWord = /\bcomplexion\b/i;
const reBareTintLip = (m: Move) => m.top === "makeup" && m.sub === "lips";
const complexionWordRows = delta.filter((m) => reComplexionWord.test(m.r.name || "") && m.pt === "Foundation");
const lipRows = delta.filter(reBareTintLip);

console.log(`\n=== RISK BUCKET A: complexion matches driven by the bare word "complexion" (${complexionWordRows.length}) ===`);
console.log(`  (benefit-phrase FP risk — e.g. "for a radiant complexion" on a serum)`);
for (const m of complexionWordRows.slice(0, 40)) console.log(`  [${m.r.id}] (${m.r.product_type}) ${m.r.brand} — ${m.r.name}`);
if (complexionWordRows.length > 40) console.log(`  … +${complexionWordRows.length - 40} more (see CSV)`);

// ── per-class samples ───────────────────────────────────────────────────────
console.log(`\n=== per-class SAMPLES (first 15 each) ===`);
for (const [k, arr] of [...byClass.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n--- ${k} (${arr.length}) ---`);
  for (const m of arr.slice(0, 15)) console.log(`  [${m.r.id}] (was ${m.r.subcategory}/${m.r.product_type}) ${m.r.brand} — ${m.r.name}`);
}

// ── full CSV of the delta for review ────────────────────────────────────────
function cell(s: string): string { const v = s ?? ""; return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
const HEADER = ["id", "prop_top", "prop_sub", "prop_type", "cur_sub", "cur_type", "brand", "name"];
const lines = [HEADER.join(",")];
for (const m of [...delta].sort((a, b) => classOf(a).localeCompare(classOf(b)) || (a.r.brand ?? "").localeCompare(b.r.brand ?? "")))
  lines.push([m.r.id, m.top, m.sub, m.pt, m.r.subcategory, m.r.product_type, m.r.brand, m.r.name].map((x) => cell(String(x ?? ""))).join(","));
const out = join(__dirname, ".skincare-newvsstored.gen.csv");
writeFileSync(out, lines.join("\n") + "\n");
console.log(`\nFull DELTA CSV: ${out} (${delta.length} rows)`);
