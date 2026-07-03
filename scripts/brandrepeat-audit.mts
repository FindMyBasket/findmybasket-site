/**
 * SAFETY AUDIT for the brand-word-repetition strip added to _shared/match-key.ts.
 * Recomputes OLD (pre-strip) and NEW (shipped) match keys for every live product
 * and reports every collision group the strip NEWLY creates — so we can eyeball
 * that the strip only merges genuine same-products, never distinct SKUs.
 *
 *   npx tsx scripts/brandrepeat-audit.mts
 *
 * A newly-merged group is flagged RISK if its members disagree on canonical_size
 * or on shade (a hint the strip over-collapsed), CLEAN otherwise.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  buildMatchKey, normaliseForMatch, stripPromoTags, stripContainerNouns,
} from "../supabase/functions/_shared/match-key.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", ".env.local"), "utf8").split(/\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

// OLD buildMatchKey: exactly the pre-change logic (no stripLeadingBrandRepetition).
function oldKey(brand: string, name: string): string {
  const nb = normaliseForMatch(brand);
  const nn = stripContainerNouns(normaliseForMatch(stripPromoTags(name)));
  if (nb && nn.startsWith(nb + " ")) return nn;
  if (nb && nn === nb) return nb;
  return `${nb} ${nn}`.trim();
}

type Row = { id: number; brand: string | null; name: string | null; canonical_size: string | null; shade: string | null };
const rows: Row[] = [];
for (let off = 0; ; off += 1000) {
  const { data, error } = await sb.from("products_active")
    .select("id, brand, name, canonical_size, shade").order("id").range(off, off + 999);
  if (error) throw new Error(error.message);
  if (!data?.length) break;
  rows.push(...(data as Row[]));
  if (data.length < 1000) break;
}

const norm = (s: string | null) => (s == null ? "" : String(s).trim().toLowerCase());
const brandNorm = (s: string | null) => norm(s).replace(/\s+/g, " ");

// group by brand + NEW key
const groups = new Map<string, Row[]>();
for (const r of rows) {
  if (!r.name?.trim()) continue;
  const nk = buildMatchKey(r.brand || "", r.name);
  const g = `${brandNorm(r.brand)}||${nk}`;
  (groups.get(g) ?? groups.set(g, []).get(g)!).push(r);
}

let newlyMerged = 0, risk = 0, clean = 0;
const riskRows: string[] = [];
const cleanSample: string[] = [];
for (const [g, members] of groups) {
  if (members.length < 2) continue;
  // Was this group ALSO a collision under the OLD key? If all members shared one
  // old key too, the strip didn't create it. We care about groups the strip newly
  // unified: members that had >1 distinct old key.
  const oldKeys = new Set(members.map((m) => oldKey(m.brand || "", m.name || "")));
  if (oldKeys.size < 2) continue;           // pre-existing collision, not caused by the strip
  newlyMerged++;
  const sizes = new Set(members.map((m) => norm(m.canonical_size)).filter(Boolean));
  const shades = new Set(members.map((m) => norm(m.shade)).filter(Boolean));
  const isRisk = sizes.size > 1 || shades.size > 1;
  const line = `[${members[0].brand}] ${g.split("||")[1]}  ids=${members.map((m) => m.id).join(",")}  sizes={${[...sizes].join("|")}} shades={${[...shades].join("|")}}\n    ` +
    members.map((m) => `#${m.id} "${m.name}"`).join("\n    ");
  if (isRisk) { risk++; riskRows.push(line); } else { clean++; if (cleanSample.length < 40) cleanSample.push(line); }
}

console.log(`Live products: ${rows.length}`);
console.log(`Groups the brand-word strip NEWLY unified (>=2 distinct OLD keys → 1 NEW key): ${newlyMerged}`);
console.log(`  CLEAN (members agree on size & shade): ${clean}`);
console.log(`  RISK  (members disagree on size or shade — inspect): ${risk}\n`);
console.log("──── RISK groups ────");
for (const l of riskRows) console.log(l + "\n");
console.log("──── CLEAN sample (first 40) ────");
for (const l of cleanSample) console.log(l + "\n");
