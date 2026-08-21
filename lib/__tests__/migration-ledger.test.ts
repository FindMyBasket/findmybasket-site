import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyDivergence } from '../migration-ledger.ts';

const baseline = JSON.parse(
  readFileSync(new URL('../../supabase/migrations/.ledger-divergence-baseline.json', import.meta.url), 'utf8'),
) as { local_only: string[]; remote_only: string[]; counts: Record<string, number> };

// ── The baseline itself ─────────────────────────────────────────────────────
test('baseline is the 117 + 125 captured on 21 August 2026', () => {
  assert.equal(baseline.local_only.length, 117);
  assert.equal(baseline.remote_only.length, 125);
  assert.equal(baseline.counts.local_only, 117);
  assert.equal(baseline.counts.remote_only, 125);
});

// ── THE CENTRAL PROPERTY: the opening state is coverage, not a finding ───────
test('the opening state reports ZERO findings — it must not escalate on its own backlog', () => {
  // Reconstruct the world as at baseline capture: every baseline entry still divergent.
  const local = [...baseline.local_only, 'shared1', 'shared2'];
  const ledger = [...baseline.remote_only, 'shared1', 'shared2'];
  const r = classifyDivergence({
    localVersions: local,
    ledgerVersions: ledger,
    baselineLocalOnly: baseline.local_only,
    baselineRemoteOnly: baseline.remote_only,
  });
  assert.equal(r.localOnly.length, 117);
  assert.equal(r.remoteOnly.length, 125);
  assert.deepEqual(r.newLocalOnly, [], 'baseline local-only must never be a finding');
  assert.deepEqual(r.newRemoteOnly, [], 'baseline remote-only must never be a finding');
  assert.deepEqual(r.reconciled, []);
});

// ── A new divergence, in each direction ─────────────────────────────────────
test('a migration applied with no local file is a finding', () => {
  const r = classifyDivergence({
    localVersions: ['20260101000000'],
    ledgerVersions: ['20260101000000', '20260901000000'],
    baselineLocalOnly: [],
    baselineRemoteOnly: [],
  });
  assert.deepEqual(r.newRemoteOnly, ['20260901000000']);
  assert.deepEqual(r.newLocalOnly, []);
});

test('a local file never applied is a finding', () => {
  const r = classifyDivergence({
    localVersions: ['20260101000000', '20260901000000'],
    ledgerVersions: ['20260101000000'],
    baselineLocalOnly: [],
    baselineRemoteOnly: [],
  });
  assert.deepEqual(r.newLocalOnly, ['20260901000000']);
  assert.deepEqual(r.newRemoteOnly, []);
});

// ── THE CASE A COUNT CANNOT SEE. This is why the check is set-based. ─────────
test('one added and one reconciled leaves the COUNT FLAT and still reports the new one', () => {
  const r = classifyDivergence({
    // 'old-b' has been reconciled (now has a ledger entry); 'brand-new' has appeared.
    localVersions: ['old-a', 'old-b', 'shared'],
    ledgerVersions: ['old-b', 'shared', 'brand-new'],
    baselineLocalOnly: ['old-a', 'old-b'],
    baselineRemoteOnly: [],
  });
  // Count of local-only fell 2 -> 1 while a NEW remote-only appeared: totals net to 2 either
  // way. A threshold on "total divergences" sees nothing. Set membership names the offender.
  assert.equal(r.localOnly.length + r.remoteOnly.length, 2);
  assert.deepEqual(r.newRemoteOnly, ['brand-new'], 'the new divergence must still be named');
  assert.deepEqual(r.newLocalOnly, []);
  assert.deepEqual(r.reconciled, ['old-b'], 'the reconciled one is progress, not a finding');
});

// ── Shrinking is silent ─────────────────────────────────────────────────────
test('reconciling baseline entries produces progress and no findings', () => {
  const r = classifyDivergence({
    localVersions: ['a', 'b'],
    ledgerVersions: ['a', 'b'],
    baselineLocalOnly: ['a', 'b'],
    baselineRemoteOnly: [],
  });
  assert.deepEqual(r.newLocalOnly, []);
  assert.deepEqual(r.newRemoteOnly, []);
  assert.deepEqual(r.reconciled, ['a', 'b']);
});

test('a fully reconciled repo is ok and silent', () => {
  const r = classifyDivergence({
    localVersions: ['a'], ledgerVersions: ['a'],
    baselineLocalOnly: [], baselineRemoteOnly: [],
  });
  assert.deepEqual(r.localOnly, []);
  assert.deepEqual(r.remoteOnly, []);
  assert.deepEqual(r.newLocalOnly, []);
  assert.deepEqual(r.newRemoteOnly, []);
});

// ── Today's two migrations, as a live regression ────────────────────────────
test("today's ledger-reader migration is NOT a divergence — it followed the rule", () => {
  // 20260821170949 was applied AND written to a local file in the same change.
  // 20260821164312 was applied before the rule existed, so it is in the baseline.
  const r = classifyDivergence({
    localVersions: ['20260821170949'],
    ledgerVersions: ['20260821170949', '20260821164312'],
    baselineLocalOnly: [],
    baselineRemoteOnly: ['20260821164312'],
  });
  assert.deepEqual(r.newRemoteOnly, [], 'the pre-rule migration is accepted baseline');
  assert.deepEqual(r.newLocalOnly, [], 'the rule-following migration is not divergent at all');
});
