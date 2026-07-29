#!/usr/bin/env node
/*
 * GA4 weekly puller -> public.metrics_ga4_weekly   (Step 4 of the dashboard build)
 *
 * Runs in GitHub Actions, not pg_cron-to-edge: GOOGLE_APPLICATION_CREDENTIALS_JSON
 * lives in Actions and nowhere else, RS256 JWT signing is trivial in node:crypto
 * and painful in Deno WebCrypto, and SUPABASE_SERVICE_KEY is already an Actions
 * secret. Zero dependencies, same as scripts/ga4-diag.mjs and for the same
 * reason: a job holding a private key should not also pull an install tree.
 *
 * ENV
 *   GOOGLE_APPLICATION_CREDENTIALS_JSON  service-account JSON, raw (not a path)
 *   GA4_PROPERTY_ID                      NUMERIC id. 415465396. NOT G-Q3J7LSJFLQ
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY   upsert target
 *   WEEKS                                trailing ISO weeks to re-pull, 1..4, default 4
 *   DRY_RUN                              anything but the literal "false" = no write
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE EXISTS TO ENFORCE: a week is only written for a metric if
 * the ENTIRE week lies after that metric's boundary.
 *
 * Every boundary here landed mid-week, and a week that straddles one is neither
 * the old measurement nor the new one. It is a blend, which is arithmetically a
 * partial fix and reads as a plausible number rather than an obviously broken
 * one. That is the whole argument in section 4.1 of the build brief, and it
 * applies to the by-network columns exactly as it applies to the suppressed
 * five. One helper, weekFullyAfter(), decides all of them. Do not add a second
 * per-metric date check: three independent checks is how the fourth gets missed.
 * ---------------------------------------------------------------------------
 */

import { createSign } from 'node:crypto';
import { weekFullyAfter, trailingWeeks, byWeek as byWeekPure } from './lib/ga4-weeks.mjs';

const PROPERTY = process.env.GA4_PROPERTY_ID;
const RAW_CREDS = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DRY_RUN = process.env.DRY_RUN !== 'false';
const WEEKS = Math.min(4, Math.max(1, Number(process.env.WEEKS || 4)));

function die(msg) {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
}

if (!RAW_CREDS) die('GOOGLE_APPLICATION_CREDENTIALS_JSON is not set');
if (!PROPERTY) die('GA4_PROPERTY_ID is not set');
// The measurement id has been passed as "property" before, in three places in
// v3 of the brief. runReport rejects it with an opaque error, so fail here with
// a legible one instead.
if (/^G-/.test(PROPERTY)) {
  die(`GA4_PROPERTY_ID is "${PROPERTY}", a MEASUREMENT id. runReport needs the NUMERIC property id (415465396).`);
}
if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  die('SUPABASE_URL and SUPABASE_SERVICE_KEY are required unless DRY_RUN');
}

/*
 * GA4's `dateRanges` accepts at most FOUR ranges per request, which is why WEEKS
 * is capped at 4 rather than being a free trailing window.
 *
 * One range per week, rather than one query with a `date` dimension summed in
 * code, because SESSIONS ARE NOT ADDITIVE. GA4 attributes a session to the date
 * it began, so summing seven daily session counts double-counts nothing but
 * still answers a different question from "sessions in this week" whenever a
 * session spans midnight. Letting GA4 aggregate over the week is exact.
 * Event counts ARE additive and would survive either method; they use the same
 * one so there is a single shape to reason about.
 *
 * The brief requires re-pulling a trailing window of at least THREE weeks
 * because GA4 processing lags 24 to 48 hours, so the most recent week is always
 * provisional. Upserting on week_start means a later run corrects an earlier
 * one rather than appending a second row.
 */

// ── BOUNDARIES ──────────────────────────────────────────────────────────────
// Dates, not instants, because the comparison is against a whole week. Each is
// the moment the metric BEGAN to be trustworthy.

