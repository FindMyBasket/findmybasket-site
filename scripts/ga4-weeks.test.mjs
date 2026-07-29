import test from 'node:test';
import assert from 'node:assert/strict';
import { isoMonday, ymd, trailingWeeks, weekFullyAfter, byWeek } from './lib/ga4-weeks.mjs';

// ── isoMonday ───────────────────────────────────────────────────────────────
test('isoMonday: Sunday belongs to the week that STARTED, not the one beginning', () => {
  // The trap GA4 sets. Its own `week` dimension starts SUNDAY, so a Sunday here
  // must not roll forward or every Sunday's data lands in the following week.
  assert.equal(ymd(isoMonday(new Date('2026-08-02T23:59:59Z'))), '2026-07-27');
  assert.equal(ymd(isoMonday(new Date('2026-08-03T00:00:00Z'))), '2026-08-03');
});

test('isoMonday: a Monday is its own week start', () => {
  assert.equal(ymd(isoMonday(new Date('2026-07-27T00:00:00Z'))), '2026-07-27');
});

test('isoMonday: matches Postgres date_trunc(week) across a month boundary', () => {
  assert.equal(ymd(isoMonday(new Date('2026-09-01T12:00:00Z'))), '2026-08-31');
});

// ── weekFullyAfter: the boundary rule ───────────────────────────────────────
test('weekFullyAfter: the week CONTAINING a mid-week boundary is excluded', () => {
  // The gtag race fix: Wednesday 2026-07-29. The 27 July week holds ~2.6 broken
  // days and ~4.4 fixed days, so it is neither measurement.
  assert.equal(weekFullyAfter('2026-07-27', '2026-07-29'), false);
});

test('weekFullyAfter: the first week entirely after the boundary is included', () => {
  assert.equal(weekFullyAfter('2026-08-03', '2026-07-29'), true);
});

test('weekFullyAfter: earlier weeks are excluded', () => {
  assert.equal(weekFullyAfter('2026-07-20', '2026-07-29'), false);
});

test('weekFullyAfter: a boundary landing exactly on a Monday still excludes that week', () => {
  // That Monday's own hours are partly pre-boundary, so the week is a blend
  // like any other. Excluding it costs one week and prevents a wrong number.
  assert.equal(weekFullyAfter('2026-08-03', '2026-08-03'), false);
  assert.equal(weekFullyAfter('2026-08-10', '2026-08-03'), true);
});

test('weekFullyAfter: by-network start 2026-06-24 excludes the 22 June week', () => {
  // 24 June is a Wednesday, so the four by-network columns cannot sum to the
  // week total across it. First fully covered week is 29 June.
  assert.equal(weekFullyAfter('2026-06-22', '2026-06-24'), false);
  assert.equal(weekFullyAfter('2026-06-29', '2026-06-24'), true);
});

// ── trailingWeeks ───────────────────────────────────────────────────────────
test('trailingWeeks: returns n consecutive ISO weeks ending with the current one', () => {
  const w = trailingWeeks(new Date('2026-07-30T09:00:00Z'), 4); // a Thursday
  assert.deepEqual(w.map((x) => x.start), ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27']);
  assert.equal(w[3].end, '2026-08-02');
});

test('trailingWeeks: each range is exactly 7 days, Monday to Sunday', () => {
  for (const wk of trailingWeeks(new Date('2026-07-30T09:00:00Z'), 4)) {
    const days = (new Date(wk.end) - new Date(wk.start)) / 86400000;
    assert.equal(days, 6);
    assert.equal(new Date(wk.start).getUTCDay(), 1); // Monday
    assert.equal(new Date(wk.end).getUTCDay(), 0); // Sunday
  }
});

// ── byWeek: read headers by NAME, not position ──────────────────────────────
const WEEKS = trailingWeeks(new Date('2026-07-30T09:00:00Z'), 4);

test('byWeek: attributes rows via the implicit dateRange dimension', () => {
  const report = {
    dimensionHeaders: [{ name: 'dateRange' }],
    rows: [
      { dimensionValues: [{ value: 'date_range_0' }], metricValues: [{ value: '11' }] },
      { dimensionValues: [{ value: 'date_range_3' }], metricValues: [{ value: '44' }] },
    ],
  };
  const out = byWeek(report, null, WEEKS);
  assert.equal(out['2026-07-06']._, 11);
  assert.equal(out['2026-07-27']._, 44);
});

test('byWeek: survives dateRange arriving FIRST rather than last', () => {
  // The regression this function exists to prevent. Positional indexing would
  // read the network name as the week and file every number under nothing.
  const report = {
    dimensionHeaders: [{ name: 'dateRange' }, { name: 'customEvent:affiliate_network' }],
    rows: [
      { dimensionValues: [{ value: 'date_range_1' }, { value: 'awin' }], metricValues: [{ value: '7' }] },
    ],
  };
  const out = byWeek(report, 'customEvent:affiliate_network', WEEKS);
  assert.equal(out['2026-07-13'].awin, 7);
});

test('byWeek: survives dateRange arriving LAST', () => {
  const report = {
    dimensionHeaders: [{ name: 'customEvent:affiliate_network' }, { name: 'dateRange' }],
    rows: [
      { dimensionValues: [{ value: 'awin' }, { value: 'date_range_1' }], metricValues: [{ value: '7' }] },
    ],
  };
  const out = byWeek(report, 'customEvent:affiliate_network', WEEKS);
  assert.equal(out['2026-07-13'].awin, 7);
});

test('byWeek: every requested week is present even with no rows, so 0 and absent differ', () => {
  const out = byWeek({ dimensionHeaders: [{ name: 'dateRange' }], rows: [] }, null, WEEKS);
  assert.deepEqual(Object.keys(out).sort(), WEEKS.map((w) => w.start).sort());
  assert.equal(out['2026-07-27']._, undefined); // absent, NOT 0
});

test('byWeek: throws rather than guessing when dateRange is missing', () => {
  assert.throws(() => byWeek({ dimensionHeaders: [{ name: 'eventName' }], rows: [] }, null, WEEKS), /dateRange/);
});

test('byWeek: sums duplicate keys within a week', () => {
  const report = {
    dimensionHeaders: [{ name: 'eventName' }, { name: 'dateRange' }],
    rows: [
      { dimensionValues: [{ value: 'search' }, { value: 'date_range_0' }], metricValues: [{ value: '3' }] },
      { dimensionValues: [{ value: 'search' }, { value: 'date_range_0' }], metricValues: [{ value: '4' }] },
    ],
  };
  assert.equal(byWeek(report, 'eventName', WEEKS)['2026-07-06'].search, 7);
});
