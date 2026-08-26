/**
 * BYTE-PARITY between the two implementations of the match key, asserted over the
 * WHOLE CATALOGUE rather than over a fixture list.
 *
 *   supabase/functions/_shared/match-key.ts   buildMatchKey()      (TypeScript)
 *   fmb_build_match_key(brand, name)          (SQL, in Postgres)
 *
 * WHY THE CORPUS AND NOT THE 50 CASES. The harness proves the rule is right on the
 * inputs someone thought of. This proves the two implementations AGREE on the
 * inputs that actually exist -- which is a different property, and the one that
 * rots. Item 345: agreement is what drifts; correctness is what gets tested.
 *
 * It also re-derives the stored-key drift as a by-product, because a re-key writes
 * every row anyway and the figure in circulation (2,709) is not what the query
 * returns (5,344 on 26 Aug 2026). Those may be different populations; the point is
 * that nobody should plan a backfill on a figure they have not re-derived.
 *
 * ── IT MUST FAIL LOUDLY WHEN IT CANNOT READ, NOT REPORT AGREEMENT ────────────
 *
 * THE FAILURE MODE OF A PARITY CHECK IS REPORTING ZERO DISAGREEMENTS BECAUSE IT
 * COMPARED ZERO ROWS. `gone-ids-drift` spent two runs green while unable to load
 * its own script, printing "No drift. The committed list matches live state."
 * (item 255). The same shape is available here for free: an empty page, a renamed
 * view, a revoked grant, and the loop exits with tsVsSql === 0 and a green tick.
 *
 * So this asserts BEFORE it concludes: the view must exist, the first page must be
 * non-empty, and the total compared must clear MIN_ROWS. A run that cannot look is
 * item 194's cannot_run state and exits 2, distinct from a run that looked and
 * found disagreements, which exits 1.
 *
 * Run:  npx tsx scripts/match-key-parity.mts
 * Needs SUPABASE_URL and SUPABASE_SERVICE_KEY (same names the other workflows use).
 */

import { createClient } from '@supabase/supabase-js';
import { buildMatchKey } from '../supabase/functions/_shared/match-key.ts';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('cannot_run: SUPABASE_URL and SUPABASE_SERVICE_KEY required');
  process.exit(2);
}
const db = createClient(url, key);

/** Floor, not a target. The catalogue was 99,967 on 26 Aug 2026; anything an order
 *  of magnitude below that means we are reading a slice, not the corpus. */
const MIN_ROWS = 50_000;

const PAGE = 1000;
let offset = 0;
let rows = 0;
let tsVsSql = 0;
let storedVsTs = 0;
const disagreements: string[] = [];

for (;;) {
  const { data, error } = await db
    .from('products_active_match_parity')
    .select('id, brand, name, stored, sql_key')
    .order('id')
    .range(offset, offset + PAGE - 1);

  // cannot_run, not "no disagreements". A missing view, a revoked grant and a
  // network failure all land here, and all of them would otherwise finish the loop
  // with a zero count and exit 0.
  if (error) {
    console.error(`cannot_run: ${error.message}`);
    process.exit(2);
  }
  if (offset === 0 && (!data || data.length === 0)) {
    console.error('cannot_run: the view returned no rows on the first page — reading a slice or nothing at all');
    process.exit(2);
  }
  if (!data || data.length === 0) break;

  for (const r of data as { id: number; brand: string; name: string; stored: string; sql_key: string }[]) {
    rows++;
    const ts = buildMatchKey(r.brand ?? '', r.name ?? '');
    if (ts !== r.sql_key) {
      tsVsSql++;
      if (disagreements.length < 20) {
        disagreements.push(`id ${r.id}\n  ts  ${JSON.stringify(ts)}\n  sql ${JSON.stringify(r.sql_key)}\n  <- ${r.brand} | ${r.name}`);
      }
    }
    if (r.stored !== ts) storedVsTs++;
  }
  if (data.length < PAGE) break;
  offset += PAGE;
}

// ASSERTED BEFORE ANY CONCLUSION IS PRINTED. Reaching this line with too few rows
// means the comparison did not happen, and saying so is the whole point.
if (rows < MIN_ROWS) {
  console.error(`cannot_run: compared ${rows} rows, below the ${MIN_ROWS} floor — this did not read the corpus`);
  process.exit(2);
}

console.log(`rows compared                     ${rows}`);
console.log(`TS vs SQL disagreements           ${tsVsSql}   <- MUST BE 0`);
console.log(`stored vs recomputed (re-derived) ${storedVsTs}   <- the backfill population`);
if (disagreements.length) {
  console.log('\nfirst disagreements:\n' + disagreements.join('\n\n'));
}

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(summary, [
    '### match-key parity',
    '',
    '| | |',
    '|---|---|',
    `| rows compared | ${rows} |`,
    `| **TS vs SQL disagreements** | **${tsVsSql}** |`,
    `| stored vs recomputed | ${storedVsTs} |`,
    '',
    tsVsSql === 0
      ? 'The two implementations agree on every row of the corpus.'
      : `**${tsVsSql} rows disagree.** The TypeScript and SQL halves have drifted; do not deploy either alone.`,
    '',
  ].join('\n'));
}

process.exit(tsVsSql === 0 ? 0 : 1);