// platform_changes id 7. GA4 custom dimensions are not retroactive, so
// affiliate_network has no value before this. 24 June is a WEDNESDAY, so the
// 2026-06-22 week is partial: the four by-network columns cannot sum to the
// week's true total across it. First fully-covered week is 2026-06-29.
const BY_NETWORK_START = '2026-06-24';

// view_item merged as 974bcc0 on 2026-07-25 at 18:00 +0100. NOTE THE KNOWN
// IMPRECISION: this is the MERGE, and the deploy that made it reachable was
// later by an unknown amount. It is used only to separate "the event did not
// exist" (write NULL) from "the event existed and was undercounting" (write the
// number, suppress the display), so erring toward the merge date is the safe
// direction: it can only make us write NULL for a week we might have written a
// biased number for. Do not reuse this constant as a data boundary.
const VIEW_ITEM_START = '2026-07-25';

// platform_changes id 17, the gtag hydration race fix, at the DEPLOY instant
// 2026-07-29T14:12:58Z. A Wednesday, so the 2026-07-27 week straddles it and
// the first trustworthy week is 2026-08-03.
const GTAG_FIX = '2026-07-29';

// ── THE TRAILING WINDOW ─────────────────────────────────────────────────────
// The current (partial) ISO week and the WEEKS-1 before it.
//
// ISO Monday everywhere, matching Postgres date_trunc('week', ...). Deliberately
// NOT GA4's `week` dimension, which starts SUNDAY, nor `isoWeek`: the bucketing
// is done in scripts/lib/ga4-weeks.mjs where it is covered by tests.
//
// NO TIMEZONE CONVERSION ANYWHERE IN THIS FILE. The property reports Etc/GMT,
// which is UTC with no offset and no DST, so GA4 dates and Postgres dates
// already agree. Converting to Europe/London would INTRODUCE a BST offset that
// is not there. This has already been got wrong once, in the opposite
// direction, by string-comparing the property's zone against the literal 'UTC'.
const weeks = trailingWeeks(new Date(), WEEKS);

