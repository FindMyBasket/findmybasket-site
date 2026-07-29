#!/usr/bin/env node
//
// ga4-diag.mjs — READ-ONLY GA4 discovery for Step 4 of the dashboard build.
// Writes nothing, anywhere. Every call is a GET or a runReport.
//
// Answers the four outstanding discovery questions from the Step 4 brief in one
// run, plus two guards that decide how the puller must read:
//
//   2.2  view_item eventCount over the last 7 days, ALONGSIDE page_view for the
//        same period. Reported together on purpose: page_view healthy +
//        view_item zero is a bug, both proportionally low is the consent gate
//        (public/fmb-cookie-banner.js does not load gtag.js until consent, so
//        trackViewItem no-ops for every non-consenting visitor). One figure
//        without the other cannot tell those apart.
//   2.3  Google Signals state, and whether any report comes back thresholded.
//        At 39-128 outbound clicks a week this is the finding most likely to
//        invalidate the design: thresholding suppresses rows ENTIRELY rather
//        than returning small numbers, so a zeroed week looks like no activity.
//   2.4  Whether BigQuery export is linked.
//   2.5  The by-network start date, from the data and nothing else.
//
// Guards, one extra query each, both of which change the puller:
//
//   RETENTION FLOOR. The earliest date the property returns ANY data at all.
//   Without it, a series that starts on date D is ambiguous: D could be when
//   affiliate_network was registered, or just where GA4's retention window
//   truncates. Those demand opposite conclusions and the boundary row in
//   platform_changes would record the wrong one.
//
//   REPORTING TIME ZONE. The GA4 `date` dimension is in the property's
//   reporting time zone. Postgres date_trunc('week', ...) buckets in UTC. If
//   they differ, events near midnight land in a different day, and at a week
//   edge a different week, which would silently skew the AWIN reconciliation
//   the Monday-week choice exists to serve.
//
// NOTE ON WEEKS: this script does NOT use GA4's `week` dimension, which starts
// on SUNDAY. It pulls `date` and buckets to Monday in code. See the brief.
//
// Auth: GOOGLE_APPLICATION_CREDENTIALS_JSON holds the service-account JSON as
// raw JSON, not a path. It is parsed, used to sign a JWT, and never printed,
// echoed or written to disk. No `set -x` in the calling workflow step.
//
// Env:
//   GOOGLE_APPLICATION_CREDENTIALS_JSON  service-account JSON (required)
//   GA4_PROPERTY_ID                      numeric property id (required)
//   HISTORY_START                        wide-scan start date (default 2026-01-01)

import { createSign } from 'node:crypto';

const PROPERTY = process.env.GA4_PROPERTY_ID;
const HISTORY_START = process.env.HISTORY_START || '2026-01-01';
const RAW_CREDS = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

