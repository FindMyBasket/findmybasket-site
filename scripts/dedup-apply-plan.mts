/**
 * Build the high-confidence APPLY plan from docs/dedup-candidates.json.
 *  - tier == high_confidence only
 *  - EXCLUDE the VT / IT-Cosmetics brand-mislabel group (held for brand fix)
 *  - INCLUDE the Purito "(New)" group (agreed same-retailer dup)
 *  - keeper = the CLEAN-named member: drop any name that DOUBLES the brand's
 *    first token; tie-break lowest id. Customer-facing name must be the clean one.
 * Prints the plan and flags every group whose keeper was overridden away from the
 * lowest id. Writes docs/dedup-apply-plan.json for the executor.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseForMatch } from "../supabase/functions/_shared/match-key.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", ".env.local"), "utf8").split(/\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const cand = JSON.parse(readFileSync(join(__dirname, "..", "docs", "dedup-candidates.json"), "utf8"));
let hi = cand.groups.filter((g: any) => g.tier === "high_confidence");

// EXCLUDE VT / IT-Cosmetics mislabel (ids 110955, 123650)
const VT_IDS = new Set([110955, 123650]);
hi = hi.filter((g: any) => !g.ids.some((i: number) => VT_IDS.has(i)));

// fetch names for all member ids
const allIds = [...new Set(hi.flatMap((g: any) => g.ids))];
const res = await fetch(`${url}/rest/v1/products?id=in.(${allIds.join(",")})&select=id,brand,name&limit=2000`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } });
const rows = await res.json();
const byId = new Map<number, any>(rows.map((r: any) => [r.id, r]));

const doubledBrand = (brand: string, name: string): boolean => {
  const bt = normaliseForMatch(brand).split(" ").filter(Boolean);
  if (!bt.length) return false;
  const nt = normaliseForMatch(name).split(" ").filter(Boolean);
  const first = bt[0];
  return nt.filter((t) => t === first).length >= 2;   // brand's first token appears 2+ times
};

type Plan = { keeper: number; keeperName: string; removed: number[]; brand: string; overrodeFrom: number | null };
const plan: Plan[] = [];
for (const g of hi) {
  const ids: number[] = [...new Set(g.ids as number[])].sort((a, b) => a - b);
  const lowest = ids[0];
  const clean = ids.filter((i) => { const r = byId.get(i); return r && !doubledBrand(r.brand || g.brand, r.name || ""); });
  const keeper = (clean.length ? clean : ids)[0]; // prefer clean; tie-break lowest id
  const removed = ids.filter((i) => i !== keeper);
  plan.push({
    keeper, keeperName: byId.get(keeper)?.name || "?", removed, brand: g.brand,
    overrodeFrom: keeper !== lowest ? lowest : null,
  });
}

plan.sort((a, b) => (a.brand || "").toLowerCase().localeCompare((b.brand || "").toLowerCase()) || a.keeper - b.keeper);
let groups = 0, rowsCollapse = 0;
const overrides: Plan[] = [];
for (const p of plan) { groups++; rowsCollapse += p.removed.length; if (p.overrodeFrom) overrides.push(p); }

console.log(`APPLY PLAN: ${groups} groups, ${rowsCollapse} rows collapse (VT excluded, Purito (New) included)\n`);
console.log(`KEEPER OVERRIDES (lowest id was a doubled-brand name → switched to clean sibling): ${overrides.length}`);
for (const p of overrides) {
  console.log(`  [${p.brand}] keeper ${p.overrodeFrom} -> ${p.keeper}`);
  console.log(`      was #${p.overrodeFrom}: ${byId.get(p.overrodeFrom!)?.name}`);
  console.log(`      now #${p.keeper}: ${p.keeperName}`);
}
writeFileSync(join(__dirname, "..", "docs", "dedup-apply-plan.json"), JSON.stringify({ generated: "high_confidence minus VT", groups, rowsCollapse, plan }, null, 2));
console.log(`\nWrote docs/dedup-apply-plan.json`);