// ── AUTH ────────────────────────────────────────────────────────────────────
let creds;
try {
  creds = JSON.parse(RAW_CREDS);
} catch {
  die('GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON. It must be the raw service-account JSON, not a file path.');
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: creds.client_email,
    // READ-ONLY. This job writes to Supabase, never to GA4, and the scope makes
    // that structural rather than a promise: with analytics.readonly there is no
    // GA4 mutation this token could perform even if the code asked for one.
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claim));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const sig = b64url(signer.sign(creds.private_key));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${payload}.${sig}`,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    die(`token exchange failed (${res.status}): ${json?.error_description || json?.error || 'no access_token'}`);
  }
  return json.access_token;
}

const TOKEN = await accessToken();

async function runReport(body) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dateRanges: weeks.map((w) => ({ startDate: w.start, endDate: w.end })), ...body }),
    },
  );
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    die(`runReport failed (${res.status}): ${json?.error?.message || 'no message'}`);
  }
  return json;
}

/*
 * Map a report to { [weekStart]: { [dimKey]: value } } by reading the RESPONSE
 * HEADERS rather than assuming column order.
 *
 * When more than one dateRange is supplied GA4 appends an implicit `dateRange`
 * dimension, and its position relative to the requested dimensions is a
 * documented-but-easy-to-forget detail. Positional indexing would work today and
 * break silently the first time a dimension is added to a query, producing
 * numbers filed under the wrong week. Reading by name cannot do that.
 */
function byWeek(report, dimName) {
  try {
    return byWeekPure(report, dimName, weeks);
  } catch (e) {
    die(e.message);
  }
}

// Thresholding suppresses rows rather than reporting zero. Google Signals is
// disabled on this property so it should never fire, but a suppressed number
// written as a measurement is indistinguishable from a real one afterwards, so
// the check is on every report rather than assumed away.
function thresholded(report, label) {
  const md = report.metadata || {};
  if (md.subjectToThresholding) {
    console.log(`  [!] ${label}: subjectToThresholding=TRUE. Rows may be SUPPRESSED, not zero.`);
    console.log('      Writing NULL for this metric rather than recording a suppression as a measurement.');
    return true;
  }
  return false;
}

// ── QUERIES ─────────────────────────────────────────────────────────────────
console.log(`GA4 weekly pull, property ${PROPERTY}`);
console.log(`weeks (ISO Monday): ${weeks.map((w) => w.start).join(', ')}`);
console.log(`mode: ${DRY_RUN ? 'DRY RUN, nothing will be written' : 'WRITE'}\n`);

const sessionsRep = await runReport({ metrics: [{ name: 'sessions' }] });
const sessionsBad = thresholded(sessionsRep, 'sessions');
const sessions = byWeek(sessionsRep, null);

// qualified_sessions = sessions that reached a comparison view. Filtering the
// SESSIONS metric by eventName gives sessions in which that event occurred,
// which is the definition; it is not a count of the events.
const qualRep = await runReport({
  metrics: [{ name: 'sessions' }],
  dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: 'view_item' } } },
});
const qualBad = thresholded(qualRep, 'qualified_sessions');
const qualified = byWeek(qualRep, null);

const viewsRep = await runReport({
  metrics: [{ name: 'eventCount' }],
  dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: 'view_item' } } },
});
const viewsBad = thresholded(viewsRep, 'comparison_views');
const views = byWeek(viewsRep, null);

/*
 * OUTBOUND CLICKS: retailer_click ONLY. Read this before changing the filter.
 *
 * THREE GA4 EVENTS FIRE ON ONE OUTBOUND CLICK:
 *   retailer_click       ours, lib/analytics.ts:138        <- the only one counted
 *   affiliate_clickout   ours, lib/analytics.ts:13
 *   click                GA4 enhanced measurement, auto-collected because
 *                        outboundClicksEnabled is ON at the property
 *
 * On the 7 days to 29 July they measured 47, 47 and 47.
 *
 * THE IDENTICAL COUNTS ARE THE HAZARD, not a reassurance. Summing any two gives
 * 94 and summing all three gives 141, and 141 is a plausible-looking weekly
 * outbound-click total for this site. Nothing about it looks like a bug. A
 * triple-count that produced 141,000 would be caught in a second; this one would
 * be reported to a partner.
 *
 * They are not three signals to reconcile or average. They are three recordings
 * of one user action, and the dashboard counts retailer_click because that is
 * the one carrying affiliate_network, value and click_source. Do not "improve
 * coverage" by adding `click`: enhanced measurement's outbound `click` fires on
 * every outbound anchor, including any non-affiliate outbound link, so it is
 * both a duplicate AND a different population.
 *
 * customEvent:affiliate_network, never customEvent:network. The latter is one of
 * three inert shorthand dimensions registered on 27 July that will never
 * collect. It would return (not set) for every row and read as "no network data"
 * rather than as a wrong field name.
 */
const netRep = await runReport({
  metrics: [{ name: 'eventCount' }],
  dimensions: [{ name: 'customEvent:affiliate_network' }],
  dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { value: 'retailer_click' } } },
});
const netBad = thresholded(netRep, 'outbound clicks by network');
const byNet = byWeek(netRep, 'customEvent:affiliate_network');

// Both search events in one query, split by name. They are never summed; see the
// column comments on metrics_ga4_weekly.
const searchRep = await runReport({
  metrics: [{ name: 'eventCount' }],
  dimensions: [{ name: 'eventName' }],
  dimensionFilter: {
    filter: { fieldName: 'eventName', inListFilter: { values: ['search', 'view_search_results'] } },
  },
});
const searchBad = thresholded(searchRep, 'search events');
const searches = byWeek(searchRep, 'eventName');

// ── ASSEMBLE ────────────────────────────────────────────────────────────────
// null, not 0, wherever a metric was not measurable for the whole week. Writing
// zero records a measurement never taken as a measurement of nothing, and the
// two cannot be told apart afterwards.
const rows = weeks.map((w) => {
  const netOk = weekFullyAfter(w.start, BY_NETWORK_START) && !netBad;
  const net = byNet[w.start] || {};
  const known = ['awin', 'rakuten', 'amazon'];
  // Everything that is not one of the three named networks, including (not set)
  // and any network added later. The column exists because AffiliateNetwork has
  // five values against three columns, so the parts could never sum without it.
  const other = Object.entries(net)
    .filter(([k]) => !known.includes(k))
    .reduce((a, [, v]) => a + v, 0);

  const viewItemOk = weekFullyAfter(w.start, VIEW_ITEM_START);
  const customSearchOk = weekFullyAfter(w.start, GTAG_FIX) && !searchBad;

  return {
    week_start: w.start,
    sessions: sessionsBad ? null : (sessions[w.start]?._ ?? 0),
    // Written, never rendered, for weeks before the first clean one. The series
    // has to accumulate so it is readable from the fix date forward; section 4.1
    // of the brief governs the DISPLAY, and this file governs the WRITE. Do not
    // conflate the two and stop writing these.
    qualified_sessions: viewItemOk && !qualBad ? (qualified[w.start]?._ ?? 0) : null,
    comparison_views: viewItemOk && !viewsBad ? (views[w.start]?._ ?? 0) : null,
    outbound_clicks_awin: netOk ? (net.awin ?? 0) : null,
    outbound_clicks_rakuten: netOk ? (net.rakuten ?? 0) : null,
    outbound_clicks_amazon: netOk ? (net.amazon ?? 0) : null,
    outbound_clicks_other: netOk ? other : null,
    // Survived the hydration race because gtag.js emits it, so it has history
    // and needs no boundary gate beyond thresholding.
    searches_view_search_results: searchBad ? null : (searches[w.start]?.view_search_results ?? 0),
    searches_custom_event: customSearchOk ? (searches[w.start]?.search ?? 0) : null,
    updated_at: new Date().toISOString(),
  };
});

// ── SELF-CHECK ──────────────────────────────────────────────────────────────
// The brief requires the four by-network columns to sum EXACTLY to the week's
// retailer_click total once the dimension exists. Asserted here rather than
// trusted: a gap means either a network value the split does not handle or a
// filter that drifted, and both look like a quiet shortfall on the dashboard.
let problems = 0;
for (const w of weeks) {
  const r = rows.find((x) => x.week_start === w.start);
  if (r.outbound_clicks_awin === null) continue;
  const total = Object.values(byNet[w.start] || {}).reduce((a, v) => a + v, 0);
  const parts =
    r.outbound_clicks_awin + r.outbound_clicks_rakuten + r.outbound_clicks_amazon + r.outbound_clicks_other;
  if (parts !== total) {
    console.log(`  [!] ${w.start}: by-network parts ${parts} != retailer_click total ${total}`);
    problems++;
  }
}
console.log(problems === 0 ? '  [ok] by-network columns sum exactly for every written week\n' : '');

console.table(rows.map(({ updated_at, ...r }) => r));

// ── WRITE ───────────────────────────────────────────────────────────────────
if (DRY_RUN) {
  console.log('\nDRY RUN: nothing written. Set DRY_RUN=false to upsert.');
  process.exit(0);
}

const res = await fetch(`${SUPABASE_URL}/rest/v1/metrics_ga4_weekly?on_conflict=week_start`, {
  method: 'POST',
  headers: {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    'content-type': 'application/json',
    // merge-duplicates makes this an UPSERT on week_start, which is what lets the
    // trailing re-pull correct GA4's 24-48h lag instead of inserting a duplicate.
    prefer: 'resolution=merge-duplicates,return=representation',
  },
  body: JSON.stringify(rows),
});
const body = await res.text();
if (!res.ok) die(`Supabase upsert failed (${res.status}): ${body.slice(0, 500)}`);

console.log(`\nUpserted ${rows.length} week(s) into metrics_ga4_weekly.`);
if (problems > 0) {
  console.log(`[!] ${problems} week(s) failed the by-network sum check above. Written, but investigate.`);
  process.exit(1);
}
