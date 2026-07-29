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
// The `date` dimension is here for the arithmetic, not for display. An event
// that shipped part-way through the window is only live for part of it, and
// dividing its count by a FULL window of page_view understates it by whatever
// fraction of the window it did not exist for. That is how a healthy event reads
// as a health problem. Derived from the data rather than from a ship date on
// purpose: the ship date has already been wrong once (the brief says view_item
// merged 27 July, git says 974bcc0 landed on main on 25 July at 18:00 +0100),
// and deploy can lag merge again, so a constant here would be a third guess.
const events = await runReport({
  dateRanges: [{ startDate: '7daysAgo', endDate: 'yesterday' }],
  dimensions: [{ name: 'eventName' }, { name: 'date' }],
  metrics: [{ name: 'eventCount' }],
  dimensionFilter: {
    filter: {
      fieldName: 'eventName',
      inListFilter: {
        // basket_optimised, add_to_cart and load_routine_from_url added 29 Jul.
        // The hydration-race audit predicts add_to_cart healthy (fires from a
        // click handler), basket_optimised depressed on its auto_shared_link
        // path only, and load_routine_from_url at or near zero (it only ever
        // fires on emailed /app?routine= arrivals, which are always cold loads).
        // Measuring them turns those predictions into evidence for the ticket.
        values: [
          'view_item',
          'page_view',
          'retailer_click',
          'affiliate_clickout',
          'search',
          'session_start',
          'add_to_cart',
          'basket_optimised',
          'load_routine_from_url',
          // Enhanced measurement, added 29 Jul. These are fired by gtag.js
          // itself, NOT from a React mount effect, so they are NOT subject to
          // the hydration race that zeroed the custom `search` event. Their
          // presence alongside a dead custom event is the signal that the race
          // is the cause rather than low traffic.
          'view_search_results',
          'scroll',
          'click',
          'file_download',
          'form_start',
          'form_submit',
          'video_start',
          'user_engagement',
          'first_visit',
        ],
      },
    },
  },
  limit: 100000,
});
if (!events.ok) {
  console.log(`  QUERY FAILED (${events.status}): ${events.json?.error?.message || events.text.slice(0, 400)}`);
} else {
  // eventName -> { day -> count }
  const byDay = new Map();
  for (const r of rows(events.json)) {
    const [name, day] = r.d;
    if (!byDay.has(name)) byDay.set(name, new Map());
    byDay.get(name).set(day, (byDay.get(name).get(day) || 0) + r.m[0]);
  }
  const total = (name) => [...(byDay.get(name)?.values() || [])].reduce((a, b) => a + b, 0);
  const activeDays = (name) => [...(byDay.get(name)?.entries() || [])].filter(([, v]) => v > 0).map(([d]) => d);

  const windowDays = new Set([...byDay.values()].flatMap((m) => [...m.keys()])).size;
  for (const name of [
    'page_view',
    'session_start',
    'first_visit',
    'user_engagement',
    'view_item',
    'retailer_click',
    'affiliate_clickout',
    'search',
    'view_search_results',
    'scroll',
    'click',
    'add_to_cart',
    'basket_optimised',
    'load_routine_from_url',
    'file_download',
    'form_start',
    'form_submit',
    'video_start',
  ]) {
    const n = total(name);
    const days = activeDays(name).length;
    console.log(`  ${name.padEnd(20)} ${String(n).padStart(8)}   on ${days}/${windowDays} days`);
  }
  thresholdingSeen = thresholdNote(events.json, 'event volumes') || thresholdingSeen;

  const pv = total('page_view');
  const vi = total('view_item');
  const viDays = activeDays('view_item');
  // page_view restricted to the days view_item was actually alive. This is the
  // only denominator that makes the two comparable.
  const pvOnViDays = viDays.reduce((a, d) => a + (byDay.get('page_view')?.get(d) || 0), 0);

  console.log('');
  if (pv > 0 && vi === 0) {
    console.log('  VERDICT: page_view healthy, view_item ZERO -> view_item is NOT reaching GA4.');
    console.log('           A BUG to report, not a tile to build around.');
  } else if (pv === 0 && vi === 0) {
    console.log('  VERDICT: BOTH zero. Not a view_item question — no data at all for the window.');
    console.log('           Check the property id and the date window before concluding anything.');
  } else if (vi > 0) {
    const naive = (vi / Math.max(pv, 1)) * 100;
    const fair = (vi / Math.max(pvOnViDays, 1)) * 100;
    console.log(`  VERDICT: view_item IS firing (${vi} events on ${viDays.length} of ${windowDays} days).`);
    console.log(`           over the FULL window:        ${naive.toFixed(1)}% of page_view  <- understates it`);
    console.log(`           over its ACTIVE days only:   ${fair.toFixed(1)}% of page_view  <- use this one`);
    if (viDays.length < windowDays) {
      console.log('');
      console.log(`           view_item was live on only ${viDays.length} of ${windowDays} days in this window, so the`);
      console.log('           full-window figure divides a partial numerator by a whole denominator.');
      console.log('           Do NOT read the lower number as a health problem. Once the event has been');
      console.log('           live for a full window the two converge and this note stops appearing.');
    }
  } else {
    console.log('  VERDICT: see figures above.');
  }

  // An event that fires on ZERO of the window's days, while its server-side
  // counterpart is still recording, is not low volume. Consent scales a number
  // down, it does not zero it while other consent-gated events keep firing.
  const searchTotal = total('search');
  if (pv > 0 && searchTotal === 0) {
    console.log('');
    console.log('  [!] `search` is at ZERO across the whole window while other consent-gated');
    console.log('      events fire. Consent scales a count down, it does not zero one event and');
    console.log('      spare the rest. Cross-check against the server-side search_events table');
    console.log('      before treating this as low volume: if that table is recording and GA4 is');
    console.log('      not, the event is broken. See the Step 4 discovery findings in');
    console.log('      docs/dashboard-build-brief.md for the diagnosed cause.');
  }

  console.log('');
  console.log('  Reminder: gtag.js is not loaded until cookie consent, so every figure here is');
  console.log('  a CONSENTING-visitor figure. Compare against the server-side outbound_clicks');
  console.log('  table, which writes regardless of consent, to read the gap as a consent rate.');
}

