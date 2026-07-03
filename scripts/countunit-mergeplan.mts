/**
 * List the count-unit dupe groups that are STILL LIVE (unmerged) and build a
 * soft-merge plan. A group = brand + NEW match_key with >=2 distinct live ids that
 * had >1 distinct key WITHOUT the count-unit change (i.e. newly unified by it).
 * keeper = lowest live id. Prints keeper+merged names; writes docs/countunit-apply-plan.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  buildMatchKey, normaliseForMatch, stripPromoTags, stripContainerNouns,
  stripLeadingBrandRepetition, extractNameNumbers,
} from "../supabase/functions/_shared/match-key.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", ".env.local"), "utf8").split(/\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

function keyNoCountUnit(brand: string, name: string): string {
  const nb = normaliseForMatch(brand);
  const nn = stripLeadingBrandRepetition(stripContainerNouns(normaliseForMatch(stripPromoTags(name))), nb);
  if (!nb) return nn;
  if (nn === nb) return nb;
  if (nn.startsWith(nb + " ")) return nn;
  return `${nb} ${nn}`.trim();
}

type Row = { id: number; brand: string | null; name: string | null; canonical_size: string | null; shade: string | null; merged_into: number | null };
const rows: Row[] = [];
for (let off = 0; ; off += 1000) {
  const { data, error } = await sb.from("products")
    .select("id, brand, name, canonical_size, shade, merged_into")
    .is("merged_into", null).order("id").range(off, off + 999);
  if (error) throw new Error(error.message);
  if (!data?.length) break;
  rows.push(...(data as Row[]));
  if (data.length < 1000) break;
}
const bnorm = (s: string | null) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

const groups = new Map<string, Row[]>();
for (const r of rows) {
  if (!r.name?.trim()) continue;
  const g = `${bnorm(r.brand)}\t${buildMatchKey(r.brand || "", r.name)}`;
  (groups.get(g) ?? groups.set(g, []).get(g)!).push(r);
}

type Plan = { brand: string; key: string; keeper: number; keeperName: string; removed: { id: number; name: string }[]; numbers: string; cleanShade: boolean };
const plan: Plan[] = [];
for (const [g, members] of groups) {
  if (members.length < 2) continue;
  const oldKeys = new Set(members.map((m) => keyNoCountUnit(m.brand || "", m.name || "")));
  if (oldKeys.size < 2) continue;                       // not caused by count-unit change
  const ids = [...members].sort((a, b) => a.id - b.id);
  const keeper = ids[0];
  const numbers = [...new Set(members.map((m) => extractNameNumbers(m.name || "")))].join(" | ");
  plan.push({
    brand: keeper.brand || "", key: g.split("\t")[1], keeper: keeper.id, keeperName: keeper.name || "",
    removed: ids.slice(1).map((m) => ({ id: m.id, name: m.name || "" })),
    numbers, cleanShade: new Set(members.map((m) => (m.shade || "").toLowerCase()).filter(Boolean)).size <= 1,
  });
}
plan.sort((a, b) => (a.brand || "").toLowerCase().localeCompare((b.brand || "").toLowerCase()));

let n = 0;
for (const p of plan) {
  n++;
  console.log(`${String(n).padStart(2)}. [${p.brand}]  key="${p.key}"  numbers={${p.numbers}}${p.cleanShade ? "" : "  ⚠ multi-shade"}`);
  console.log(`     KEEP  #${p.keeper}: ${p.keeperName}`);
  for (const r of p.removed) console.log(`     merge #${r.id}: ${r.name}`);
}
console.log(`\n${plan.length} live count-unit groups; ${plan.reduce((s, p) => s + p.removed.length, 0)} rows would merge.`);
writeFileSync(join(__dirname, "..", "docs", "countunit-apply-plan.json"),
  JSON.stringify({ groups: plan.length, plan }, null, 2));
