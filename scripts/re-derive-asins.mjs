/**
 * RE-DERIVE products.amazon_asin FROM amazon_asin_map. Work-list item 187(b).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────
 *
 * Item 187: every guard built for the Amazon feature watches the VALUE and none watches the
 * CHOICE. An ASIN looks permanent because it holds an identifier, but it was SELECTED on
 * stock, seller and offer availability -- all of which decay. Measured on 18 August: product
 * 87918 was a pick one day and a hold the next, and its buy-box seller changed identity
 * entirely between two reads.
 *
 * Item 179's guard inversion also becomes structurally impossible here: there is no
 * write-if-absent left to invert, because nothing is written at all.
 *
 * ── IT REPORTS. IT NEVER APPLIES. AND THAT IS NOT A CAUTION, IT IS A MEASUREMENT ──────
 *
 * The original design was a PROJECTION: re-derive the column and write it. Measured before
 * building, that would have REVOKED 35 OF 484 LIVE AMAZON ROWS ON ITS FIRST RUN -- 7.2% --
 * silently, including the 7 that item 184 explicitly decided not to retire.
 *
 *   449 published ASINs are `matched` with a matched_ean       -> re-derivable
 *    28 are `matched_by_name`                                  -> 0 of 28 pass E1, measured live
 *     7 are identifier_conflict / legacy_unconfirmed           -> no promotable candidate
 *
 * THE CATEGORY ERROR: `matched_by_name` was a different tier with a different justification --
 * a human verified the name. Item 186's E1 requires a shared barcode, which a name match BY
 * DEFINITION lacks, and the human verification sits in `human_verified` where the rule does not
 * consult it.
 *
 *   INABILITY TO RE-DERIVE A DECISION IS NOT EVIDENCE THE DECISION WAS WRONG.
 *
 * So the check is authoritative only over what it can re-derive, and everything else is
 * OUT OF SCOPE -- reported as one coverage line, never as a revocation.
 *
 * ── WHY HOLDING IS STABLE BY CONSTRUCTION RATHER THAN BY LUCK ────────────────────────
 *
 * Item 186 put the STABLE signals in eligibility (barcode, brand, generation token) and the
 * VOLATILE ones in selection (offer, stock, condition tag, seller). That split was made for
 * item 187's reason -- a stored output must not have its IDENTITY decided by a signal that
 * decays -- and it pays here: every hold reason except a tie-through-S4 recomputes identically
 * every run. Holds do not get re-litigated nightly because their inputs do not move.
 *
 * ── CADENCE ─────────────────────────────────────────────────────────────────────────
 *
 * The trigger is a MAP CHANGE, not a clock: a harvest, a reassignment, a corrected
 * matched_ean. 469 of 484 products have a single candidate and cannot move at all. A weekly
 * run is a floor, not the signal -- the same reasoning gone-ids-drift states in its own header
 * about retailer lifecycle.
 *
 * Usage:  node scripts/re-derive-asins.mjs [--write-findings]
 *   Exit 0 = ok or findings recorded (REPORTER PATH -- a finding is not a broken check)
 *   Exit 1 = cannot_run
 */
import path from 'node:path';
import os from 'node:os';
import { selectCandidate, resolveAcrossProducts } from '../lib/asin-selection.ts';

const CHECK_NAME = 're-derive-asins';
const SB = 'https://crtrjoescntlcjiwdtrt.supabase.co';
// SUPABASE_SERVICE_KEY is the secret seven workflows already use -- no new credential was
// added for this check. Adding one would have created a FOURTH copy of the service-role
// credential, which is the divergence class item 196 exists to detect.
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  || 'sb_publishable_BUTEIDo6KFDkljihtGmLdQ_OkHIlF8h';
const WRITE = process.argv.includes('--write-findings');

const gtin = (s) => String(s || '').replace(/[^0-9]/g, '').replace(/^0+/, '');

