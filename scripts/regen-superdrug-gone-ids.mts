/**
 * Regenerate GONE_IDS in lib/superdrug-removed.ts from the AUTHORITATIVE drop set.
 *
 * Run this RIGHT BEFORE the Step B flip (while r12 is still active). It computes the
 * exact set of products that will drop out of products_active when
 * `UPDATE retailers SET active=false WHERE id=12` runs — i.e. products that:
 *   - are structurally products_active-eligible (merged_into null, parent null, image ok)
 *   - currently have >=1 ACTIVE-retailer price row (so they're live now), AND
 *   - have NO active-retailer price row OTHER than Superdrug (12)
 * so once r12 goes inactive they have no active retailer left.
 *
 * This is active-qualified on purpose: a product with r12 + an INACTIVE secondary
 * (e.g. Amazon 9 / eBay 10) still drops at the flip and MUST be in GONE_IDS, whereas
 * the earlier "r12-only among all retailers" heuristic would have wrongly omitted it.
 *
 * Rewrites ONLY the GONE_IDS_RAW string literal in lib/superdrug-removed.ts, so the
 * hand-curated REDIRECTS map and GONE_HTML are preserved. Read-only against the DB.
 * REDIRECTS override GONE in the middleware, so GONE_IDS may safely include curated ids.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SUPERDRUG = 12;
const MODULE = "/workspaces/findmybasket-site/lib/superdrug-removed.ts";

const rawEnv = readFileSync("/workspaces/findmybasket-site/.env.local", "utf8");
const env = Object.fromEntries(rawEnv.split(/\n/).filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

// active retailer ids
const { data: rets } = await sb.from("retailers").select("id,active");
const active = new Set<number>((rets ?? []).filter((r: any) => r.active).map((r: any) => r.id));
if (!active.has(SUPERDRUG)) throw new Error("Superdrug (12) is already inactive — run this BEFORE the flip.");

// products currently in products_active
const inActive = new Set<number>();
for (let off = 0; ; off += 1000) { const { data } = await sb.from("products_active").select("id").order("id").range(off, off + 999); if (!data?.length) break; data.forEach((r: any) => inActive.add(r.id)); if (data.length < 1000) break; }

// per-product ACTIVE-retailer set
const activeRetByProduct = new Map<number, Set<number>>();
for (let off = 0; ; off += 1000) { const { data } = await sb.from("retailer_prices").select("product_id,retailer_id").order("product_id").range(off, off + 999); if (!data?.length) break; for (const r of data as any[]) { if (!active.has(r.retailer_id)) continue; (activeRetByProduct.get(r.product_id) ?? activeRetByProduct.set(r.product_id, new Set()).get(r.product_id)!).add(r.retailer_id); } if (data.length < 1000) break; }

// GONE = in products_active now, has active r12, no OTHER active retailer
const gone: number[] = [];
for (const pid of inActive) {
  const set = activeRetByProduct.get(pid);
  if (!set || !set.has(SUPERDRUG)) continue;
  if ([...set].some(r => r !== SUPERDRUG)) continue; // survives via another active retailer
  gone.push(pid);
}
gone.sort((a, b) => a - b);

// diff vs whatever GONE_IDS is currently committed
const src = readFileSync(MODULE, "utf8");
const prevMatch = src.match(/const GONE_IDS_RAW =\s*'([^']*)';/);
const prev = new Set<number>((prevMatch?.[1] ?? "").split(",").filter(Boolean).map(Number));
const added = gone.filter(id => !prev.has(id));
const removed = [...prev].filter(id => !gone.includes(id));

const next = src.replace(/const GONE_IDS_RAW =\s*'[^']*';/, `const GONE_IDS_RAW =\n  '${gone.join(",")}';`);
if (next === src) throw new Error("Could not find GONE_IDS_RAW literal to replace.");
writeFileSync(MODULE, next);

console.log("active retailers:", [...active].sort((a, b) => a - b).join(","));
console.log("authoritative GONE (drops at flip):", gone.length);
console.log("vs previously committed:", prev.size, " added:", added.length, " removed:", removed.length);
if (added.length) console.log("  sample added:", added.slice(0, 10).join(","));
if (removed.length) console.log("  sample removed:", removed.slice(0, 10).join(","));
console.log("lib/superdrug-removed.ts GONE_IDS_RAW rewritten. Review the diff, then commit before flipping.");
