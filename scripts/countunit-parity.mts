/**
 * Emit (id, js_key) VALUES for every live product whose name carries a count-unit
 * token, so a single SQL query can diff JS buildMatchKey vs SQL fmb_build_match_key.
 *   npx tsx scripts/countunit-parity.mts > /tmp/.../parity_values.sql
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  buildMatchKey, normaliseForMatch, stripPromoTags, stripContainerNouns,
  stripLeadingBrandRepetition,
} from "../supabase/functions/_shared/match-key.ts";

// key WITHOUT the count-unit step (to isolate rows the change actually affects)
function keyNoCountUnit(brand: string, name: string): string {
  const nb = normaliseForMatch(brand);
  const nn = stripLeadingBrandRepetition(stripContainerNouns(normaliseForMatch(stripPromoTags(name))), nb);
  if (!nb) return nn;
  if (nn === nb) return nb;
  if (nn.startsWith(nb + " ")) return nn;
  return `${nb} ${nn}`.trim();
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, "..", ".env.local"), "utf8").split(/\n/).filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const UNIT_RE = /(\d+\s*(pcs|pc|pieces|piece|pads|pad|patches|patch|sheets|sheet|ea|s)\b)|\b(pads|patches|pieces|sheets)\b/i;

type Row = { id: number; brand: string | null; name: string | null };
const rows: Row[] = [];
for (let off = 0; ; off += 1000) {
  const { data, error } = await sb.from("products").select("id, brand, name")
    .is("merged_into", null).order("id").range(off, off + 999);
  if (error) throw new Error(error.message);
  if (!data?.length) break;
  rows.push(...(data as Row[]));
  if (data.length < 1000) break;
}
// Only rows the count-unit change ACTUALLY affects (new JS key differs from the
// no-count-unit key) — the entire parity-risk surface. Unaffected rows are no-ops
// identical in JS and SQL by construction.
const cand = rows.filter((r) => r.name && UNIT_RE.test(r.name) &&
  buildMatchKey(r.brand || "", r.name) !== keyNoCountUnit(r.brand || "", r.name));
const esc = (s: string) => s.replace(/'/g, "''");
const STRIDE = Number(process.env.STRIDE || 1);
const sampled = cand.filter((_, i) => i % STRIDE === 0);
const vals = sampled.map((r) => `(${r.id},'${esc(buildMatchKey(r.brand || "", r.name || ""))}')`);
console.error(`affected=${cand.length} sampled=${sampled.length} (stride=${STRIDE})`);
console.log(`WITH v(id, js_key) AS (VALUES\n${vals.join(",\n")}\n)
SELECT count(*) AS total,
  count(*) FILTER (WHERE fmb_build_match_key(p.brand, p.name) IS DISTINCT FROM v.js_key) AS mismatches
FROM v JOIN products p ON p.id = v.id;`);
