/**
 * Verification for the direct Creators client, against the SDK it replaces.
 *
 * WHY THIS EXISTS. The SDK harvested 764 ASINs and is the reference implementation; the
 * direct client is a transcription of its outbound HTTP. A transcription is exactly the
 * thing to check against its source rather than against documentation.
 *
 * THREE TESTS, IN THE ORDER THEY MATTER:
 *
 *   1. GOLDEN VALUE, COMPARED PROGRAMMATICALLY IN THE SAME RUN. Not eyeballed and not
 *      against a remembered number — Amazon's price moves, so a hardcoded £7.98 would start
 *      failing for the wrong reason. Both clients are called back to back and their answers
 *      compared field by field.
 *
 *   2. CORRUPT SECRET MUST PRODUCE A 4xx, NOT AN EMPTY RESULT. This is the one that matters.
 *      Item 22's finding is that `no_offers` and `upstream_error` are different facts, and
 *      the code has both paths — a client that swallowed an auth failure into an empty array
 *      would render "Amazon doesn't stock this" during an outage, which is the confusion the
 *      whole four-state design exists to prevent.
 *
 *   3. MULTI-ASIN PARITY. Batching is where a hand-rolled body most easily diverges from a
 *      generated one, and a wrong body returns a 400 or a short result rather than an error.
 *
 * Usage: node scripts/verify-creators-direct.mjs
 */
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const SDK_DIR = path.join(os.homedir(), 'amazon-api-watch', 'sdk');
const require = createRequire(path.join(SDK_DIR, 'examples', 'x.js'));
process.loadEnvFile(path.join(SDK_DIR, 'examples', '.env'));

const GOLDEN = 'B00HN8LE7A';                       // Myprotein Impact Creatine 250g
const BATCH = ['B00HN8LE7A', 'B0GR9QVPDX', 'B005P0WGNE', 'B00020IC3K'];

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

// ── the direct client, inlined so this script has no build step ──────────────────────
const TOKEN_URL = 'https://api.amazon.co.uk/auth/o2/token';
const API_URL = 'https://creatorsapi.amazon/catalog/v1/getItems';
const RESOURCES = [
  'offersV2.listings.price',
  'offersV2.listings.availability',
  'offersV2.listings.merchantInfo',
  'offersV2.listings.isBuyBoxWinner',
];

async function token(secret = process.env.CREATORS_CREDENTIAL_SECRET) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.CREATORS_CREDENTIAL_ID,
      client_secret: secret,
      scope: 'creatorsapi::default',
    }),
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(text.slice(0, 120)); e.status = res.status; throw e; }
  return JSON.parse(text).access_token;
}

async function directGetItems(asins, secret) {
  const bearer = await token(secret);
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${bearer}`,
      'x-marketplace': 'www.amazon.co.uk',
    },
    body: JSON.stringify({
      partnerTag: process.env.CREATORS_PARTNER_TAG,
      itemIds: asins,
      resources: RESOURCES,
    }),
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(text.slice(0, 120)); e.status = res.status; throw e; }
  return JSON.parse(text).itemsResult?.items ?? [];
}

// ── the SDK, as the reference ────────────────────────────────────────────────────────
function sdkClient() {
  const m = require(path.join(SDK_DIR, 'dist', 'index'));
  const c = new m.ApiClient();
  c.credentialId = process.env.CREATORS_CREDENTIAL_ID;
  c.credentialSecret = process.env.CREATORS_CREDENTIAL_SECRET;
  c.version = '3.2';
  return { api: new m.DefaultApi(c), Req: m.GetItemsRequestContent };
}

async function sdkGetItems(asins) {
  const { api, Req } = sdkClient();
  const r = new Req();
  r.partnerTag = process.env.CREATORS_PARTNER_TAG;
  r.itemIds = asins;
  r.resources = RESOURCES;
  const res = await api.getItems('www.amazon.co.uk', r);
  return res?.itemsResult?.items ?? [];
}

const listingOf = (item) => {
  const ls = item?.offersV2?.listings ?? [];
  return ls.find((l) => l?.isBuyBoxWinner) ?? ls[0] ?? null;
};

// ── run ──────────────────────────────────────────────────────────────────────────────
console.log('\n1. GOLDEN VALUE — direct vs SDK, same ASIN, same run\n');
const [dOne, sOne] = [await directGetItems([GOLDEN]), await sdkGetItems([GOLDEN])];
const dl = listingOf(dOne[0]);
const sl = listingOf(sOne[0]);
check('both returned the ASIN', dOne[0]?.asin === GOLDEN && sOne[0]?.asin === GOLDEN);
check('price amount matches', dl?.price?.money?.amount === sl?.price?.money?.amount,
  `direct ${dl?.price?.money?.displayAmount} / sdk ${sl?.price?.money?.displayAmount}`);
check('currency matches', dl?.price?.money?.currency === sl?.price?.money?.currency);
check('availability matches', dl?.availability?.type === sl?.availability?.type,
  String(dl?.availability?.type));
check('isBuyBoxWinner matches', dl?.isBuyBoxWinner === sl?.isBuyBoxWinner, String(dl?.isBuyBoxWinner));
// THE SELLER IS ASSERTED PRESENT, NOT JUST EQUAL. An omitted resource string returns
// undefined on BOTH clients, so an equality check alone would pass while the marker
// silently degrades to the generic caveat it was built to replace.
check('merchantInfo.name PRESENT on direct', typeof dl?.merchantInfo?.name === 'string' && dl.merchantInfo.name.length > 0,
  String(dl?.merchantInfo?.name));
check('merchantInfo.name matches sdk', dl?.merchantInfo?.name === sl?.merchantInfo?.name);

console.log('\n2. CORRUPT SECRET — must be a 4xx, never an empty result\n');
let authOutcome = 'no error thrown';
try {
  const items = await directGetItems([GOLDEN], 'not-a-real-secret');
  authOutcome = `returned ${items.length} items with no error`;
} catch (e) {
  authOutcome = `threw status ${e.status}`;
}
check('a bad secret throws rather than returning empty', /threw status 4\d\d/.test(authOutcome), authOutcome);

console.log('\n3. MULTI-ASIN PARITY — batching is where a hand-rolled body diverges\n');
const [dMany, sMany] = [await directGetItems(BATCH), await sdkGetItems(BATCH)];
check('same item count', dMany.length === sMany.length, `direct ${dMany.length} / sdk ${sMany.length}`);
const dMap = new Map(dMany.map((i) => [i.asin, listingOf(i)?.price?.money?.amount]));
const sMap = new Map(sMany.map((i) => [i.asin, listingOf(i)?.price?.money?.amount]));
check('same ASINs returned', [...dMap.keys()].sort().join() === [...sMap.keys()].sort().join());
check('every price matches', [...dMap].every(([a, v]) => sMap.get(a) === v),
  [...dMap].map(([a, v]) => `${a}:${v}`).join(' '));

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}\n`);
process.exit(failures === 0 ? 0 : 1);
