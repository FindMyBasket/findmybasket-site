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
 * Run:  npx tsx scripts/match-key-parity.mts
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from '@supabase/supabase-js';
import { buildMatchKey } from '../supabase/functions/_shared/match-key.ts';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(2);
}
const db = createClient(url, key);

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
  if (error) { console.error(error.message); process.exit(1); }
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

console.log(`rows compared                    ${rows}`);
console.log(`TS vs SQL disagreements          ${tsVsSql}   <- MUST BE 0`);
console.log(`stored vs recomputed (re-derived) ${storedVsTs}   <- the backfill population`);
if (disagreements.length) {
  console.log('\nfirst disagreements:\n' + disagreements.join('\n\n'));
}
process.exit(tsVsSql === 0 ? 0 : 1);