// ── 2.6 SITE SEARCH: enhanced measurement vs the custom event ──────────────
// Added 29 July, from a Run A observation: `view_search_results` fired on
// gtag.js init while the custom `search` event sat at zero.
//
// WHY THIS MATTERS. view_search_results is GA4 ENHANCED MEASUREMENT. gtag.js
// fires it itself on load, reading the search term straight off the URL query
// parameter, so it never touches a React mount effect and is NOT subject to the
// hydration race that zeroed the custom event. It should therefore have history
// going back to whenever GA4 was installed, for consenting visitors, while
// `search` has none.
//
// WHAT IT DOES AND DOES NOT GIVE US. It carries search_term, so it can supply
// search VOLUME and the TERMS. It does NOT carry result_count, which rides on
// our own custom `search` event, so it cannot by itself produce zero-result
// rate. Its real value is as the DENOMINATOR for search-to-comparison rate,
// which the brief currently marks unbuildable.
//
// This block used to add "zero-result rate is Supabase-only anyway, per section
// 7 of the brief". That was the script asserting the answer to the question
// section 2.7 below now actually asks. Removed: a diagnostic that pre-judges a
// finding will be quoted as having established it.
line(`2.6  SITE SEARCH  (enhanced measurement vs the custom event, ${HISTORY_START} -> today)`);
const siteSearch = await runReport({
  dateRanges: [{ startDate: HISTORY_START, endDate: 'today' }],
  dimensions: [{ name: 'date' }, { name: 'eventName' }],
  metrics: [{ name: 'eventCount' }],
  dimensionFilter: {
    filter: { fieldName: 'eventName', inListFilter: { values: ['search', 'view_search_results'] } },
  },
  limit: 100000,
});
if (!siteSearch.ok) {
  console.log(`  QUERY FAILED (${siteSearch.status}): ${siteSearch.json?.error?.message || siteSearch.text.slice(0, 300)}`);
} else {
  const weekly = new Map();
  for (const r of rows(siteSearch.json)) {
    const [day, name] = r.d;
    const wk = isoMonday(day);
    if (!weekly.has(wk)) weekly.set(wk, { search: 0, view_search_results: 0 });
    weekly.get(wk)[name] = (weekly.get(wk)[name] || 0) + r.m[0];
  }
  const weeks = [...weekly.keys()].sort();
  if (!weeks.length) {
    console.log('  Neither event has fired in this window.');
  } else {
    console.log('  week (Mon)    search   view_search_results');
    let vsrTotal = 0;
    let sTotal = 0;
    for (const wk of weeks) {
      const v = weekly.get(wk);
      sTotal += v.search;
      vsrTotal += v.view_search_results;
      console.log(`    ${wk}  ${String(v.search).padStart(6)}   ${String(v.view_search_results).padStart(18)}`);
    }
    console.log(`    TOTAL     ${String(sTotal).padStart(6)}   ${String(vsrTotal).padStart(18)}`);
    console.log(`\n  earliest week with view_search_results: ${weeks.find((w) => weekly.get(w).view_search_results > 0) || 'none'}`);
    console.log(`  earliest week with the custom search  : ${weeks.find((w) => weekly.get(w).search > 0) || 'none'}`);
    thresholdNote(siteSearch.json, 'site search history');

    if (vsrTotal > 0 && sTotal === 0) {
      console.log('\n  [!] view_search_results HAS history while the custom `search` event has NONE.');
      console.log('      That is the hydration race isolated: the enhanced-measurement event fires');
      console.log('      from gtag.js and survived, the mount-effect event did not. It is also a');
      console.log('      usable series: search VOLUME and TERMS are available for the whole window');
      console.log('      above, predating the fix.');
      console.log('      It does NOT carry result_count, so it cannot give zero-result rate (that is');
      console.log('      Supabase-only regardless). It CAN serve as the denominator for');
      console.log('      search-to-comparison rate, whose numerator is view_item and therefore stays');
      console.log('      blocked until the race fix lands. Revisit that indicator in the brief.');
    } else if (vsrTotal > 0 && sTotal > 0) {
      console.log('\n  Both events have history. Do NOT sum them: they fire on the same user action.');
      console.log('  Pick one per metric and state which. The custom event carries result_count;');
      console.log('  the enhanced-measurement one has the longer series.');
    } else if (vsrTotal === 0) {
      console.log('\n  view_search_results has NOT fired. Check siteSearchEnabled and the query');
      console.log('  parameter list in the enhanced-measurement settings reported below: this site');
      console.log('  uses ?q=, which is in the GA4 default set, so zero here needs explaining.');
    }
  }
}