// The measurement id is NOT the property id. gtag config takes G-Q3J7LSJFLQ;
// the Data API takes properties/<numeric>. v3 of the brief conflated them in
// three places, so fail loudly rather than send a G- string to runReport.
if (!PROPERTY || !/^\d+$/.test(PROPERTY)) {
  console.error(
    `::error::GA4_PROPERTY_ID must be the NUMERIC property id (e.g. 415465396), got ${
      PROPERTY ? JSON.stringify(PROPERTY) : '(unset)'
    }. G-Q3J7LSJFLQ is the measurement id and runReport will reject it.`,
  );
  process.exit(1);
}
if (!RAW_CREDS) {
  console.error('::error::GOOGLE_APPLICATION_CREDENTIALS_JSON is unset');
  process.exit(1);
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function accessToken() {
  let creds;
  try {
    creds = JSON.parse(RAW_CREDS);
  } catch {
    // Deliberately does not echo the value: a parse failure is usually a
    // truncated or quote-mangled secret, and printing it to a run log that
    // outlives the run would leak the private key.
    console.error('::error::GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON (value not shown)');
    process.exit(1);
  }
  if (!creds.client_email || !creds.private_key) {
    console.error('::error::credential JSON has no client_email / private_key — is it a service-account key?');
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: creds.client_email,
      // analytics.readonly covers BOTH the Data API (runReport) and the Admin
      // API reads below (Google Signals, BigQuery links). No write scope is
      // requested, so this script cannot mutate the property even by accident.
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${b64url(signer.sign(creds.private_key))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    console.error(`::error::token exchange failed (${res.status}): ${body.error_description || body.error || ''}`);
    process.exit(1);
  }
  console.log(`auth OK — service account ${creds.client_email}`);
  return body.access_token;
}

const TOKEN = await accessToken();

async function api(url, init) {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body, kept as text */
  }
  return { ok: res.ok, status: res.status, json, text };
}

const runReport = (body) =>
  api(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

// Rows come back as parallel dimension/metric arrays. Flatten to plain objects.
const rows = (r) =>
  (r?.rows || []).map((row) => ({
    d: (row.dimensionValues || []).map((v) => v.value),
    m: (row.metricValues || []).map((v) => Number(v.value)),
  }));

// A report is only trustworthy if GA4 says it was not thresholded. Surface this
// on EVERY report rather than once, since thresholding is applied per query.
function thresholdNote(r, label) {
  const md = r?.metadata || {};
  const flags = [];
  if (md.subjectToThresholding) flags.push('subjectToThresholding=TRUE');
  if (md.schemaRestrictionResponse?.activeMetricRestrictions?.length) flags.push('activeMetricRestrictions present');
  if (md.emptyReason) flags.push(`emptyReason=${md.emptyReason}`);
  console.log(
    flags.length
      ? `  [!] ${label}: ${flags.join(', ')}  <-- rows may be SUPPRESSED, not zero`
      : `  [ok] ${label}: not thresholded`,
  );
  return Boolean(md.subjectToThresholding);
}

// ISO Monday. Matches Postgres date_trunc('week', ...), and deliberately NOT
// GA4's `week` dimension, which starts Sunday.
function isoMonday(yyyymmdd) {
  const d = new Date(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T00:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

const NOT_SET = new Set(['(not set)', '(other)', '']);
const line = (t) => console.log(`\n${'='.repeat(74)}\n ${t}\n${'='.repeat(74)}`);

let thresholdingSeen = false;

// ── 2.2 ─────────────────────────────────────────────────────────────────────
// view_item and page_view together, plus retailer_click and affiliate_clickout.
// The last pair confirms the clickout events are alive and lets the two be
// compared: they fire on the SAME user action, so any total must count one.
line('2.2  EVENT VOLUMES, LAST 7 DAYS');
const events = await runReport({
  dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
  dimensions: [{ name: 'eventName' }],
  metrics: [{ name: 'eventCount' }],
  dimensionFilter: {
    filter: {
      fieldName: 'eventName',
      inListFilter: {
        values: ['view_item', 'page_view', 'retailer_click', 'affiliate_clickout', 'search', 'session_start'],
      },
    },
  },
});
if (!events.ok) {
  console.log(`  QUERY FAILED (${events.status}): ${events.json?.error?.message || events.text.slice(0, 400)}`);
} else {
  const counts = Object.fromEntries(rows(events.json).map((r) => [r.d[0], r.m[0]]));
  for (const name of ['page_view', 'session_start', 'view_item', 'retailer_click', 'affiliate_clickout', 'search']) {
    console.log(`  ${name.padEnd(20)} ${String(counts[name] ?? 0).padStart(8)}`);
  }
  thresholdingSeen = thresholdNote(events.json, 'event volumes') || thresholdingSeen;

  const pv = counts.page_view ?? 0;
  const vi = counts.view_item ?? 0;
  console.log('');
  if (pv > 0 && vi === 0) {
    console.log('  VERDICT: page_view healthy, view_item ZERO -> view_item is NOT reaching GA4.');
    console.log('           This is a BUG to report, not a tile to build around (PR #129, 27 Jul,');
    console.log('           DebugView verification was never completed).');
  } else if (pv === 0 && vi === 0) {
    console.log('  VERDICT: BOTH zero. Not a view_item question — no data at all for the window.');
    console.log('           Check the property id and the date window before concluding anything.');
  } else if (vi > 0) {
    console.log(`  VERDICT: view_item IS firing (${vi} in 7 days, ${(vi / Math.max(pv, 1) * 100).toFixed(1)}% of page_view).`);
  } else {
    console.log('  VERDICT: see figures above.');
  }
  console.log('  Reminder: gtag.js is not loaded until cookie consent, so every figure here is');
  console.log('  a CONSENTING-visitor figure. Compare against the server-side outbound_clicks');
  console.log('  table, which writes regardless of consent, to read the gap as a consent rate.');
}

// ── 2.5 + dimension resolution ──────────────────────────────────────────────
// One wide query at day granularity, not a backwards walk by week: it costs one
// call instead of many and gives the exact day rather than the week containing
// it. Bucketed to Monday afterwards for the weekly view.
line(`2.5  BY-NETWORK SERIES START  (scanning ${HISTORY_START} -> today)`);
const byNetwork = await runReport({
  dateRanges: [{ startDate: HISTORY_START, endDate: 'today' }],
  dimensions: [{ name: 'date' }, { name: 'customEvent:affiliate_network' }],
  metrics: [{ name: 'eventCount' }],
  dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: 'retailer_click' } } },
  limit: 100000,
});

let byNetworkStart = null;
if (!byNetwork.ok) {
  const msg = byNetwork.json?.error?.message || byNetwork.text.slice(0, 500);
  console.log(`  QUERY FAILED (${byNetwork.status}): ${msg}`);
  console.log('');
  console.log('  If the message names customEvent:affiliate_network as an unknown field, the');
  console.log('  custom dimension is NOT registered under that name and the ENTIRE by-network');
  console.log('  design fails. Do not fall back to customEvent:network — it was registered on');
  console.log('  27 Jul under v1 shorthand and no event sends a parameter by that name, so it');
  console.log('  collects nothing and always will.');
} else {
  const all = rows(byNetwork.json);
  const named = all.filter((r) => !NOT_SET.has(r.d[1]));
  console.log(`  rows: ${all.length} total, ${named.length} carrying a network value`);
  thresholdingSeen = thresholdNote(byNetwork.json, 'by-network scan') || thresholdingSeen;

  if (!named.length) {
    console.log('\n  NO dated row carries a network value. The dimension resolves but has never');
    console.log('  collected. Do NOT insert a boundary row: there is no series to bound.');
  } else {
    const dates = named.map((r) => r.d[0]).sort();
    byNetworkStart = dates[0];
    const iso = `${byNetworkStart.slice(0, 4)}-${byNetworkStart.slice(4, 6)}-${byNetworkStart.slice(6, 8)}`;
    console.log(`\n  EARLIEST DAY WITH A NETWORK VALUE: ${iso}  (ISO week beginning ${isoMonday(byNetworkStart)})`);
    console.log('  ^ this is the date for the platform_changes boundary row, subject to the');
    console.log('    retention-floor check below.');

    const values = [...new Set(named.map((r) => r.d[1]))].sort();
    console.log(`\n  distinct network values seen: ${values.join(', ')}`);
    console.log('  AffiliateNetwork in lib/analytics.ts:37 is awin / rakuten / amazon / ebay /');
    console.log('  other. Anything outside that set, or a stray casing, needs explaining before');
    console.log('  Step 4: metrics_ga4_weekly has a column per network and an unexpected value');
    console.log('  would land nowhere.');

    const weekly = new Map();
    for (const r of all) {
      const wk = isoMonday(r.d[0]);
      const net = NOT_SET.has(r.d[1]) ? '(not set)' : r.d[1];
      if (!weekly.has(wk)) weekly.set(wk, new Map());
      weekly.get(wk).set(net, (weekly.get(wk).get(net) || 0) + r.m[0]);
    }
    console.log('\n  retailer_click by ISO week (Monday) and network:');
    for (const wk of [...weekly.keys()].sort()) {
      const m = weekly.get(wk);
      const parts = [...m.entries()].sort().map(([k, v]) => `${k}=${v}`);
      console.log(`    ${wk}  ${parts.join('  ')}`);
    }
    console.log('\n  A "(not set)" column on a week means the events fired but the dimension was');
    console.log('  not yet applied. Those weeks take NULL in the by-network columns, never 0.');
  }
}

// ── RETENTION FLOOR ─────────────────────────────────────────────────────────
line('GUARD  RETENTION FLOOR  (does the property hold data before that date?)');
const floor = await runReport({
  dateRanges: [{ startDate: HISTORY_START, endDate: 'today' }],
  dimensions: [{ name: 'date' }],
  metrics: [{ name: 'eventCount' }],
  limit: 100000,
});
if (!floor.ok) {
  console.log(`  QUERY FAILED (${floor.status}): ${floor.json?.error?.message || floor.text.slice(0, 300)}`);
} else {
  const dates = rows(floor.json)
    .filter((r) => r.m[0] > 0)
    .map((r) => r.d[0])
    .sort();
  if (!dates.length) {
    console.log(`  No events at all since ${HISTORY_START}.`);
  } else {
    const earliest = dates[0];
    const isoE = `${earliest.slice(0, 4)}-${earliest.slice(4, 6)}-${earliest.slice(6, 8)}`;
    console.log(`  earliest day with ANY event: ${isoE}   (scan window opened ${HISTORY_START})`);
    if (byNetworkStart) {
      if (byNetworkStart === earliest) {
        console.log('\n  [!] The by-network series starts on the SAME day the property has any data');
        console.log('      at all. That is AMBIGUOUS: it is equally consistent with "the dimension');
        console.log('      was registered then" and with "retention truncates here". Widen');
        console.log('      HISTORY_START and re-run before recording a boundary date. Recording the');
        console.log('      wrong one puts a permanent false marker on every trend chart.');
      } else {
        console.log('\n  [ok] Events exist BEFORE the by-network start, so the start is a real');
        console.log('       dimension boundary and not a retention edge. Safe to record.');
      }
    }
  }
}

// ── REPORTING TIME ZONE ─────────────────────────────────────────────────────
line('GUARD  REPORTING TIME ZONE  (does GA4 bucket days the same way Postgres does?)');
{
  const md = events.json?.metadata || floor.json?.metadata || {};
  const tz = md.timeZone || '(not returned)';
  console.log(`  property reporting time zone: ${tz}`);
  console.log(`  currency: ${md.currencyCode || '(not returned)'}`);
  if (tz !== 'UTC' && tz !== '(not returned)') {
    console.log('\n  [!] NOT UTC. The GA4 `date` dimension is in the property time zone, but');
    console.log('      Postgres date_trunc(\'week\', ...) on outbound_clicks buckets in UTC. Events');
    console.log('      near midnight fall on different days in the two pipelines, and at a week');
    console.log('      edge in different WEEKS. State which convention metrics_ga4_weekly.week_start');
    console.log('      uses in its column comment, and use the same one in the cross-check.');
  } else if (tz === 'UTC') {
    console.log('\n  [ok] UTC, matching the Postgres side. No offset to reconcile.');
  }
}

// ── 2.3 ─────────────────────────────────────────────────────────────────────
line('2.3  GOOGLE SIGNALS AND DATA THRESHOLDING');
const signals = await api(
  `https://analyticsadmin.googleapis.com/v1alpha/properties/${PROPERTY}/googleSignalsSettings`,
);
if (!signals.ok) {
  console.log(`  Admin API read failed (${signals.status}): ${signals.json?.error?.message || signals.text.slice(0, 300)}`);
  console.log('  If this is 403, the service account has Data API access but not Admin API');
  console.log('  access. That is an operator task: grant Viewer on the PROPERTY in GA4 Admin.');
  console.log('  Fall back to the thresholding flags above, which are the effect that matters.');
} else {
  const state = signals.json?.state || '(unset)';
  console.log(`  googleSignalsSettings.state = ${state}`);
  console.log(`  consent                     = ${signals.json?.consent || '(unset)'}`);
  if (state === 'GOOGLE_SIGNALS_ENABLED') {
    console.log('\n  [!] ENABLED. With Signals on and low user counts, GA4 applies data');
    console.log('      thresholding: it SUPPRESSES rows entirely rather than returning small');
    console.log('      numbers. At 39-128 outbound clicks a week this property is squarely in');
    console.log('      that range, so whole weeks can silently read as nothing.');
  }
}
console.log('\n  Thresholding actually observed in this run: ' + (thresholdingSeen ? 'YES' : 'no'));
if (thresholdingSeen) {
  console.log('  [!] At least one report came back thresholded. The fix is a PROPERTY SETTING');
  console.log('      (turn Google Signals off, or accept and document the suppression), NOT a');
  console.log('      query change. Operator task. A puller built on thresholded reads would');
  console.log('      write suppressed rows as real zeros and the loss is unrecoverable.');
  console.log('      This also needs its own platform_changes row once resolved: changing it');
  console.log('      alters what every historical week shows.');
}

// ── 2.4 ─────────────────────────────────────────────────────────────────────
line('2.4  BIGQUERY EXPORT');
const bq = await api(`https://analyticsadmin.googleapis.com/v1alpha/properties/${PROPERTY}/bigQueryLinks`);
if (!bq.ok) {
  console.log(`  Admin API read failed (${bq.status}): ${bq.json?.error?.message || bq.text.slice(0, 300)}`);
} else {
  const links = bq.json?.bigQueryLinks || [];
  if (!links.length) {
    console.log('  No BigQuery links. Export is NOT enabled.');
    console.log('  Consequence: history not surfaced by the Data API is not recoverable, so the');
    console.log('  by-network start above is a hard floor. Enabling it now is not retroactive');
    console.log('  either — it would only help future gaps.');
  } else {
    for (const l of links) {
      console.log(`  linked project: ${l.project}  daily=${l.dailyExportEnabled} streaming=${l.streamingExportEnabled}`);
    }
    console.log('\n  Export IS enabled. Raw event parameters survive there even when the Data API');
    console.log('  cannot surface them, so pre-registration by-network history MAY be');
    console.log('  recoverable. Treat as a hypothesis to test against the export, not a finding.');
  }
}

line('END — nothing was written. All figures above are reads.');
