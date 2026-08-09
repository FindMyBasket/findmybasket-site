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
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPERDRUG = 12;

// PATHS RESOLVE FROM THIS FILE, NOT FROM A MACHINE. These were hardcoded to
// /workspaces/findmybasket-site/... — a Codespace that no longer exists — so the script
// could not run anywhere else, which is part of why it was never re-run. Same defect
// class as the artefact it maintains: state frozen to an environment nobody checks.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE = resolve(REPO, "lib/superdrug-removed.ts");

// Env from the process first (CI, or an inline SUPABASE_* export), .env.local second.
const envFile = resolve(REPO, ".env.local");
const fileEnv = existsSync(envFile)
  ? Object.fromEntries(readFileSync(envFile, "utf8").split(/\n/).filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }))
  : {};
const env = { ...fileEnv, ...process.env } as Record<string, string>;
const SB_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SB_URL || !SB_KEY) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY (or provide .env.local)");
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// active retailer ids
const { data: rets } = await sb.from("retailers").select("id,active");
const active = new Set<number>((rets ?? []).filter((r: any) => r.active).map((r: any) => r.id));
// TWO MODES, because the flip already happened and this script could only ever run
// before it. The original threw here, which meant the ONE thing that could correct the
// list was unrunnable from the moment the list started going stale.
//
//   PRE-FLIP  r12 still active  -> "which products WILL drop out"  (the original)
//   POST-FLIP r12 inactive      -> "which former r12 products have no live offer NOW"
//
// The post-flip set is the durable definition: it is a statement about the present, so
// it stays correct as long as it is re-run, whereas the pre-flip one is a prediction
// about an event that has passed.
const POST_FLIP = !active.has(SUPERDRUG);
if (POST_FLIP) console.log("r12 is INACTIVE — post-flip mode: recomputing from live state.");

// products currently in products_active
const inActive = new Set<number>();
for (let off = 0; ; off += 1000) { const { data } = await sb.from("products_active").select("id").order("id").range(off, off + 999); if (!data?.length) break; data.forEach((r: any) => inActive.add(r.id)); if (data.length < 1000) break; }

// every product that has ever carried a Superdrug row (rows survive the flip)
const r12Products = new Set<number>();
for (let off = 0; ; off += 1000) { const { data } = await sb.from("retailer_prices").select("product_id").eq("retailer_id", SUPERDRUG).order("product_id").range(off, off + 999); if (!data?.length) break; data.forEach((r: any) => r12Products.add(r.product_id)); if (data.length < 1000) break; }

// per-product ACTIVE-retailer set
const activeRetByProduct = new Map<number, Set<number>>();
for (let off = 0; ; off += 1000) { const { data } = await sb.from("retailer_prices").select("product_id,retailer_id").order("product_id").range(off, off + 999); if (!data?.length) break; for (const r of data as any[]) { if (!active.has(r.retailer_id)) continue; (activeRetByProduct.get(r.product_id) ?? activeRetByProduct.set(r.product_id, new Set()).get(r.product_id)!).add(r.retailer_id); } if (data.length < 1000) break; }

const gone: number[] = [];
if (POST_FLIP) {
  // A former Superdrug product with NO live offer today. Membership is decided by
  // products_active, which already encodes "has a price row at an ACTIVE retailer",
  // so a product that gained any retailer since the flip drops out of the list on the
  // next run — which is exactly what failed to happen for thirteen days.
  // Number.isFinite guard: a null product_id anywhere in the r12 rows would otherwise
  // reach the join as an empty token and land in the module as Number('') === 0. Harmless
  // by luck (there is no product 0) but it is a malformed id in a file that gates 20,000
  // URLs, and the next reader should not have to work out whether it matters.
  for (const pid of r12Products) if (Number.isFinite(pid) && !inActive.has(pid)) gone.push(pid);
} else {
  // PRE-FLIP: in products_active now, has active r12, no OTHER active retailer.
  for (const pid of inActive) {
    const set = activeRetByProduct.get(pid);
    if (!set || !set.has(SUPERDRUG)) continue;
    if ([...set].some(r => r !== SUPERDRUG)) continue; // survives via another active retailer
    gone.push(pid);
  }
}
gone.sort((a, b) => a - b);

// diff vs whatever GONE_IDS is currently committed
const src = readFileSync(MODULE, "utf8");
const prevMatch = src.match(/const GONE_IDS_RAW =\s*'([^']*)';/);
const prev = new Set<number>((prevMatch?.[1] ?? "").split(",").filter(Boolean).map(Number));
const added = gone.filter(id => !prev.has(id));
const removed = [...prev].filter(id => !gone.includes(id));

if (!prevMatch) throw new Error("Could not find GONE_IDS_RAW literal to replace (format mismatch).");
const next = src.replace(/const GONE_IDS_RAW =\s*'[^']*';/, `const GONE_IDS_RAW =\n  '${gone.join(",")}';`);
writeFileSync(MODULE, next);
if (next === src) console.log("(no drift — regenerated set is identical to the committed one)");

console.log("active retailers:", [...active].sort((a, b) => a - b).join(","));
console.log("authoritative GONE (drops at flip):", gone.length);
console.log("vs previously committed:", prev.size, " added:", added.length, " removed:", removed.length);
if (added.length) console.log("  sample added:", added.slice(0, 10).join(","));
if (removed.length) console.log("  sample removed:", removed.slice(0, 10).join(","));
console.log("lib/superdrug-removed.ts GONE_IDS_RAW rewritten. Review the diff, then commit before flipping.");