// ── 2.7 ─────────────────────────────────────────────────────────────────────
// IS `result_count` REGISTERED, AND IN WHICH SLOT?
//
// Why this gates the schema. metrics_ga4_weekly has no search columns at all,
// and which ones it needs depends on this answer. Building before knowing it
// means guessing or revisiting the table twice.
//
// The premise is sound: the post-fix verification run carried
// epn.result_count=151 on a live `search` hit, so GA4 RECEIVES the value. That
// is not the same as being able to query it. An unregistered event parameter is
// collected, retained against the event, and invisible to the Data API.
//
// THE SLOT MATTERS MORE THAN THE REGISTRATION, and this is the part most likely
// to be got wrong, because "is it a registered custom metric" sounds like the
// whole question:
//
//   Registered as a custom METRIC  -> the Data API returns it AGGREGATED, a sum
//     (and an average). That yields "average results per search", a real search
//     quality signal. It does NOT yield ZERO-RESULT RATE. A metricFilter filters
//     the aggregated ROWS of the report, not the individual events inside them,
//     so there is no way to get "how many searches returned exactly 0" out of a
//     column that has already been summed.
//
//   Registered as a custom DIMENSION -> the value is a groupable label, so
//     rows come back per distinct result_count and zero-result rate is
//     count(value='0') / count(all). This is the slot that answers the question
//     the dashboard actually asks.
//
// So "registered as a metric" and "zero-result rate is available from GA4" are
// different findings, and only the second makes GA4 a cross-check for the
// Supabase figure rather than an unrelated number beside it.
//
// BOTH SLOTS ARE PROBED TWICE: the Admin API for what is REGISTERED, and a real
// runReport for what is QUERYABLE. Registration is necessary and not sufficient
// (a registration can exist and return nothing), and this codebase has already
// been caught once by trusting a registry over the data: three shorthand
// dimensions were registered on 27 July that will never collect anything.
line('2.7  result_count  (registered? in which slot? queryable? since when?)');

