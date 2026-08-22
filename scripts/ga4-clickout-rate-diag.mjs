#!/usr/bin/env node
//
// THROWAWAY DISCOVERY SCRIPT — Phase 0, Task 2: the true clickout rate.
// READ-ONLY. Writes nothing, anywhere. Every call is a runReport.
// Does NOT modify scripts/ga4-weekly-pull.mjs and shares no state with it.
//
// ── THE PROBLEM ─────────────────────────────────────────────────────────────
// metrics_ga4_weekly stores outbound clicks as eventCount — a count of EVENTS.
// The programme's constraint is "share of SESSIONS reaching a retailer". Those
// are different quantities and the dashboard presents them as comparable.
//
//   old way : eventCount(retailer_click) / sessions      <- events over sessions
//   true    : sessions_with_retailer_click / sessions    <- sessions over sessions
//
// The old way exceeds the true rate whenever any session clicks out more than
// once, and is unbounded above: it can exceed 100% while the true rate cannot.
//
// ── COMPLETE WEEKS ONLY ─────────────────────────────────────────────────────
// trailingWeeks(now, n) INCLUDES the current, partial week. A partial week
// counted as complete is what manufactured the trend withdrawn on 20 August, so
// this script drops it explicitly and reports the exact ranges it used.

import { createSign } from 'node:crypto';
import { trailingWeeks, byWeek as byWeekPure } from './lib/ga4-weeks.mjs';

const PROPERTY = process.env.GA4_PROPERTY_ID;
const RAW_CREDS = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const die = (m) => { console.error(`FATAL: ${m}`); process.exit(1); };
if (!RAW_CREDS) die('GOOGLE_APPLICATION_CREDENTIALS_JSON is not set');
if (!PROPERTY) die('GA4_PROPERTY_ID is not set');
if (/^G-/.test(PROPERTY)) die(`GA4_PROPERTY_ID is "${PROPERTY}", a MEASUREMENT id; need the numeric id`);

// ── COMPLETE WEEKS ──────────────────────────────────────────────────────────
// trailingWeeks(now, 5) ends with the CURRENT week. Drop it; keep the 4 before.
const all5 = trailingWeeks(new Date(), 5);
const weeks = all5.slice(0, 4);
const droppedPartial = all5[4];
const FULL = { start: weeks[0].start, end: weeks[weeks.length - 1].end };

