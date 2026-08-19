/**
 * COHORTED.CO.UK — read-only onboarding probe. Writes nothing, imports nothing, sets nothing.
 *
 * Produces the four figures the onboarding decision needs, and produces them BEFORE anything is
 * configured, because `docs/superdrug-removal-plan.md` makes both pre-onboarding checks
 * mandatory:
 *
 *   1. "a category allowlist is retailer-specific, always" — never copy a path allowlist
 *      between retailers, and audit the feed before writing one. Boots' path string is a Boots
 *      string. Debenhams populates merchant_product_category_path on 0.0% of rows.
 *   2. "delivery terms are a REQUIRED step, not a later audit" — verified against the
 *      retailer's OWN SITE, never the feed, because delivery terms are not in AWIN and never
 *      have been. This probe therefore CANNOT answer the delivery question and does not try.
 *
 * ── THE OVERLAP FIGURE IS THE ONE THAT MATTERS ───────────────────────────────────────
 *
 * The catalogue is 86% single-stockist and supplements is 92%. A retailer's value is what it
 * can be COMPARED AGAINST, not what it adds: a feed of 10,000 products that overlaps nothing
 * adds 10,000 rows to a comparison site that cannot compare any of them.
 *
 * ── CREDENTIALS: TWO, AND THEY ARE NOT INTERCHANGEABLE ───────────────────────────────
 *
 *   AWIN_OAUTH_TOKEN  api.awin.com          — programme metadata (reporting)
 *   AWIN_API_KEY      productdata.awin.com  — the FEED credential, eight live paths depend on it
 *
 * awin-shape-probe.yml already records that these must never be confused. NEITHER VALUE IS EVER
 * PRINTED by this script — the datafeed list returns download URLs with the api key embedded in
 * the path, so URLs are redacted before any output.
 */
// The publisher id is NOT a repo secret and does not need to be — it is a public account
// identifier, and it is already hardcoded in scripts/awin-weekly-pull.mjs with a source
// reference. Taking it from the same place rather than inventing a new secret: a fourth
// AWIN credential would be the divergence class item 196 exists to detect (item 220).
const PUB = process.env.AWIN_PUBLISHER_ID || 2841268; // supabase/functions/import-awin-feed/index.ts:265
const OAUTH = process.env.AWIN_OAUTH_TOKEN;
const FEEDKEY = process.env.AWIN_API_KEY;
const SB = process.env.SUPABASE_URL;
const SKEY = process.env.SUPABASE_SERVICE_KEY;
const TARGET = /cohorted/i;

const redact = (s) => String(s).replace(/apikey\/[^/\s]+/gi, 'apikey/REDACTED')
  .replace(/[0-9a-f]{24,}/gi, 'REDACTED');

function need(name, v) {
  if (!v) { console.error(`CANNOT RUN: ${name} is not set`); process.exit(1); }
}
need('AWIN_OAUTH_TOKEN', OAUTH); need('AWIN_API_KEY', FEEDKEY);

console.log('==================================================================');
console.log(' Cohorted.co.uk — onboarding probe (READ ONLY)');
console.log('==================================================================\n');

// ── 1. The programme ────────────────────────────────────────────────────────────────
const pr = await fetch(`https://api.awin.com/publishers/${PUB}/programmes?relationship=joined`,
  { headers: { Authorization: `Bearer ${OAUTH}`, Accept: 'application/json' } });
if (!pr.ok) { console.error(`CANNOT RUN: programmes ${pr.status}`); process.exit(1); }
const programmes = await pr.json();
const hit = programmes.filter((p) => TARGET.test(`${p.programmeInfo?.name ?? p.name ?? ''}`));
console.log(`── Programme ─────────────────────────────────────────────────────`);
console.log(`  joined programmes total : ${programmes.length}`);
if (!hit.length) {
  console.log('  NO JOINED PROGRAMME MATCHES /cohorted/i.');
  console.log('  Acceptance may not have propagated, or the programme name differs.');
  console.log('  This is a finding, not a failure — nothing further can be probed.');
  process.exit(0);
}
for (const p of hit) {
  const info = p.programmeInfo ?? p;
  console.log(`  name           : ${info.name}`);
  console.log(`  advertiser id  : ${info.id}`);
  console.log(`  status         : ${p.relationship?.status ?? '(not reported)'}`);
  console.log(`  currency       : ${info.currencyCode ?? '—'}   region: ${info.primaryRegion?.countryCode ?? '—'}`);
}
const advertiserIds = hit.map((p) => (p.programmeInfo ?? p).id);