const PARAM = 'result_count';
let metricRegistered = null; // null = could not establish
let dimensionRegistered = null;

const customMetrics = await api(
  `https://analyticsadmin.googleapis.com/v1alpha/properties/${PROPERTY}/customMetrics`,
);
if (!customMetrics.ok) {
  console.log(`  [?] customMetrics list FAILED (${customMetrics.status}): ${customMetrics.json?.error?.message || customMetrics.text.slice(0, 200)}`);
  console.log('      INCONCLUSIVE, not a negative. Do not read this as "not registered".');
} else {
  const list = customMetrics.json?.customMetrics || [];
  const hit = list.find((m) => m.parameterName === PARAM);
  metricRegistered = Boolean(hit);
  console.log(`  custom METRICS registered: ${list.length} (GA4 allows 50 event-scoped)`);
  for (const m of list) {
    console.log(`    - ${String(m.parameterName).padEnd(24)} ${m.displayName || ''} [${m.scope || '?'}, ${m.measurementUnit || '?'}]`);
  }
  console.log(hit
    ? `  [ok] ${PARAM} IS registered as a custom metric (unit ${hit.measurementUnit || '?'}, scope ${hit.scope || '?'})`
    : `  [!] ${PARAM} is NOT registered as a custom metric`);
}

const customDims = await api(
  `https://analyticsadmin.googleapis.com/v1alpha/properties/${PROPERTY}/customDimensions`,
);
if (!customDims.ok) {
  console.log(`  [?] customDimensions list FAILED (${customDims.status}): ${customDims.json?.error?.message || customDims.text.slice(0, 200)}`);
  console.log('      INCONCLUSIVE, not a negative.');
} else {
  const list = customDims.json?.customDimensions || [];
  const hit = list.find((d) => d.parameterName === PARAM);
  dimensionRegistered = Boolean(hit);
  console.log(`\n  custom DIMENSIONS registered: ${list.length}`);
  for (const d of list) {
    console.log(`    - ${String(d.parameterName).padEnd(24)} ${d.displayName || ''} [${d.scope || '?'}]`);
  }
  console.log(hit
    ? `  [ok] ${PARAM} IS also registered as a custom dimension (scope ${hit.scope || '?'})`
    : `  [!] ${PARAM} is NOT registered as a custom dimension`);
}

// Empirical probe 1: as a METRIC. Earliest date with a non-zero sum doubles as
// the series start, which registration date alone would not give.
const asMetric = await runReport({
  dateRanges: [{ startDate: HISTORY_START, endDate: 'today' }],
  dimensions: [{ name: 'date' }],
  metrics: [{ name: `customEvent:${PARAM}` }],
  limit: 100000,
});
console.log('');
if (asMetric.ok) {
  const r = rows(asMetric.json).filter((x) => x.m[0] > 0).sort((a, b) => a.d[0].localeCompare(b.d[0]));
  console.log(`  [ok] QUERYABLE as a metric. days with a non-zero sum: ${r.length}`);
  if (r.length) {
    console.log(`       earliest: ${r[0].d[0]}   latest: ${r[r.length - 1].d[0]}`);
    console.log(`       total across the window: ${r.reduce((a, x) => a + x.m[0], 0)}`);
  } else {
    console.log('       ...but every day is zero. Registered and empty is a real state:');
    console.log('       registration is NOT retroactive, so this reads as "registered after the');
    console.log('       last search" or "registered and never collected".');
  }
  thresholdNote(asMetric.json, 'result_count as metric');
} else {
  const msg = asMetric.json?.error?.message || asMetric.text.slice(0, 300);
  // A 400 naming the field is GA4 telling us the field does not exist: a real
  // negative. Anything else (401/403/5xx) is transport and proves nothing.
  const definitive = asMetric.status === 400 && new RegExp(PARAM).test(msg);
  console.log(definitive
    ? `  [!] NOT queryable as a metric. GA4 rejected the field: ${msg}`
    : `  [?] metric probe INCONCLUSIVE (${asMetric.status}): ${msg}`);
}

