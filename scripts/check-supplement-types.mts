/**
 * FIXTURE CHECK for fmb_supplement_type(name, brand).
 *
 * The supplements browse type is DERIVED AT READ TIME, in SQL, inside the
 * products_active view. That was chosen over writing the value into
 * products.product_type because categorisation in the importer is creates-only
 * (items 105, 125), so a backfill would be durable for the rows it touched and every
 * new row would arrive NULL -- and on 27 Aug 2026, 533 of 2,461 live supplements rows
 * were less than 7 days old. A written column would have been roughly a fifth of the
 * page stale within a week, and the durable version puts the rule in Deno AND in SQL
 * with nothing forcing them to agree. That is the match-key twin shape.
 *
 * THE COST OF THAT CHOICE IS THIS FILE. A rule living in a SQL view is outside
 * lib/__tests__ and cannot be reached by the TypeScript suite. So the cases live in
 * `supplement_type_fixtures` and this asserts them.
 *
 * ── WHAT IT ASSERTS, AND WHAT IT DOES NOT ───────────────────────────────────
 *
 * It is a CHANGE DETECTOR, not an oracle. `expected` is the output recorded when the
 * fixture was frozen; `verdict` says what is actually claimed about it:
 *
 *   correct        read by name and judged right
 *   known_failure  read by name and judged WRONG, pinned so it cannot move silently
 *   pinned         inside the disputed population, recorded, not adjudicated
 *
 * Seven rows are wrong today and named in fmb_supplement_type's header. They are
 * pinned deliberately: a harness that only guards the cases you got right cannot tell
 * you when you fix one by accident, and it cannot tell the difference between a
 * deliberate improvement and a regression that happens to land on the same row.
 *
 * ── IT MUST FAIL LOUDLY WHEN IT CANNOT LOOK ─────────────────────────────────
 *
 * An empty failure list means either "every case passed" or "no cases were read", and
 * those are not the same result. `gone-ids-drift` spent two runs green printing "No
 * drift" from empty variables (item 255). So the fixture COUNT is read first and must
 * clear a floor before a zero is believed.
 *
 * Exit codes follow item 194's contract, the same as match-key-parity:
 *   0  looked, and every fixture agrees
 *   1  looked, and found disagreements
 *   2  cannot_run -- no credentials, missing function, or too few fixtures read
 *
 * Run:  npx tsx scripts/check-supplement-types.mts
 * Needs SUPABASE_URL and SUPABASE_SERVICE_KEY (the names the other workflows use).
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('cannot_run: SUPABASE_URL and SUPABASE_SERVICE_KEY required');
  process.exit(2);
}
const db = createClient(url, key);

/** Floor, not a target. 258 fixtures were seeded on 27 Aug 2026; the table only grows
 *  as cases are added. An order of magnitude below that means we are reading a slice
 *  or a truncated table, not the fixture set. */
const MIN_FIXTURES = 200;

const { data: countData, error: countErr } = await db.rpc('fmb_supplement_type_fixture_count');
if (countErr) {
  console.error(`cannot_run: fmb_supplement_type_fixture_count failed -- ${countErr.message}`);
  process.exit(2);
}
const fixtures = Number(countData ?? 0);
if (!Number.isFinite(fixtures) || fixtures < MIN_FIXTURES) {
  console.error(`cannot_run: read ${fixtures} fixtures, floor is ${MIN_FIXTURES}`);
  process.exit(2);
}

const { data: failures, error: failErr } = await db.rpc('fmb_supplement_type_fixture_failures');
if (failErr) {
  console.error(`cannot_run: fmb_supplement_type_fixture_failures failed -- ${failErr.message}`);
  process.exit(2);
}

type Failure = {
  name: string;
  brand: string | null;
  expected: string;
  actual: string;
  verdict: string;
  note: string | null;
};
const rows = (failures ?? []) as Failure[];

console.log(`fixtures read: ${fixtures}`);
console.log(`disagreements: ${rows.length}`);

if (rows.length === 0) {
  console.log('\nEvery fixture agrees with fmb_supplement_type.');
  process.exit(0);
}

console.error('\nFIXTURES THAT NO LONGER AGREE:\n');
for (const r of rows) {
  console.error(`  [${r.verdict}] ${r.name}`);
  console.error(`      brand:    ${r.brand ?? '(none)'}`);
  console.error(`      expected: ${r.expected}`);
  console.error(`      actual:   ${r.actual}`);
  if (r.note) console.error(`      note:     ${r.note}`);
  console.error('');
}

// A moved known_failure is not automatically a regression -- it may be the fix. It
// still fails, because the decision belongs to a person: update the fixture and say
// why in the same commit.
const moved = rows.filter(r => r.verdict === 'known_failure');
if (moved.length > 0) {
  console.error(
    `${moved.length} of these are pinned KNOWN FAILURES. If you fixed them, that is good -- ` +
    `re-seed the fixture and record the argument. Do not silence it.`,
  );
}
process.exit(1);
