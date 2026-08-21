/**
 * MIGRATION LEDGER CHECK. Work-list item 235.
 *
 * Asks one question: DOES EVERY SCHEMA CHANGE HAVE BOTH A FILE AND A LEDGER ENTRY,
 * UNDER THE SAME VERSION?
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────────────
 *
 * `apply_migration` stamps its own timestamp, so a migration applied that way leaves a
 * ledger entry with no file, and any local file keeps a version the ledger never saw.
 * Measured 21 August 2026: 120 local files, THREE registered in both, 117 local-only,
 * 125 remote-only. The changes are in the database; the record of which file produced
 * which change is not.
 *
 * Option A of item 235 is the rule this enforces: KEEP USING apply_migration, BUT ALWAYS
 * WRITE THE LOCAL FILE NAMED WITH THE VERSION THE TOOL RETURNS, in the same change.
 *
 * WITHOUT THIS CHECK THE RULE IS A HABIT, and item 232 is the evidence that habits
 * recorded clearly do not hold: the lessons were more present each time and failed faster
 * each time.
 *
 * ── THE OPENING STATE IS COVERAGE, NOT A FINDING ─────────────────────────────────────
 *
 * This check is born with 117 + 125 known divergences. THEY ARE A KNOWN ACCEPTED
 * POPULATION -- the same shape as the 35 unre-derivable ASINs -- and it MUST NOT
 * ESCALATE ON THE BACKLOG IT WAS BUILT TO STOP GROWING. A check that fails on its own
 * opening state is a check somebody switches off in a week, and then the new divergence
 * it existed to catch arrives unobserved.
 *
 * ── HOW A NEW DIVERGENCE IS TOLD FROM THE EXISTING ONE ───────────────────────────────
 *
 * BY SET MEMBERSHIP AGAINST A FROZEN BASELINE, NEVER BY COUNT.
 *
 * `.ledger-divergence-baseline.json` enumerates the 117 and the 125 BY VERSION as at
 * 21 August 2026. A divergent version is a FINDING if and only if it is ABSENT from
 * those lists. Membership is the whole mechanism, and it is what a count cannot do:
 *
 *   - a count cannot say WHICH entries moved, so it cannot name the offender;
 *   - a count can stay FLAT while one divergence is added and another reconciled, which
 *     is the exact case this check exists for and the exact case a threshold misses;
 *   - a count can only ever rise here, so any threshold on it degrades into noise as the
 *     accepted population is worked down.
 *
 * SHRINKING IS EXPECTED AND SILENT. A baseline entry that stops being divergent has been
 * reconciled; it is reported as progress and never as a finding. Baseline entries are
 * removed from the file only by the reconciliation job (step 3 of item 235), deliberately
 * and by a person.
 *
 * Item 194's form: exit 0 for ok or findings, exit 1 only for cannot_run.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { classifyDivergence } from '../lib/migration-ledger.ts';

const CHECK_NAME = 'migration-ledger';
const MIGRATIONS_DIR = 'supabase/migrations';
const BASELINE = `${MIGRATIONS_DIR}/.ledger-divergence-baseline.json`;
const SB = process.env.SUPABASE_URL;
const SKEY = process.env.SUPABASE_SERVICE_KEY;
const WRITE = process.argv.includes('--write-findings');

const cannotRun = (msg) => { console.error(`CANNOT RUN: ${msg}`); process.exit(1); };

for (const [n, v] of [['SUPABASE_URL', SB], ['SUPABASE_SERVICE_KEY', SKEY]]) {
  if (!v) cannotRun(`${n} is not set`);
}

const sb = async (path, init) => {
  let r;
  try {
    r = await fetch(`${SB}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (e) {
    cannotRun(`network error on ${path.split('?')[0]}: ${e.message}`);
  }
  if (!r.ok) cannotRun(`supabase ${r.status} on ${path.split('?')[0]}`);
  const body = await r.text();
  return body ? JSON.parse(body) : null;
};

// ── Inputs ───────────────────────────────────────────────────────────────────────────
let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch (e) {
  // A MISSING BASELINE IS cannot_run, NOT AN EMPTY ONE. Defaulting to "no accepted
  // population" would report all 242 known divergences as new findings on the first run.
  cannotRun(`baseline unreadable at ${BASELINE}: ${e.message}`);
}
if (!Array.isArray(baseline.local_only) || !Array.isArray(baseline.remote_only)) {
  cannotRun('baseline is missing local_only or remote_only');
}

let files;
try {
  files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
} catch (e) {
  cannotRun(`cannot read ${MIGRATIONS_DIR}: ${e.message}`);
}
// An empty migrations directory is far more likely a wrong working directory than a repo
// with no migrations, and treating it as data would report all 125 ledger entries as new.
if (files.length === 0) cannotRun(`no .sql files in ${MIGRATIONS_DIR}; refusing to treat every ledger entry as new`);

const localVersions = new Set(
  files.map((f) => (f.match(/^(\d{14}|\d{8,})_/) ?? [])[1]).filter(Boolean),
);
if (localVersions.size === 0) cannotRun('no local filenames matched a <version>_name.sql pattern');

const ledgerRows = await sb('rpc/fmb_migration_ledger', { method: 'POST', body: '{}' });
if (!Array.isArray(ledgerRows) || ledgerRows.length === 0) {
  // Same reasoning as the brand-hub check's empty-programmes guard: an empty read is far
  // more likely broken than true, and treating it as data reports every local file as new.
  cannotRun('migration ledger read returned nothing; refusing to report every file as divergent');
}
const ledgerVersions = new Set(ledgerRows.map((r) => String(r.version)));

// ── The comparison ───────────────────────────────────────────────────────────────────
// Set membership against the frozen baseline. The logic lives in lib/migration-ledger.ts
// and is tested there; this script supplies the inputs and reports. ONE implementation --
// a second copy here would be free to drift from the one the tests assert.
const baseLocal = new Set(baseline.local_only.map(String));
const baseRemote = new Set(baseline.remote_only.map(String));

const { localOnly, remoteOnly, newLocalOnly, newRemoteOnly, reconciled } = classifyDivergence({
  localVersions,
  ledgerVersions,
  baselineLocalOnly: baseLocal,
  baselineRemoteOnly: baseRemote,
});

const nameFor = Object.fromEntries(ledgerRows.map((r) => [String(r.version), r.name ?? '']));

const findings = [
  ...newLocalOnly.map((v) => ({
    key: `local_only:${v}`,
    summary: `NEW divergence: local migration file ${v} has no ledger entry. Either it was never applied, or it was applied under a different version by apply_migration.`,
  })),
  ...newRemoteOnly.map((v) => ({
    key: `remote_only:${v}`,
    summary: `NEW divergence: migration ${v} (${nameFor[v] || 'unnamed'}) is applied but has no local file. Write ${v}_<name>.sql into ${MIGRATIONS_DIR} (item 235, Option A).`,
  })),
];

// ── Report ───────────────────────────────────────────────────────────────────────────
console.log('==================================================================');
console.log(' Migration ledger check');
console.log('==================================================================\n');
console.log(`  local migration files    : ${files.length} (${localVersions.size} parsed versions)`);
console.log(`  ledger entries           : ${ledgerVersions.size}`);
console.log(`  registered in both       : ${[...localVersions].filter((v) => ledgerVersions.has(v)).length}`);
console.log('');
console.log(`  divergent now            : ${localOnly.length} local-only, ${remoteOnly.length} remote-only`);
console.log(`  accepted baseline        : ${baseLocal.size} local-only, ${baseRemote.size} remote-only (captured ${baseline.captured_on})`);
console.log('');
if (reconciled.length) {
  console.log(`  RECONCILED since baseline: ${reconciled.length} (progress, not a finding)`);
  for (const v of reconciled) console.log(`    ${v}`);
  console.log('');
}
console.log(`  findings                 : ${findings.length}`);
for (const f of findings) console.log(`    ${f.summary}`);

// ── Record ───────────────────────────────────────────────────────────────────────────
if (WRITE) {
  for (const f of findings) {
    await sb('standing_check_findings?on_conflict=check_name,finding_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ check_name: CHECK_NAME, finding_key: f.key, kind: 'finding', summary: f.summary, status: 'open' }),
    });
  }
  // COVERAGE: one line, never per row, never escalates. This is where the 117 and the 125
  // live. Asserted rather than omitted, because silence would read identically to "there is
  // no divergence" -- which is the opposite of true.
  await sb('standing_check_findings?on_conflict=check_name,finding_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      check_name: CHECK_NAME,
      finding_key: 'coverage:baseline',
      kind: 'coverage',
      status: 'open',
      summary: `${localOnly.length} local-only and ${remoteOnly.length} remote-only migration versions; ${baseLocal.size} + ${baseRemote.size} are the accepted baseline captured ${baseline.captured_on} (work-list item 235). Known population, not a to-do list.`,
      detail: {
        local_files: files.length,
        ledger_entries: ledgerVersions.size,
        divergent_local_only: localOnly.length,
        divergent_remote_only: remoteOnly.length,
        baseline_local_only: baseLocal.size,
        baseline_remote_only: baseRemote.size,
        reconciled_since_baseline: reconciled.length,
        new_divergences: findings.length,
      },
    }),
  });
  console.log('\n  findings and coverage recorded.');
} else {
  console.log('\n  (--write-findings not passed; nothing recorded)');
}

console.log(`\nRESULT: ${findings.length ? `${findings.length} NEW divergence(s) reported` : 'ok'}. Baseline population is coverage and never escalates.`);
process.exit(0);