// Empirical probe 2: as a DIMENSION. This is the one that decides whether
// zero-result rate is available from GA4 at all.
const asDim = await runReport({
  dateRanges: [{ startDate: HISTORY_START, endDate: 'today' }],
  dimensions: [{ name: `customEvent:${PARAM}` }],
  metrics: [{ name: 'eventCount' }],
  limit: 1000,
});
console.log('');
if (asDim.ok) {
  const r = rows(asDim.json);
  const total = r.reduce((a, x) => a + x.m[0], 0);
  const zero = r.filter((x) => x.d[0] === '0').reduce((a, x) => a + x.m[0], 0);
  const other = r.filter((x) => NOT_SET.has(x.d[0])).reduce((a, x) => a + x.m[0], 0);
  console.log(`  [ok] QUERYABLE as a dimension. distinct values: ${r.length}, events: ${total}`);
  if (total > 0) {
    console.log(`       value '0': ${zero} events  =>  zero-result rate ${((zero / total) * 100).toFixed(1)}%`);
    console.log(`       (not set)/(other): ${other} events`);
    if (other > 0) {
      console.log('  [!] HIGH-CARDINALITY WARNING. result_count takes a distinct value per');
      console.log('      result total (0,1,2,...,151,...), and GA4 collapses rare values into');
      console.log('      (other) once a dimension goes wide. Anything in (other) is missing from');
      console.log('      the DENOMINATOR above, which INFLATES the zero-result rate: the numerator');
      console.log('      (value 0) is frequent and survives collapsing, the long tail does not.');
      console.log('      That is the flattering direction. Prefer the Supabase figure as primary');
      console.log('      and use this only as a cross-check, or register a low-cardinality');
      console.log('      zero-results boolean instead.');
    }
  }
  thresholdNote(asDim.json, 'result_count as dimension');
} else {
  const msg = asDim.json?.error?.message || asDim.text.slice(0, 300);
  const definitive = asDim.status === 400 && new RegExp(PARAM).test(msg);
  console.log(definitive
    ? `  [!] NOT queryable as a dimension. GA4 rejected the field: ${msg}`
    : `  [?] dimension probe INCONCLUSIVE (${asDim.status}): ${msg}`);
}

console.log('\n  WHAT THIS MEANS FOR metrics_ga4_weekly:');
if (dimensionRegistered === true) {
  console.log('   - zero-result rate IS available from GA4. It becomes a CROSS-CHECK against');
  console.log('     the Supabase figure, not a second source to be summed or substituted.');
  console.log('     They measure different populations: GA4 is consenting visitors, Supabase is');
  console.log('     everyone, so they should DISAGREE by roughly the consent ratio. Store both,');
  console.log('     label which is which, and never average them.');
} else if (dimensionRegistered === false) {
  console.log('   - zero-result rate is NOT available from GA4, whatever the metric slot says.');
  console.log('     It stays Supabase-only and needs no GA4 column. Registering the dimension');
  console.log('     later would start a series from that date, NOT backfill one.');
} else {
  console.log('   - UNDETERMINED: the dimension registry could not be read. Do not add a search');
  console.log('     column on the strength of the metric answer alone.');
}
if (metricRegistered === true) {
  console.log('   - average results per search IS available from GA4 (the sum, over the search');
  console.log('     event count). Worth a column as a search-quality signal in its own right;');
  console.log('     it is NOT zero-result rate and must not be labelled as one.');
}
console.log('   - Whatever is added: registration is not retroactive here either, so the column');
console.log('     starts empty before the registration date and needs a platform_changes row,');
console.log('     exactly like the by-network columns (id 7).');

