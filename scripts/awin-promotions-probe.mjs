#!/usr/bin/env node
/**
 * READ-ONLY probe of the Awin promotions endpoint. Phase 0.5 of the Offers brief.
 *
 * WRITES NOTHING. No database, no storage, no file. Prints to stdout and stops.
 *
 * ── ONE CREDENTIAL, AND THE REASON IS NOT TIDINESS ───────────────────────────────────
 *
 * Reads AWIN_OAUTH_TOKEN and ONLY that. AWIN_API_KEY is the FEED credential that eight
 * live paths depend on, and awin-shape-probe, awin-rate-card and awin-weekly-pull each
 * carry a comment insisting the two are never confused.
 *
 * A 401 IS A FINDING AND IS REPORTED AS ONE. This probe does not fall back to the feed
 * key on failure. A probe that tried both would establish which credential works while
 * destroying the record of which SHOULD -- the answer "it worked" would no longer say
 * anything about scope, and the next reader would inherit a working call with no way to
 * tell which key earned it.
 *
 * NEITHER VALUE IS EVER PRINTED. Token length only.
 */
const PUB = process.env.AWIN_PUBLISHER_ID || 2841268;
const TOKEN = process.env.AWIN_OAUTH_TOKEN;
const PATH_TMPL = process.env.PROBE_PATH || '/publisher/{publisherId}/promotions';
const METHOD = (process.env.PROBE_METHOD || 'POST').toUpperCase();

if (!TOKEN) { console.error('CANNOT RUN: AWIN_OAUTH_TOKEN is empty in this context.'); process.exit(1); }
console.log(`token present, length ${TOKEN.length}`);

const path = PATH_TMPL.replace('{publisherId}', String(PUB)).replace('{publisherid}', String(PUB));
const url = `https://api.awin.com${path.startsWith('/') ? path : '/' + path}`;
console.log(`${METHOD} ${url}\n`);

const t0 = Date.now();
let res, text;
try {
  res = await fetch(url, {
    method: METHOD,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(METHOD === 'POST' ? { body: JSON.stringify({}) } : {}),
  });
  text = await res.text();
} catch (e) {
  console.log('=== Q2 CREDENTIAL / TRANSPORT ===');
  console.log(`  TRANSPORT FAILURE, the question never reached Awin: ${e.message}`);
  process.exit(0);
}
const ms = Date.now() - t0;

console.log('=== Q2 CREDENTIAL, Q6 RATE LIMIT AND SIZE ===');
console.log(`  status        : ${res.status} ${res.statusText}`);
console.log(`  duration      : ${ms}ms`);
console.log(`  bytes         : ${text.length}`);
for (const [k, v] of res.headers.entries()) {
  if (/rate|limit|remaining|reset|retry|page|total|count|link/i.test(k)) console.log(`  header ${k}: ${v}`);
}
if (res.status === 401 || res.status === 403) {
  console.log('\n  *** THIS IS THE FINDING, NOT A FAILURE. ***');
  console.log('  AWIN_OAUTH_TOKEN is not accepted by this endpoint. NOT retried with AWIN_API_KEY:');
  console.log('  that is the feed credential, and trying it would answer "which works" while');
  console.log('  destroying the record of which should. Report the scope required.');
  console.log(`  body (first 400): ${text.slice(0, 400)}`);
  process.exit(0);
}
if (!res.ok) { console.log(`\n  non-2xx. body (first 600): ${text.slice(0, 600)}`); process.exit(0); }

let json;
try { json = JSON.parse(text); } catch { console.log('  body is not JSON. First 600:'); console.log(text.slice(0,600)); process.exit(0); }

const rows = Array.isArray(json) ? json : (json.data ?? json.promotions ?? json.results ?? []);
console.log(`\n=== Q3 COUNT ===\n  top-level type : ${Array.isArray(json) ? 'array' : 'object[' + Object.keys(json).join(', ') + ']'}`);
console.log(`  offers returned: ${Array.isArray(rows) ? rows.length : 'not an array'}`);

// ── Q1 schema, field by field, as returned ─────────────────────────────────────────
const shape = (v) => Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
const fields = new Map();
const walk = (o, pre = '') => {
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o)) {
    const key = pre ? `${pre}.${k}` : k;
    const e = fields.get(key) || { types: new Set(), sample: undefined, present: 0 };
    e.types.add(shape(v)); e.present++;
    if (e.sample === undefined && v !== null && typeof v !== 'object') e.sample = v;
    fields.set(key, e);
    if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key);
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') walk(v[0], key + '[]');
  }
};
(Array.isArray(rows) ? rows : []).forEach(r => walk(r));
console.log(`\n=== Q1 SCHEMA AS RETURNED (${fields.size} fields) ===`);
for (const [k, e] of [...fields].sort()) {
  const s = e.sample === undefined ? '' : ` e.g. ${JSON.stringify(String(e.sample).slice(0, 60))}`;
  console.log(`  ${k.padEnd(44)} ${[...e.types].join('|').padEnd(16)} in ${e.present}/${rows.length}${s}`);
}