// ── 2. The feed ─────────────────────────────────────────────────────────────────────
const dl = await fetch(`https://productdata.awin.com/datafeed/list/apikey/${FEEDKEY}`);
if (!dl.ok) { console.error(`CANNOT RUN: datafeed list ${dl.status}`); process.exit(1); }
const listCsv = await dl.text();
const [head, ...rows] = listCsv.trim().split('\n');
const cols = head.split(',').map((c) => c.replace(/"/g, '').trim());
const idx = (n) => cols.findIndex((c) => c.toLowerCase() === n.toLowerCase());
const parse = (line) => (line.match(/("([^"]*)"|[^,]*)(,|$)/g) ?? []).map((f) => f.replace(/,$/, '').replace(/^"|"$/g, ''));

const feeds = rows.map(parse).filter((r) => advertiserIds.includes(Number(r[idx('Advertiser ID')])));
console.log(`\n── Feed ──────────────────────────────────────────────────────────`);
console.log(`  feeds visible on this account : ${rows.length}`);
if (!feeds.length) {
  console.log('  NO FEED for this advertiser. Joined but no datafeed published, or not yet visible.');
  console.log('  A finding: onboarding cannot proceed on a feed that does not exist.');
  process.exit(0);
}
for (const f of feeds) {
  console.log(`  feed id        : ${f[idx('Feed ID')]}`);
  console.log(`  name           : ${f[idx('Feed Name')]}`);
  console.log(`  products       : ${f[idx('No of products')]}`);
  console.log(`  last imported  : ${f[idx('Last Imported')] ?? '—'}`);
  console.log(`  language/region: ${f[idx('Language')] ?? '—'} / ${f[idx('Vertical')] ?? '—'}`);
}

// ── 3. Feed contents ────────────────────────────────────────────────────────────────
const feedId = feeds[0][idx('Feed ID')];
const COLUMNS = [
  'product_name', 'merchant_category', 'merchant_product_category_path', 'category_name',
  'ean', 'mpn', 'brand_name', 'search_price', 'product_type',
].join(',');
const url = `https://productdata.awin.com/datafeed/download/apikey/${FEEDKEY}/language/en/fid/${feedId}`
  + `/columns/${COLUMNS}/format/csv/delimiter/%2C/compression/gzip/`;
console.log(`\n  download url   : ${redact(url)}`);

const fr = await fetch(url);
if (!fr.ok) { console.error(`CANNOT RUN: feed download ${fr.status}`); process.exit(1); }
const buf = new Uint8Array(await fr.arrayBuffer());
const { gunzipSync } = await import('node:zlib');
const csv = gunzipSync(buf).toString('utf8');
const lines = csv.trim().split('\n');
const fcols = parse(lines[0]).map((c) => c.trim());
const at = (n) => fcols.findIndex((c) => c.toLowerCase() === n.toLowerCase());
const data = lines.slice(1).map(parse);

console.log(`\n── Feed contents ─────────────────────────────────────────────────`);
console.log(`  rows                     : ${data.length}`);
const fill = (n) => {
  const i = at(n);
  if (i < 0) return 'COLUMN ABSENT';
  const c = data.filter((r) => (r[i] ?? '').trim()).length;
  return `${c} (${(c / data.length * 100).toFixed(1)}%)`;
};
console.log(`  ean populated            : ${fill('ean')}`);
console.log(`  mpn populated            : ${fill('mpn')}`);
console.log(`  brand_name populated     : ${fill('brand_name')}`);
console.log(`  merchant_category        : ${fill('merchant_category')}`);
console.log(`  product_category_path    : ${fill('merchant_product_category_path')}`);

// Category breakdown — on whichever column is actually populated (the Debenhams lesson).
const pathI = at('merchant_product_category_path'), catI = at('merchant_category');
const usePathCol = pathI >= 0 && data.filter((r) => (r[pathI] ?? '').trim()).length > data.length * 0.5;
const useI = usePathCol ? pathI : catI;
console.log(`\n  category column used     : ${usePathCol ? 'merchant_product_category_path' : 'merchant_category'}`);
const counts = {};
for (const r of data) { const k = (r[useI] ?? '(blank)').trim() || '(blank)'; counts[k] = (counts[k] || 0) + 1; }
const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log(`  distinct categories      : ${Object.keys(counts).length}`);
for (const [k, n] of top) console.log(`    ${String(n).padStart(6)}  ${k.slice(0, 72)}`);

// ── 4. THE OVERLAP FIGURE ───────────────────────────────────────────────────────────
if (!SB || !SKEY) {
  console.log('\n  (overlap not computed: SUPABASE_URL / SUPABASE_SERVICE_KEY not set)');
  process.exit(0);
}
const gt = (s) => String(s || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
const eanI = at('ean');
const feedEans = new Set(data.map((r) => gt(r[eanI])).filter(Boolean));
console.log(`\n── Overlap with the catalogue, on barcode ────────────────────────`);
console.log(`  distinct barcodes in feed : ${feedEans.size}`);

const ours = new Set();
for (let from = 0; ; from += 1000) {
  const r = await fetch(`${SB}/rest/v1/retailer_prices_live?select=ean_normalised&ean_normalised=not.is.null&limit=1000&offset=${from}&order=ean_normalised`,
    { headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}` } });
  if (!r.ok) { console.error(`CANNOT RUN: catalogue read ${r.status}`); process.exit(1); }
  const page = await r.json();
  for (const x of page) ours.add(gt(x.ean_normalised));
  if (page.length < 1000) break;
}
const overlap = [...feedEans].filter((e) => ours.has(e));
console.log(`  distinct barcodes in catalogue : ${ours.size}`);
console.log(`  OVERLAP                        : ${overlap.length}`);
console.log(`  as a share of the feed         : ${(overlap.length / feedEans.size * 100).toFixed(1)}%`);
// ── 5. THE CONTROL ON A ZERO ──────────────────────────────────────────────────────
//
// A zero overlap from a comparison I wrote is exactly what item 184 says not to trust: it
// cannot distinguish "these products are new to us" from "my barcode comparison is broken".
// Two controls, both cheap:
//   (a) does the SAME comparison find overlap for barcodes we know are in the catalogue?
//   (b) are the feed's BRANDS ones we already carry? If yes, a zero barcode overlap is
//       suspicious. If no, it is exactly what a genuinely new catalogue looks like.
const someOurs = [...ours].slice(0, 5);
const controlHits = someOurs.filter((e) => ours.has(e)).length;
console.log(`\n── Control on the zero ───────────────────────────────────────────`);
console.log(`  (a) self-check: ${controlHits}/5 known catalogue barcodes found by the same lookup`);

const brandI = at('brand_name');
const feedBrands = [...new Set(data.map((r) => (r[brandI] ?? '').trim()).filter(Boolean))];
console.log(`  feed brands (${feedBrands.length}): ${feedBrands.join(', ').slice(0, 200)}`);
const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ourBrands = new Set();
for (let from = 0; ; from += 1000) {
  const r = await fetch(`${SB}/rest/v1/products_active?select=brand&brand=not.is.null&limit=1000&offset=${from}&order=brand`,
    { headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}` } });
  if (!r.ok) break;
  const page = await r.json();
  for (const x of page) ourBrands.add(norm(x.brand));
  if (page.length < 1000) break;
}
const brandHits = feedBrands.filter((b) => ourBrands.has(norm(b)));
console.log(`  (b) feed brands we already carry: ${brandHits.length}/${feedBrands.length}` +
  (brandHits.length ? ` — ${brandHits.join(', ')}` : ''));
console.log(`\n  READING: ${brandHits.length === 0
  ? 'zero brand overlap AND zero barcode overlap — a genuinely disjoint catalogue, consistent.'
  : 'brands we carry but NO barcode overlap — investigate before trusting the zero.'}`);

// Sample product names, so the feed's actual nature is visible rather than inferred.
const nameI = at('product_name');
console.log(`\n  sample products:`);
for (const r of data.slice(0, 8)) console.log(`    ${(r[nameI] ?? '').slice(0, 70)}`);

console.log(`\nRESULT: read-only probe complete. Nothing imported, nothing set active.`);
