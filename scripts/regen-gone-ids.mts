/**
 * Regenerate one departure's gone-set in lib/orphan-gate.ts from the AUTHORITATIVE
 * drop set.
 *
 *   npx tsx scripts/regen-gone-ids.mts <departure-key>
 *   npx tsx scripts/regen-gone-ids.mts branded_beauty
 *
 * PARAMETERISED, AT LAST. This script was hardcoded to `const SUPERDRUG = 12` while the
 * departure doctrine promised, in writing, that the next retirement could "reuse
 * scripts/regen-superdrug-gone-ids.mts with the retailer id parameterised". It could
 * not. The promise sat in the runbook unkept from the moment it was written, and was
 * only found by reading the code the runbook pointed at. Work-list item 126.
 *
 * The departure key and its retailer id are READ FROM THE MODULE, not re-declared here,
 * so the script and the data it rewrites cannot disagree about who is departing.
 *
 * Run this RIGHT BEFORE the flip (while the retailer is still active). It computes the
 * exact set of products that will drop out of products_active when
 * `UPDATE retailers SET active=false WHERE id=<retailerId>` runs — i.e. products that:
 *   - are structurally products_active-eligible (merged_into null, parent null, image ok)
 *   - currently have >=1 ACTIVE-retailer price row (so they're live now), AND
 *   - have NO active-retailer price row OTHER than Superdrug (12)
 * so once r12 goes inactive they have no active retailer left.
 *
 * This is active-qualified on purpose: a product with the departing retailer + an
 * INACTIVE secondary (e.g. Amazon 9 / eBay 10) still drops at the flip and MUST be in
 * the gone set, whereas a "retailer-only among all retailers" heuristic would have
 * wrongly omitted it.
 *
 * Rewrites ONLY that departure's GONE_RAW_<KEY> string literal, so every other
 * departure, the hand-curated REDIRECTS maps and GONE_HTML are all preserved. Read-only
 * against the DB. REDIRECTS override GONE in the middleware, so the gone set may safely
 * include curated ids.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { DEPARTURES } from "../lib/orphan-gate.ts";

const KEY = process.argv[2];
if (!KEY) {
  console.error("Usage: npx tsx scripts/regen-gone-ids.mts <departure-key>");
  console.error("Known keys: " + Object.keys(DEPARTURES).join(", "));
  process.exit(1);
}
const departure = DEPARTURES[KEY];
if (!departure) {
  console.error(`Unknown departure key '${KEY}'. Known: ${Object.keys(DEPARTURES).join(", ")}`);
  process.exit(1);
}
const RETAILER = departure.retailerId;
// The literal this run is allowed to touch. Anchored per departure so a run for one
// retailer cannot rewrite another's set -- the failure that a single shared literal
// would have made not just possible but likely.
const RAW_CONST = `GONE_RAW_${KEY.toUpperCase()}`;

// PATHS RESOLVE FROM THIS FILE, NOT FROM A MACHINE. These were hardcoded to
// /workspaces/findmybasket-site/... — a Codespace that no longer exists — so the script
// could not run anywhere else, which is part of why it was never re-run. Same defect
// class as the artefact it maintains: state frozen to an environment nobody checks.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE = resolve(REPO, "lib/orphan-gate.ts");

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
const POST_FLIP = !active.has(RETAILER);
if (POST_FLIP) console.log(`r${RETAILER} is INACTIVE — post-flip mode: recomputing from live state.`);

// products currently in products_active
const inActive = new Set<number>();
for (let off = 0; ; off += 1000) { const { data } = await sb.from("products_active").select("id").order("id").range(off, off + 999); if (!data?.length) break; data.forEach((r: any) => inActive.add(r.id)); if (data.length < 1000) break; }

// every product that has ever carried a Superdrug row (rows survive the flip)
const departingProducts = new Set<number>();
for (let off = 0; ; off += 1000) { const { data } = await sb.from("retailer_prices").select("product_id").eq("retailer_id", RETAILER).order("product_id").range(off, off + 999); if (!data?.length) break; data.forEach((r: any) => departingProducts.add(r.product_id)); if (data.length < 1000) break; }

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
  for (const pid of departingProducts) if (Number.isFinite(pid) && !inActive.has(pid)) gone.push(pid);
} else {
  // PRE-FLIP: in products_active now, has active r12, no OTHER active retailer.
  for (const pid of inActive) {
    const set = activeRetByProduct.get(pid);
    if (!set || !set.has(RETAILER)) continue;
    if ([...set].some(r => r !== RETAILER)) continue; // survives via another active retailer
    gone.push(pid);
  }
}
gone.sort((a, b) => a - b);

// diff vs whatever GONE_IDS is currently committed
const src = readFileSync(MODULE, "utf8");
const rawRe = new RegExp(`const ${RAW_CONST} =\\s*'([^']*)';`);
const prevMatch = src.match(rawRe);
const prev = new Set<number>((prevMatch?.[1] ?? "").split(",").filter(Boolean).map(Number));
const added = gone.filter(id => !prev.has(id));
const removed = [...prev].filter(id => !gone.includes(id));

if (!prevMatch) throw new Error(`Could not find ${RAW_CONST} literal to replace (format mismatch).`);

// REDIRECT COLLISION CHECK. The module merges every departure's redirects into one map
// and a duplicate key would silently resolve to whichever departure enumerates last.
// Middleware is the wrong place to detect that and the worst place to throw, so it is
// checked HERE, offline, where there is somewhere to report it.
const seen = new Map<string, string>();
for (const [k, d] of Object.entries(DEPARTURES)) {
  for (const id of Object.keys(d.redirects)) {
    const prevOwner = seen.get(id);
    if (prevOwner) throw new Error(`REDIRECTS collision on product ${id}: claimed by both '${prevOwner}' and '${k}'. Resolve before regenerating.`);
    seen.set(id, k);
  }
}

const next = src.replace(rawRe, `const ${RAW_CONST} =\n  '${gone.join(",")}';`);
writeFileSync(MODULE, next);
if (next === src) console.log("(no drift — regenerated set is identical to the committed one)");

console.log("active retailers:", [...active].sort((a, b) => a - b).join(","));
console.log("authoritative GONE (drops at flip):", gone.length);
console.log("vs previously committed:", prev.size, " added:", added.length, " removed:", removed.length);
if (added.length) console.log("  sample added:", added.slice(0, 10).join(","));
if (removed.length) console.log("  sample removed:", removed.slice(0, 10).join(","));
console.log(`lib/orphan-gate.ts ${RAW_CONST} rewritten. Review the diff, then commit and deploy BEFORE flipping.`);
console.log("GENERATE ON THE DAY. The one expensive thing about the Superdrug removal was a list generated eight days before it was used.");
