/**
 * READ-ONLY. Of the Atelier tier-A products (match_key hits a LIVE page),
 * how many land on pages where Superdrug (retailer 12) is currently a compared
 * retailer? Those pages lose a comparator this weekend; Atelier backfills them.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { buildMatchKey } from "../supabase/functions/_shared/match-key.ts";

const env = Object.fromEntries(
  readFileSync("./.env.local", "utf8").split(/\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

// ---- feed ----
const res = await fetch(process.env.FEED_URL!);
const buf = Buffer.from(await res.arrayBuffer());
const raw = (buf[0] === 0x1f && buf[1] === 0x8b) ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, ""); const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else { if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else if (c === "\r") {} else cell += c; } }
  if (cell.length || row.length) { row.push(cell); rows.push(row); } return rows;
}
const t = parseCsv(raw); const h = t[0].map(s => s.trim()); const body = t.slice(1).filter(r => r.length > 1);
const ci = (n: string) => h.indexOf(n);
const feedKeys = new Set<string>();
for (const r of body) { const name = (r[ci("title")] || "").trim(); const brand = (r[ci("brand")] || "").trim(); if (name) feedKeys.add(buildMatchKey(brand, name)); }

// ---- live pages: match_key -> [ids] ----
const keyToIds = new Map<string, number[]>();
for (let off = 0; ; off += 1000) {
  const { data } = await sb.from("products_active").select("id, match_key").order("id").range(off, off + 999);
  if (!data?.length) break;
  for (const p of data as any[]) if (p.match_key) { const a = keyToIds.get(p.match_key) || []; a.push(p.id); keyToIds.set(p.match_key, a); }
  if (data.length < 1000) break;
}

// tier-A live product ids (pages an Atelier product would join)
const tierAIds = new Set<number>();
let tierAFeedRows = 0;
for (const k of feedKeys) { const ids = keyToIds.get(k); if (ids) { tierAFeedRows++; for (const id of ids) tierAIds.add(id); } }

// ---- Superdrug (12) coverage: product_ids Superdrug currently prices ----
const superdrugIds = new Set<number>();
for (let off = 0; ; off += 1000) {
  const { data } = await sb.from("retailer_prices").select("product_id, in_stock").eq("retailer_id", 12).order("product_id").range(off, off + 999);
  if (!data?.length) break;
  for (const p of data as any[]) superdrugIds.add(p.product_id);
  if (data.length < 1000) break;
}
console.log("Superdrug (12) currently prices", superdrugIds.size, "distinct products total");

// intersection
const overlapPages = [...tierAIds].filter(id => superdrugIds.has(id));
console.log("\n=== TIER-A ∩ SUPERDRUG ===");
console.log("distinct LIVE pages tier-A products would join:", tierAIds.size);
console.log("...of which Superdrug is currently a compared retailer:", overlapPages.length);

// how many retailers each overlap page currently has (is Superdrug the ONLY comparator, i.e. page goes to 1 or 0 after removal?)
let solo = 0; const sample: string[] = [];
for (const id of overlapPages) {
  const { data } = await sb.from("retailer_prices").select("retailer_id").eq("product_id", id);
  const rids = new Set((data || []).map((x: any) => x.retailer_id));
  if (rids.size <= 1) solo++;
  if (sample.length < 20) {
    const { data: pr } = await sb.from("products_active").select("brand, name").eq("id", id).maybeSingle();
    sample.push(`#${id} [${rids.size} retailers${rids.has(12) ? ", incl Superdrug" : ""}] ${(pr as any)?.brand} - ${((pr as any)?.name || "").slice(0, 45)}`);
  }
}
console.log("...of those, pages where Superdrug is the ONLY comparator (would drop to Atelier-only after removal):", solo);
console.log("\nsample overlap pages:");
for (const s of sample) console.log("  " + s);