// ── AUTH (same shape as ga4-weekly-pull.mjs; scope analytics.readonly) ──────
async function accessToken() {
  let creds;
  try { creds = JSON.parse(RAW_CREDS); } catch { die('GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON'); }
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claim = Buffer.from(JSON.stringify({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now,
  })).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const sig = signer.sign(creds.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${sig}` }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.access_token) die(`token exchange failed (${res.status})`);
  return j.access_token;
}
const TOKEN = await accessToken();

// Sampling / thresholding are recorded per call rather than assumed absent.
const audit = [];
async function runReport(label, body, ranges) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ dateRanges: ranges.map((w) => ({ startDate: w.start, endDate: w.end })), ...body }),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) die(`runReport "${label}" failed (${res.status}): ${j?.error?.message || 'no message'}`);
  const sm = j.metadata?.samplingMetadatas || [];
  audit.push({
    label,
    sampled: sm.length > 0,
    sampleDetail: sm.map((s) => `${s.samplesReadCount}/${s.samplingSpaceSize}`).join(', ') || 'none',
    thresholded: j.metadata?.subjectToThresholding === true,
    rows: (j.rows || []).length,
  });
  return j;
}
const EV = (v) => ({ filter: { fieldName: 'eventName', stringFilter: { value: v } } });
const byWeek = (rep, dim, ranges) => byWeekPure(rep, dim, ranges);
const tot = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

// ── BUCKETING RULE, stated in code so the report cannot drift from it ───────
// Applied to landingPagePlusQueryString with the query string stripped.
// FIRST MATCH WINS, in this order.
function bucket(path) {
  const p = (path || '').split('?')[0].replace(/\/$/, '') || '/';
  if (p === '/' || p === '/index.html') return 'homepage';
  if (p.startsWith('/product/')) return 'product';
  if (p.startsWith('/brands')) return 'brand hub';
  if (p.startsWith('/articles') || p.startsWith('/savings-hub')) return 'article and hub';
  if (p === '/app' || p.startsWith('/app/')) return 'routine builder';
  if (p.startsWith('/search')) return 'search';
  if (/^\/(skincare|makeup|hair|fragrance|bath-and-body|supplements)(\/|$)/.test(p)) return 'category';
  return 'other';
}
const BUCKETS = ['product','category','brand hub','homepage','article and hub','routine builder','search','other'];

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(2)}%` : 'n/a');
const line = (c = '─') => console.log(c.repeat(78));

console.log('GA4 CLICKOUT-RATE DISCOVERY — Phase 0 Task 2. READ-ONLY.');
console.log(`property ${PROPERTY}`);
line();
console.log('COMPLETE WEEKS USED:');
weeks.forEach((w) => console.log(`   ${w.start} .. ${w.end}`));
console.log(`FULL WINDOW: ${FULL.start} .. ${FULL.end}`);
console.log(`DROPPED as incomplete (current week): ${droppedPartial.start} .. ${droppedPartial.end}`);
line();

// ── PER-WEEK CORE ───────────────────────────────────────────────────────────
const sessRep  = await runReport('sessions (all)', { metrics: [{ name: 'sessions' }] }, weeks);
const sessClk  = await runReport('sessions with retailer_click', { metrics: [{ name: 'sessions' }], dimensionFilter: EV('retailer_click') }, weeks);
const evClk    = await runReport('eventCount retailer_click', { metrics: [{ name: 'eventCount' }], dimensionFilter: EV('retailer_click') }, weeks);

const B = byWeek(sessRep, null, weeks), A = byWeek(sessClk, null, weeks), E = byWeek(evClk, null, weeks);

console.log('\nA = sessions containing >=1 retailer_click   B = total sessions');
console.log('TRUE rate = A/B.  OLD way = eventCount/sessions.\n');
console.log('week        B sess   A sess   events   TRUE A/B    OLD ev/B    ratio  ev/clicking session');
for (const w of weeks) {
  const b = tot(B[w.start]), a = tot(A[w.start]), e = tot(E[w.start]);
  const ratio = (a && b) ? ((e / b) / (a / b)).toFixed(2) + 'x' : 'n/a';
  console.log(`${w.start}  ${String(b).padStart(6)}   ${String(a).padStart(6)}   ${String(e).padStart(6)}   ${pct(a,b).padStart(8)}   ${pct(e,b).padStart(9)}   ${ratio.padStart(6)}  ${a ? (e/a).toFixed(2) : 'n/a'}`);
}

// ── FULL WINDOW ─────────────────────────────────────────────────────────────
const fSess = await runReport('FULL sessions', { metrics: [{ name: 'sessions' }] }, [FULL]);
const fClk  = await runReport('FULL sessions with retailer_click', { metrics: [{ name: 'sessions' }], dimensionFilter: EV('retailer_click') }, [FULL]);
const fEv   = await runReport('FULL eventCount retailer_click', { metrics: [{ name: 'eventCount' }], dimensionFilter: EV('retailer_click') }, [FULL]);
const fB = tot(byWeek(fSess, null, [FULL])[FULL.start]);
const fA = tot(byWeek(fClk, null, [FULL])[FULL.start]);
const fE = tot(byWeek(fEv, null, [FULL])[FULL.start]);
line();
console.log(`FULL WINDOW  B=${fB}  A=${fA}  events=${fE}`);
console.log(`   TRUE clickout rate  A/B = ${pct(fA, fB)}`);
console.log(`   OLD (event/session)     = ${pct(fE, fB)}`);
console.log(`   overstatement factor    = ${fA ? ((fE/fB)/(fA/fB)).toFixed(2) : 'n/a'}x`);
console.log(`   events per clicking session = ${fA ? (fE/fA).toFixed(2) : 'n/a'}`);

// ── LANDING PAGE DISTRIBUTION + RATE PER BUCKET (full window) ───────────────
const lpAll = await runReport('FULL landing page sessions', { metrics: [{ name: 'sessions' }], dimensions: [{ name: 'landingPagePlusQueryString' }], limit: 5000 }, [FULL]);
const lpClk = await runReport('FULL landing page sessions with retailer_click', { metrics: [{ name: 'sessions' }], dimensions: [{ name: 'landingPagePlusQueryString' }], dimensionFilter: EV('retailer_click'), limit: 5000 }, [FULL]);
const rollup = (rep) => {
  const m = byWeek(rep, 'landingPagePlusQueryString', [FULL])[FULL.start] || {};
  const out = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  for (const [k, v] of Object.entries(m)) out[bucket(k)] += v;
  return out;
};
const lpB = rollup(lpAll), lpA = rollup(lpClk);
line();
console.log('LANDING PAGE BUCKET (full window, session-scoped)\n');
console.log('bucket              sessions   share    A(clicked)   clickout rate');
for (const b of BUCKETS) {
  console.log(`${b.padEnd(18)} ${String(lpB[b]).padStart(8)}  ${pct(lpB[b], fB).padStart(7)}   ${String(lpA[b]).padStart(8)}   ${pct(lpA[b], lpB[b]).padStart(8)}`);
}
console.log(`${'TOTAL'.padEnd(18)} ${String(tot(lpB)).padStart(8)}  ${' '.repeat(7)}   ${String(tot(lpA)).padStart(8)}   ${pct(tot(lpA), tot(lpB)).padStart(8)}`);

// ── /app: touched vs not ────────────────────────────────────────────────────
const APP = { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/app' } } };
const appTouch = await runReport('sessions touching /app', { metrics: [{ name: 'sessions' }], dimensionFilter: APP }, [FULL]);
const appClickOn = await runReport('sessions with retailer_click fired ON /app',
  { metrics: [{ name: 'sessions' }], dimensionFilter: { andGroup: { expressions: [EV('retailer_click'), APP] } } }, [FULL]);
const tApp = tot(byWeek(appTouch, null, [FULL])[FULL.start]);
const cOnApp = tot(byWeek(appClickOn, null, [FULL])[FULL.start]);
line();
console.log('/app COMPARISON (full window)\n');
console.log(`sessions touching /app (any pageview)      : ${tApp}   (${pct(tApp, fB)} of all sessions)`);
console.log(`sessions NOT touching /app                 : ${fB - tApp}`);
console.log(`sessions where a retailer_click fired ON /app: ${cOnApp}`);
console.log(`all sessions with a retailer_click (A)     : ${fA}`);
console.log(`   clickouts FROM /app as share of A       : ${pct(cOnApp, fA)}`);
console.log(`   clicked-on-/app / touched-/app          : ${pct(cOnApp, tApp)}`);
console.log(`   clicked-elsewhere / not-touching-/app   : ${pct(fA - cOnApp, fB - tApp)}  (upper bound, see note)`);
console.log(`
NOTE ON WHAT IS AND IS NOT COMPUTABLE. GA4's Data API applies an event-scoped
dimensionFilter and then counts distinct sessions containing a matching EVENT.
So "sessions that touched /app" is exact. But "sessions that touched /app AND
clicked out anywhere" is NOT expressible: an andGroup requires ONE event to
satisfy both conditions, which yields clicks that fired ON /app, not sessions
that visited /app and clicked from a product page. That needs an audience or
segment, which the Data API does not expose. The landing-page 'routine builder'
bucket above IS session-scoped and exact; read it as the cleaner split.`);

// ── SAMPLING / THRESHOLDING AUDIT ───────────────────────────────────────────
line();
console.log('SAMPLING AND THRESHOLDING AUDIT (every query above)\n');
console.log('query                                          rows  sampled  sample     thresholded');
for (const a of audit) {
  console.log(`${a.label.padEnd(46)}${String(a.rows).padStart(4)}  ${String(a.sampled).padEnd(8)} ${a.sampleDetail.padEnd(10)} ${a.thresholded}`);
}
const anySampled = audit.some((a) => a.sampled), anyThresh = audit.some((a) => a.thresholded);
console.log(`\nANY SAMPLING APPLIED: ${anySampled ? 'YES' : 'NO'}`);
console.log(`ANY THRESHOLDING    : ${anyThresh ? 'YES — rows suppressed, figures are floors' : 'NO'}`);
line();
console.log('READ-ONLY RUN COMPLETE. Nothing was written.');
