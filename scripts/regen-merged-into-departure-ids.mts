/**
 * Regenerate GONE_RAW_MERGED_INTO_DEPARTURE in lib/orphan-gate.ts from live state.
 *
 *   npx tsx scripts/regen-merged-into-departure-ids.mts [--write]
 *
 * ── WHY THIS IS A RULE AND NOT A LIST ────────────────────────────────────────────────────
 *
 * These ids could have been pasted in once — 218 of them, derived with an ad-hoc query on
 * 24 August 2026. Item 254's finding is that a hand-derived list HAS NO SECOND USE: the
 * gone-sets for Superdrug and Branded Beauty cannot be regenerated because the script that
 * built them requires the departing retailer to still be active, and both are not. That was
 * discovered after it mattered.
 *
 * THIS SET WILL NEED A SECOND USE THE NEXT TIME A DEPARTURE COMPLETES, because the rule
 * below is defined against departures generally and its output grows whenever one happens.
 * So it gets a derivation now, while writing one is cheap, rather than a provenance note
 * that turns out to be unusable later.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────────
 *
 * A product belongs to this set when ALL of:
 *   1. it is not in products_active and not in products_servable  (it serves nothing itself)
 *   2. it is soft-merged or a shade variant  (merged_into or parent_product_id is set)
 *   3. it is not deliberately excluded  (product_exclusions)
 *   4. following merged_into ?? parent_product_id TRANSITIVELY — the same walk
 *      resolveCanonicalKeeper performs, same 12-hop cap — the chain terminates on a product
 *      that HAS price rows but NONE from an active retailer.
 *
 * Condition 4 is the whole point: the chain ends at a DEPARTED RETAILER'S product. The page
 * had content, the content is permanently gone, and no redirect target exists — so 410 says
 * exactly what is true. Measured 24 Aug 2026: 218 of 218 terminate this way.
 *
 * DELIBERATELY NOT INCLUDED: products with no price rows at all (104 on 24 Aug). Those never
 * had an offer, so nothing ever left. 410 claims a URL had content and lost it; for a URL
 * that was never a page, 404 is the honest answer and they keep it. Item 264.
 *
 * ── THE CAVEAT THAT TRAVELS WITH THE DECISION ────────────────────────────────────────────
 *
 * This set was static for four months when it was gated — 0 new in four weeks, median 111
 * days. THAT IS EVIDENCE ABOUT BEHAVIOUR, NOT ABOUT PERMANENCE. These are OUR merges, so
 * their permanence is guaranteed by nobody changing their mind rather than by anything
 * observed. A merge is permanent until someone un-merges it. A retailer departure is
 * permanent because someone external decided; this is not the same kind of fact, and the
 * 410 rests on the weaker one.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

// THE RULE LIVES IN THE DATABASE, in public.fmb_merged_into_departure_ids(), so it has ONE
// definition rather than one here and one there. This script transports the result into the
// edge bundle; it does not decide what belongs in the set.
const { data, error } = await sb.rpc("fmb_merged_into_departure_ids");
if (error || !data) {
  console.error("fmb_merged_into_departure_ids() failed: " + (error?.message ?? "no rows"));
  process.exit(1);
}
const ids: number[] = (data as { id: number }[]).map((r) => r.id);

const raw = ids.join(",");
console.log(`derived ${ids.length} ids`);

if (process.argv.includes("--write")) {
  const p = resolve(ROOT, "lib/orphan-gate.ts");
  const src = readFileSync(p, "utf8");
  const re = /(const GONE_RAW_MERGED_INTO_DEPARTURE =\s*\n\s*')[^']*(')/;
  if (!re.test(src)) { console.error("anchor not found in lib/orphan-gate.ts"); process.exit(1); }
  writeFileSync(p, src.replace(re, `$1${raw}$2`));
  console.log("wrote lib/orphan-gate.ts");
} else {
  console.log(raw.slice(0, 120) + (raw.length > 120 ? " …" : ""));
  console.log("(dry run — pass --write to update lib/orphan-gate.ts)");
}