// ── ENHANCED MEASUREMENT SETTINGS ──────────────────────────────────────────
// Never audited. `scroll` was observed firing in a browser session on 29 July,
// so at least part of this is on, and nobody has established what else.
line('ENHANCED MEASUREMENT  (which auto-collected events are switched on)');
const streams = await api(`https://analyticsadmin.googleapis.com/v1alpha/properties/${PROPERTY}/dataStreams`);
if (!streams.ok) {
  console.log(`  Admin API read failed (${streams.status}): ${streams.json?.error?.message || streams.text.slice(0, 200)}`);
} else {
  const web = (streams.json?.dataStreams || []).filter((s) => s.webStreamData);
  if (!web.length) console.log('  No web data streams found.');
  for (const s of web) {
    console.log(`  stream: ${s.displayName}  (${s.webStreamData.measurementId})  ${s.name}`);
    const em = await api(`https://analyticsadmin.googleapis.com/v1alpha/${s.name}/enhancedMeasurementSettings`);
    if (!em.ok) {
      console.log(`    settings read failed (${em.status}): ${em.json?.error?.message || ''}`);
      continue;
    }
    const e = em.json || {};
    // `pageViewsEnabled` WAS in this list and always printed " ? ". It is not
    // unreadable: THE FIELD DOES NOT EXIST. Verified 29 July against the live
    // discovery document
    // (analyticsadmin.googleapis.com/$discovery/rest?version=v1alpha,
    // schema GoogleAnalyticsAdminV1alphaEnhancedMeasurementSettings), which has
    // exactly eight *Enabled fields and no pageViewsEnabled. page_view is not a
    // toggle: it is collected whenever streamEnabled is true.
    //
    // The bug was not the missing field, it was the " ? " branch, which rendered
    // "I asked the API something it has no answer for" identically to "the API
    // declined to tell me". One is a script defect and the other is a property
    // fact, and they need opposite responses. Same shape as every other entry in
    // supabase/migrations/README.md convention 6: a construct that cannot fail
    // loudly. The unknown-key assert below is what makes it fail loudly now.
    const flags = [
      ['streamEnabled', 'enhanced measurement master switch'],
      ['scrollsEnabled', 'scroll'],
      ['outboundClicksEnabled', 'click (outbound)'],
      ['siteSearchEnabled', 'view_search_results'],
      ['formInteractionsEnabled', 'form_start / form_submit'],
      ['videoEngagementEnabled', 'video_*'],
      ['fileDownloadsEnabled', 'file_download'],
      ['pageChangesEnabled', 'page_view on history change (SPA route changes)'],
    ];
    for (const [k, label] of flags) {
      const v = e[k];
      console.log(`    ${v === true ? 'ON ' : v === false ? 'off' : ' ? '}  ${k.padEnd(26)} ${label}`);
      if (v !== true && v !== false) {
        console.log(`         [!] ${k} came back neither true nor false. Either GA4 renamed or`);
        console.log('             removed the field, or this script is asking for one that never');
        console.log('             existed. Check the discovery document before reading it as off.');
      }
    }
    console.log('    --  pageViewsEnabled            NOT AN API FIELD. page_view is always');
    console.log('                                    collected when streamEnabled is true.');
    // Report any *Enabled the API returned that this script does not know about.
    // Without this, a newly added toggle is simply invisible: the loop above can
    // only ever report on keys someone thought to list.
    const unknown = Object.keys(e).filter((k) => /Enabled$/.test(k) && !flags.some(([f]) => f === k));
    if (unknown.length) {
      console.log(`    [!] enhanced-measurement toggles this script does not know about: ${unknown.join(', ')}`);
    }
    console.log(`    searchQueryParameter : ${e.searchQueryParameter || '(default: q,s,search,query,keyword)'}`);
    console.log(`    uriQueryParameter    : ${e.uriQueryParameter || '(none)'}`);
    if (e.siteSearchEnabled === true) {
      console.log('\n    [ok] Site search is ON, so view_search_results is being collected. This');
      console.log('         site searches with ?q=, which is in the default parameter set.');
    }
    if (e.pageChangesEnabled === true) {
      console.log('\n    [!] pageChangesEnabled is ON, so page_view fires on SPA history changes');
      console.log('        as well as document loads. page_view is therefore a count of ROUTE');
      console.log('        VIEWS, not of page loads, and it is inflated relative to any');
      console.log('        server-side or document-load-based figure by however much');
      console.log('        client-side navigation the site does.');
      console.log('        CONSEQUENCE FOR THE DASHBOARD: page_view must not be used as a');
      console.log('        denominator without saying so. Any rate of the form');
      console.log('        <mount-effect event> / page_view is understated twice over, once by');
      console.log('        consent and once by this. Use `sessions` where a denominator is');
      console.log('        wanted, and state the definition next to the figure.');
    }
    if (e.outboundClicksEnabled === true) {
      console.log('    [!] Outbound clicks are ON, so GA4 auto-collects a `click` event on every');
      console.log('        outbound link IN ADDITION to our retailer_click and affiliate_clickout.');
      console.log('        That is a THIRD count of the same user action. Any outbound-click total');
      console.log('        must still use retailer_click only; do not let `click` into it.');
    }
  }
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
// Three numbers, reported side by side so they can be COMPARED rather than one
// inferred from another: the retention setting GA4 declares, the earliest day
// the property actually returns data for, and the by-network start found above.
//
// The trap this exists to catch: GA4 standard retention is 2 or 14 months. If
// the custom dimensions were registered BEFORE the retention window opens, the
// backwards scan returns the retention edge and nothing distinguishes it from a
// registration boundary. Recording that as the boundary would put a permanently
// wrong marker on every trend chart, reached by a method that looked rigorous.
line('GUARD  RETENTION  (setting, observed floor, and by-network start, compared)');

const MONTHS = {
  TWO_MONTHS: 2,
  FOURTEEN_MONTHS: 14,
  TWENTY_FIVE_MONTHS: 25,
  THIRTY_EIGHT_MONTHS: 38,
  FIFTY_MONTHS: 50,
};
let retentionMonths = null;
const retention = await api(
  `https://analyticsadmin.googleapis.com/v1alpha/properties/${PROPERTY}/dataRetentionSettings`,
);
if (!retention.ok) {
  console.log(
    `  retention setting: Admin API read failed (${retention.status}): ${
      retention.json?.error?.message || retention.text.slice(0, 200)
    }`,
  );
  console.log('  Fall back to the observed floor below, but note it can only ever show where');
  console.log('  data STOPS, never whether the setting or the registration date caused it.');
} else {
  const setting = retention.json?.eventDataRetention || '(unset)';
  retentionMonths = MONTHS[setting] ?? null;
  console.log(`  eventDataRetention          = ${setting}${retentionMonths ? ` (${retentionMonths} months)` : ''}`);
  console.log(`  resetUserDataOnNewActivity  = ${retention.json?.resetUserDataOnNewActivity ?? '(unset)'}`);
  if (retentionMonths) {
    const edge = new Date();
    edge.setUTCMonth(edge.getUTCMonth() - retentionMonths);
    console.log(`  implied earliest retained day = ${edge.toISOString().slice(0, 10)} (today minus ${retentionMonths} months)`);
  }
}

console.log('');
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
    console.log(`  earliest day with ANY event  = ${isoE}   (scan window opened ${HISTORY_START})`);
    console.log(
      `  by-network series start      = ${
        byNetworkStart
          ? `${byNetworkStart.slice(0, 4)}-${byNetworkStart.slice(4, 6)}-${byNetworkStart.slice(6, 8)}`
          : '(none found)'
      }`,
    );

    // The scan window itself can be the binding constraint, and it is the one
    // thing here that is our own doing rather than the property's.
    if (earliest === HISTORY_START.replace(/-/g, '')) {
      console.log('\n  [!] The earliest day found IS the first day of the scan window, so the');
      console.log('      window is the limit, not the property. Widen HISTORY_START and re-run.');
    }

    if (byNetworkStart) {
      if (byNetworkStart === earliest) {
        console.log('\n  [!] The by-network series starts on the SAME day the property has any data');
        console.log('      at all. That is AMBIGUOUS: it is equally consistent with "the dimension');
        console.log('      was registered then" and with "retention truncates here". Widen');
        console.log('      HISTORY_START and re-run before recording a boundary date. Recording the');
        console.log('      wrong one puts a permanent false marker on every trend chart.');
        console.log('      DO NOT insert the platform_changes row on this result.');
      } else {
        console.log('\n  [ok] Events exist BEFORE the by-network start, so the start is a real');
        console.log('       dimension boundary and not a retention edge. Safe to record.');
      }

      // Compare against the DECLARED setting too, not only the observed floor.
      // A property can be near its retention edge without having reached it, in
      // which case the observed floor looks reassuringly early while the real
      // constraint is days away.
      if (retentionMonths) {
        const edge = new Date();
        edge.setUTCMonth(edge.getUTCMonth() - retentionMonths);
        const edgeStr = edge.toISOString().slice(0, 10).replace(/-/g, '');
        const daysApart = Math.round(
          (Date.parse(`${byNetworkStart.slice(0, 4)}-${byNetworkStart.slice(4, 6)}-${byNetworkStart.slice(6, 8)}`) -
            Date.parse(edge.toISOString().slice(0, 10))) /
            86400000,
        );
        console.log(`\n  by-network start vs the ${retentionMonths}-month retention edge: ${daysApart} days`);
        if (Math.abs(daysApart) <= 7 || byNetworkStart <= edgeStr) {
          console.log('  [!] The start sits within a week of the declared retention edge, or beyond');
          console.log('      it. Treat the date as a retention artefact until proven otherwise: the');
          console.log('      dimensions may have been registered earlier and that history aged out.');
          console.log('      This is the case BigQuery export would resolve (see 2.4), because raw');
          console.log('      event parameters survive there after the Data API window closes.');
        } else {
          console.log('  [ok] Comfortably inside the retention window, so the setting is not what');
          console.log('       is bounding this series.');
        }
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

  // Zero-offset zones that are UTC under a different name. The first version of
  // this guard string-compared against the literal 'UTC' and reported Etc/GMT as
  // a mismatch, which is a false positive: Etc/GMT is GMT+0 with no daylight
  // saving, year round, so it agrees with UTC on every day boundary always.
  //
  // The false positive was not cosmetic. It pointed at a fix ("convert
  // outbound_clicks to the property time zone") which is a no-op at best, and
  // which would INTRODUCE a BST offset that does not currently exist if anyone
  // read "the property time zone" as Europe/London. A guard that names the wrong
  // remedy is worse than one that stays quiet.
  const ZERO_OFFSET_FIXED = new Set(['UTC', 'Etc/UTC', 'Etc/GMT', 'GMT', 'Etc/Greenwich', 'Etc/Zulu', 'Zulu', 'Universal', 'Etc/Universal']);
  const isUtcEquivalent = ZERO_OFFSET_FIXED.has(tz);

  if (!isUtcEquivalent && tz !== '(not returned)') {
    console.log('\n  [!] NOT UTC. The GA4 `date` dimension is in the property time zone, but');
    console.log('      Postgres date_trunc(\'week\', ...) on outbound_clicks buckets in UTC. Events');
    console.log('      near midnight fall on different days in the two pipelines, and at a week');
    console.log('      edge in different WEEKS.');
    console.log('');
    console.log('      FIX DIRECTION, decided 29 Jul: convert outbound_clicks to the PROPERTY');
    console.log('      time zone before bucketing. Do not adjust GA4 and do not re-bucket GA4');
    console.log('      into UTC. GA4 is the side that cannot be reprocessed, so the malleable');
    console.log('      pipeline is the one that moves.');
    console.log('');
    console.log('      Scale, measured 29 Jul: of 267 server-side clicks exactly 1 falls in the');
    console.log('      23:00 UTC hour, so 1 lands on a different day under Europe/London and 0');
    console.log('      cross a week boundary. 0.4% today, and it has never moved a weekly bucket.');
    console.log('      This is a SYSTEMATIC OFFSET, not a defect: during BST a UK day begins at');
    console.log('      23:00 UTC the previous day, so day-level disagreement scales with traffic');
    console.log('      and week-edge cases become inevitable as volume grows. Fix it while it is');
    console.log('      still arithmetic rather than a backfill.');
  } else if (isUtcEquivalent) {
    console.log(`\n  [ok] ${tz} is zero-offset with no daylight saving, so it IS UTC for bucketing`);
    console.log('       purposes and agrees with Postgres date_trunc on every day boundary, always.');
    console.log('       No offset exists and none should be introduced. Specifically: do NOT');
    console.log('       "convert outbound_clicks to the property time zone", and do not read that');
    console.log('       phrase as Europe/London, which would CREATE a BST offset that is not there.');
    console.log('       The guard stays in case the property time zone is ever changed.');
  } else {
    console.log('\n  [?] Time zone not returned. Re-run before assuming it matches.');
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