const F = (r, ...names) => { for (const n of names) { const v = n.split('.').reduce((a,k)=>a?.[k], r); if (v !== undefined && v !== null) return v; } return null; };

// ── Q4 exclusivity / attribution ───────────────────────────────────────────────────
console.log('\n=== Q4 EXCLUSIVITY, ATTRIBUTION, ASSIGNMENT ===');
const excl = [...fields.keys()].filter(k => /exclusiv|assign|publisher|attribut|restrict|private|bespoke/i.test(k));
if (!excl.length) console.log('  NO FIELD relating to exclusivity, assignment or publisher attribution.');
else for (const k of excl) {
  const vals = new Map();
  rows.forEach(r => { const v = JSON.stringify(F(r, k)); vals.set(v, (vals.get(v)||0)+1); });
  console.log(`  ${k}: ${[...vals].map(([v,n])=>`${v} x${n}`).join(', ').slice(0,200)}`);
}

// ── Q5 dates ───────────────────────────────────────────────────────────────────────
console.log('\n=== Q5 DATE AND STATUS FIELDS ===');
const dates = [...fields.keys()].filter(k => /date|start|end|expir|valid|status|active/i.test(k));
const now = new Date();
for (const k of dates) {
  const vals = rows.map(r => F(r, k)).filter(v => v !== null);
  const uniq = [...new Set(vals.map(v => String(v)))].slice(0, 6);
  console.log(`  ${k.padEnd(30)} ${vals.length}/${rows.length} populated  e.g. ${uniq.join(' | ').slice(0,140)}`);
}

// ── Q7/Q8/Q9 composition ───────────────────────────────────────────────────────────
const textOf = r => [F(r,'title'),F(r,'description'),F(r,'terms'),F(r,'voucherCode'),F(r,'type'),F(r,'promotionType')]
  .filter(Boolean).join(' | ');
const DELIVERY = /\b(free\s+(uk\s+)?(delivery|shipping|postage)|delivery|shipping|postage|p&p)\b/i;
const DISCOUNT = /(\d+\s*%|£\s*\d|\bsave\b|\boff\b)/i;
const buckets = { delivery: [], discount: [], other: [] };
rows.forEach(r => { const t = textOf(r);
  if (DELIVERY.test(t)) buckets.delivery.push(r); else if (DISCOUNT.test(t)) buckets.discount.push(r); else buckets.other.push(r); });
console.log('\n=== Q7 COMPOSITION (all returned offers) ===');
console.log(`  delivery-mentioning : ${buckets.delivery.length}`);
console.log(`  price discount      : ${buckets.discount.length}`);
console.log(`  everything else     : ${buckets.other.length}`);

console.log('\n=== Q8 DELIVERY BUCKET, EVERY ROW PRINTED VERBATIM ===');
if (!buckets.delivery.length) console.log('  NONE. That is the finding: no delivery-modifying offer is currently on offer.');
buckets.delivery.forEach((r, i) => {
  console.log(`  --- ${i+1} ---`);
  console.log(`    advertiser : ${F(r,'advertiserId','advertiser.id')}  ${F(r,'advertiserName','advertiser.name') ?? ''}`);
  console.log(`    title      : ${F(r,'title')}`);
  console.log(`    description: ${F(r,'description')}`);
  console.log(`    terms      : ${String(F(r,'terms') ?? '').slice(0, 500)}`);
  console.log(`    code       : ${F(r,'voucherCode','code') ?? '(none — Q9: applies automatically)'}`);
  console.log(`    type       : ${F(r,'type','promotionType')}`);
  console.log(`    starts/ends: ${F(r,'startDate')} -> ${F(r,'endDate')}`);
});

console.log('\n=== Q9 CODE REQUIRED VERSUS AUTOMATIC (delivery bucket) ===');
const withCode = buckets.delivery.filter(r => F(r,'voucherCode','code'));
console.log(`  requires a code : ${withCode.length}`);
console.log(`  automatic       : ${buckets.delivery.length - withCode.length}`);
console.log('\nPROBE COMPLETE. Nothing was written.');
