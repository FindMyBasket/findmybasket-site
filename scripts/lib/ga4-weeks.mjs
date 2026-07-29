/*
 * Pure week/boundary helpers for the GA4 weekly puller.
 *
 * Extracted from scripts/ga4-weekly-pull.mjs so they can be tested without
 * credentials. The puller authenticates at module scope, so anything left
 * inside it is unreachable from a test, and these are precisely the functions
 * that must not be wrong: they decide which weeks are written and which are
 * withheld. See scripts/ga4-weeks.test.mjs.
 *
 * No I/O, no clock reads, no env. Every function takes what it needs.
 */

/** ISO Monday of the week containing `d`, as a UTC Date at midnight. */
export function isoMonday(d) {
  const x = new Date(d);
  const shift = (x.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  x.setUTCDate(x.getUTCDate() - shift);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export const ymd = (d) => d.toISOString().slice(0, 10);

export const addDays = (d, n) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

/**
 * THE predicate. True only when the ENTIRE week lies after `boundaryYmd`.
 *
 * Every boundary in this build landed mid-week, and a week containing one is a
 * blend of the old and new measurement. A blend is arithmetically a partial fix:
 * it does not read as broken, it reads as a plausible number, which is strictly
 * worse than an obviously absurd one. Excluding the straddling week is the whole
 * point, so this is deliberately stricter than "the boundary has passed".
 *
 * Both arguments are YYYY-MM-DD strings; lexicographic comparison is exact for
 * that format, which is why no Date is constructed here.
 */
export function weekFullyAfter(weekStartYmd, boundaryYmd) {
  return weekStartYmd > boundaryYmd;
}

/** The `n` trailing ISO weeks ending with the (partial) week containing `now`. */
export function trailingWeeks(now, n) {
  const monday = isoMonday(now);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = addDays(monday, -7 * i);
    out.push({ start: ymd(start), end: ymd(addDays(start, 6)) });
  }
  return out;
}

/**
 * Map a runReport response to { [weekStart]: { [dimValue]: number } }.
 *
 * Reads column positions from `dimensionHeaders` BY NAME rather than assuming
 * order. When more than one dateRange is supplied GA4 appends an implicit
 * `dateRange` dimension, and positional indexing would work today and break
 * silently the first time a dimension is added to a query, filing numbers under
 * the wrong week. That failure has no symptom on the dashboard.
 *
 * Throws rather than exiting, so a caller decides how to fail.
 */
export function byWeek(report, dimName, weeks) {
  const dimHeaders = (report.dimensionHeaders || []).map((h) => h.name);
  const rangeIdx = dimHeaders.indexOf('dateRange');
  const dimIdx = dimName ? dimHeaders.indexOf(dimName) : -1;
  if (rangeIdx === -1) throw new Error('report has no dateRange dimension; cannot attribute rows to weeks');
  if (dimName && dimIdx === -1) throw new Error(`report has no ${dimName} dimension`);

  const out = {};
  for (const w of weeks) out[w.start] = {};
  for (const row of report.rows || []) {
    const dv = (row.dimensionValues || []).map((v) => v.value);
    const wi = Number(String(dv[rangeIdx]).replace('date_range_', ''));
    const week = weeks[wi];
    if (!week) continue;
    const key = dimName ? dv[dimIdx] : '_';
    out[week.start][key] = (out[week.start][key] || 0) + Number(row.metricValues?.[0]?.value || 0);
  }
  return out;
}