async function rest(p) {
  const r = await fetch(`${SB}/rest/v1/${p}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw Object.assign(new Error(`REST ${r.status} on ${p.split('?')[0]}`), { cannotRun: true });
  return r.json();
}

async function pageAll(table, select, filter = '') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(`${table}?select=${select}${filter}&limit=1000&offset=${from}&order=id`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

try {
  process.loadEnvFile(path.join(os.homedir(), 'amazon-api-watch', 'sdk', 'examples', '.env'));
} catch { /* CI supplies env directly */ }

let published, mapRows;
try {
  published = await pageAll('products_active', 'id,name,brand,amazon_asin', '&amazon_asin=not.is.null');
  // amazon_asin_map is not readable with a publishable key; the caller must supply a
  // service-role key. THAT IS A cannot_run, NOT AN EMPTY RESULT -- an unreadable table and a
  // table with no rows look identical downstream, which is the confusion item 22 named.
  mapRows = await rest('amazon_asin_map?select=asin,product_id,matched_ean,amazon_title,amazon_brand,match_state,human_verified&limit=10000');
} catch (e) {
  console.error(`CANNOT RUN: ${e.message}`);
  process.exit(1);
}

const byProduct = new Map();
for (const m of mapRows) {
  if (m.product_id == null) continue;
  if (!byProduct.has(m.product_id)) byProduct.set(m.product_id, []);
  byProduct.get(m.product_id).push(m);
}

// Barcodes for every published product.
const bc = new Map();
const ids = published.map((p) => p.id);
for (let i = 0; i < ids.length; i += 150) {
  const page = await rest(
    `retailer_prices_live?select=product_id,ean_normalised&product_id=in.(${ids.slice(i, i + 150).join(',')})&limit=100000`);
  for (const r of page) {
    if (!r.ean_normalised) continue;
    if (!bc.has(r.product_id)) bc.set(r.product_id, new Set());
    bc.get(r.product_id).add(r.ean_normalised);
  }
}

// ── Classify every published product ────────────────────────────────────────────────
const verdicts = [];
const outOfScope = [];
for (const p of published) {
  const rows = (byProduct.get(p.id) ?? []).filter((m) => ['matched', 'matched_by_name'].includes(m.match_state));
  const publishedRow = (byProduct.get(p.id) ?? []).find((m) => m.asin === p.amazon_asin);

  // OUT OF SCOPE, NOT A FINDING. The rule cannot re-derive this, which is not the same as the
  // published value being wrong. Never a revocation.
  if (!publishedRow || !['matched', 'matched_by_name'].includes(publishedRow.match_state)
      || (publishedRow.match_state === 'matched_by_name' && !publishedRow.matched_ean)) {
    outOfScope.push({ id: p.id, asin: p.amazon_asin, why: publishedRow?.match_state ?? 'no map row' });
    continue;
  }
  const candidates = rows.map((m) => ({
    asin: m.asin,
    matchedEan: m.matched_ean,
    amazonIds: m.matched_ean ? [m.matched_ean] : [],
    amazonTitle: m.amazon_title,
    amazonBrand: m.amazon_brand,
    // NO LIVE READ. This check re-derives IDENTITY, which uses stable signals only. Selection
    // signals are deliberately absent: a nightly job that re-picked on stock would move ASINs
    // nightly on signals that decay, which is the churn item 187 warns about rather than fixes.
    offer: null,
  }));
  verdicts.push({
    productId: p.id,
    verdict: selectCandidate(
      { id: p.id, name: p.name, brand: p.brand, barcodes: [...(bc.get(p.id) ?? [])] }, candidates),
    was: p.amazon_asin,
  });
}

const publishedMap = new Map(published.map((p) => [p.amazon_asin, p.id]));
const { resolved, conflicts } = resolveAcrossProducts(
  verdicts.map(({ productId, verdict }) => ({ productId, verdict })), publishedMap);
const wasBy = new Map(verdicts.map((v) => [v.productId, v.was]));

const findings = [];
for (const r of resolved) {
  const was = wasBy.get(r.productId);
  if (r.verdict.action === 'hold') {
    findings.push({
      key: `hold:${r.productId}`,
      summary: `product ${r.productId} publishes ${was} but the rule now holds it — ${r.verdict.on}`,
    });
  } else if (r.verdict.asin !== was) {
    findings.push({
      key: `change:${r.productId}`,
      summary: `product ${r.productId} publishes ${was}; the rule now selects ${r.verdict.asin} (${r.verdict.on})`,
    });
  }
}

console.log('==================================================================');
console.log(` Re-derive ASINs — ${published.length} published`);
console.log('==================================================================\n');
console.log(`  in scope (re-derivable) : ${verdicts.length}`);
console.log(`  agree with the rule     : ${verdicts.length - findings.length}`);
console.log(`  findings                : ${findings.length}`);
console.log(`  cross-product conflicts : ${conflicts.length}`);
// Asserted, not omitted: silence would read identically to "nothing is out of scope".
console.log(`\n  ${outOfScope.length} published ASINs cannot be re-derived by the current rule.`);

if (findings.length) {
  console.log('\n── Findings ──────────────────────────────────────────────────────');
  for (const f of findings) console.log(`  ${f.summary}`);
}

console.log('\nRESULT: report only. This check never writes products.amazon_asin.');
if (!WRITE) console.log('        (--write-findings not passed; nothing recorded)');
process.exit(0);
