#!/usr/bin/env node
/**
 * READ-ONLY Amazon Creators API harvester for the K-beauty ASIN map (work-list item 60,
 * tranche 1). Enumerates ASINs by brand, then fetches external identifiers for each.
 *
 * WRITES NOTHING ANYWHERE. No database, no import path, no deploy. It prints JSON to a
 * file and stops. Matching against the catalogue happens in SQL, deliberately: this
 * script never holds Supabase credentials, so the Amazon secret and the database secret
 * are never in one process.
 *
 * CREDENTIALS ARE NOT IN THIS REPO AND MUST NOT BE. They live at
 * ~/amazon-api-watch/sdk/examples/.env, mode 0600, for the reason recorded in that
 * project's README: "an .env inside a repo is one `git add -A` from being published."
 * This script reads them from there and never copies them.
 *
 * ── The method, settled by item 60 and NOT re-derived here ────────────────────────
 *
 *   BATCH AT TEN. Server-enforced; 12 returns 400 ValidationException and the SDK has
 *   no client-side check. 300 ASINs is 30 calls.
 *
 *   PARTIAL RETURNS ARE SILENT AND NORMAL. A 10-ASIN call returned 2 items with no
 *   error and the other 8 simply absent. Every batch reconciles requested against
 *   returned and records the difference AS DATA. A map that assumes ten back drops
 *   eight and looks like it worked.
 *
 *   THE JOIN IS ONE-TO-MANY. One ASIN returned THIRTEEN EANs, of which exactly one
 *   matched. An Amazon listing aggregates variants and many sellers' stock. Every
 *   returned identifier is kept and every one is tried; a pipeline written for one
 *   identifier per ASIN matches nothing on that product and the failure reads as a
 *   coverage gap rather than a design error.
 *
 *   SIZE IS NEVER A GATE. Amazon reported "1 g" for a 100g cream that seven retailers
 *   carry. `size` is a merchandising field, not a spec. It is captured for a human to
 *   eyeball and is never compared automatically.
 *
 *   THE THROTTLE IS SELF-IMPOSED. Ten response headers on the success path, seven of
 *   them CloudFront plumbing, and not one names a quota, a remaining count, a reset or
 *   a TPS. Even a 429 carries only a message string. So the rate below is a CHOICE,
 *   backed off on failure, and it cannot be validated against anything the API says.
 *
 * Usage:  node scripts/amazon-asin-map.mjs [--out FILE] [--brands "A,B"] [--pages N]
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SDK_DIR = path.join(os.homedir(), 'amazon-api-watch', 'sdk');
const require = createRequire(path.join(SDK_DIR, 'examples', 'x.js'));
process.loadEnvFile(path.join(SDK_DIR, 'examples', '.env'));

const { ApiClient, DefaultApi, GetItemsRequestContent, SearchItemsRequestContent } =
  require(path.join(SDK_DIR, 'dist', 'index'));

const MARKETPLACE = 'www.amazon.co.uk';
const BATCH = 10;                 // server ceiling, item 60 §2
const THROTTLE_MS = 1500;         // chosen, not read from anything
const MAX_RETRIES = 4;

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = arg('--out', '/tmp/amazon-asin-harvest.json');
const MAX_PAGES = Number(arg('--pages', '10'));
const BRANDS = arg('--brands', 'COSRX,medicube,Beauty of Joseon,Dr.Melaxin').split(',');
const SEEDS = (arg('--seeds', 'B00PBX3L7K,B01LEJ5MSK,B0DM1VTB62,B0D1G7XF9X,B0FKTKF8RB,B0DNMCJMBB,B09JVNZVH3,B0CNCL35CH,B0CYS776TR')).split(',');

const api = (() => {
  const c = new ApiClient();
  c.credentialId = process.env.CREATORS_CREDENTIAL_ID;
  c.credentialSecret = process.env.CREATORS_CREDENTIAL_SECRET;
  c.version = '3.2';
  if (!c.credentialId || !c.credentialSecret || !process.env.CREATORS_PARTNER_TAG) {
    throw new Error('Missing CREATORS_* credentials in ~/amazon-api-watch/sdk/examples/.env');
  }
  return new DefaultApi(c);
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let callCount = 0;

/**
 * One call, with the self-imposed throttle and exponential backoff. Backoff is on
 * FAILURE ONLY and the delay is invented — nothing in the response can inform it.
 */
async function call(fn, label) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (callCount) await sleep(THROTTLE_MS);
    callCount++;
    try {
      return await fn();
    } catch (e) {
      const status = e?.status ?? e?.response?.status;
      const body = e?.body ?? e?.response?.body;
      // A 400 is a request defect and will fail identically on retry.
      if (status === 400) {
        console.error(`  [${label}] 400 ValidationException — not retried:`,
          JSON.stringify(body)?.slice(0, 300));
        return null;
      }
      if (attempt === MAX_RETRIES) {
        console.error(`  [${label}] giving up after ${MAX_RETRIES} retries:`, status,
          JSON.stringify(body)?.slice(0, 200));
        return null;
      }
      const wait = THROTTLE_MS * Math.pow(2, attempt + 1);
      console.error(`  [${label}] ${status ?? e?.message} — backing off ${wait}ms`);
      await sleep(wait);
    }
  }
  return null;
}

/** Enumerate ASINs for one brand. SearchItems caps at 10 per page; pages are walked
 *  until one comes back short, which is the only end-of-results signal available. */
async function enumerateBrand(brand) {
  const found = new Map();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const req = new SearchItemsRequestContent();
    req.partnerTag = process.env.CREATORS_PARTNER_TAG;
    req.brand = brand;
    req.searchIndex = 'Beauty';
    req.itemCount = 10;
    req.itemPage = page;
    req.resources = ['itemInfo.title', 'itemInfo.byLineInfo'];

    // NOT THE SAME CALLING CONVENTION AS getItems, AND THE SDK GIVES NO HINT.
    // getItems(marketplace, requestContent) takes the body POSITIONALLY;
    // searchItems(marketplace, opts) takes it wrapped as opts.searchItemsRequestContent.
    // Passing the request directly — the shape the sibling method uses — sends an EMPTY
    // BODY and returns 400 "PartnerTag should be provided" for a request that plainly
    // set partnerTag. Without the error body printed, every brand reports 0 items and
    // the harvest looks like a brand with no products.
    const res = await call(
      () => api.searchItems(MARKETPLACE, { searchItemsRequestContent: req }),
      `search ${brand} p${page}`,
    );
    const items = res?.searchResult?.items ?? [];
    for (const it of items) {
      if (it?.asin) found.set(it.asin, {
        asin: it.asin,
        searchTitle: it?.itemInfo?.title?.displayValue ?? null,
        searchBrand: it?.itemInfo?.byLineInfo?.brand?.displayValue ?? null,
      });
    }
    console.error(`  ${brand} page ${page}: ${items.length} items (running total ${found.size})`);
    if (items.length < 10) break;   // short page = last page
  }
  return [...found.values()];
}

/** GetItems for one batch of <=10, reconciling requested against returned. */
async function getItemsBatch(asins) {
  const req = new GetItemsRequestContent();
  req.partnerTag = process.env.CREATORS_PARTNER_TAG;
  req.itemIds = asins;
  req.resources = [
    'itemInfo.externalIds',
    'itemInfo.title',
    'itemInfo.byLineInfo',
    'itemInfo.productInfo',
  ];
  const res = await call(() => api.getItems(MARKETPLACE, req), `getItems x${asins.length}`);
  const items = res?.itemsResult?.items ?? [];
  const returned = new Set(items.map((i) => i.asin));
  // THE RECONCILIATION. Absent ASINs are data, not an error. item 60 §2.
  const missing = asins.filter((a) => !returned.has(a));
  return { items, missing, hadResponse: res !== null };
}

// ── run ──────────────────────────────────────────────────────────────────────────
console.error(`Enumerating ${BRANDS.length} brands, throttle ${THROTTLE_MS}ms, batch ${BATCH}\n`);

const enumerated = new Map();
for (const b of BRANDS) {
  for (const row of await enumerateBrand(b.trim())) {
    if (!enumerated.has(row.asin)) enumerated.set(row.asin, { ...row, viaBrand: b.trim() });
  }
}
// Seeds are ASINs, not the map — they are added so a store product that search does not
// surface is still fetched. item 60 confirmed each from an official store page.
for (const s of SEEDS.map((x) => x.trim()).filter(Boolean)) {
  if (!enumerated.has(s)) enumerated.set(s, { asin: s, searchTitle: null, searchBrand: null, viaBrand: 'SEED' });
}

const allAsins = [...enumerated.keys()];
console.error(`\nEnumerated ${allAsins.length} distinct ASINs. Fetching identifiers in batches of ${BATCH}...\n`);

const records = [];
const neverReturned = [];
for (let i = 0; i < allAsins.length; i += BATCH) {
  const batch = allAsins.slice(i, i + BATCH);
  const { items, missing, hadResponse } = await getItemsBatch(batch);
  console.error(`  batch ${i / BATCH + 1}: sent ${batch.length}, got ${items.length}` +
    (missing.length ? `, ABSENT ${missing.length}` : ''));
  if (!hadResponse) { neverReturned.push(...batch.map((a) => ({ asin: a, reason: 'call_failed' }))); continue; }
  for (const a of missing) neverReturned.push({ asin: a, reason: 'absent_from_response' });
  for (const it of items) {
    const ext = it?.itemInfo?.externalIds ?? {};
    const eans = ext?.eans?.displayValues ?? [];
    const upcs = ext?.upcs?.displayValues ?? [];
    records.push({
      asin: it.asin,
      title: it?.itemInfo?.title?.displayValue ?? null,
      brand: it?.itemInfo?.byLineInfo?.brand?.displayValue ?? null,
      manufacturer: it?.itemInfo?.byLineInfo?.manufacturer?.displayValue ?? null,
      // CONFIRMATION ONLY. Never compared automatically — item 60's "1 g" for a 100g cream.
      size: it?.itemInfo?.productInfo?.size?.displayValue ?? null,
      eans, upcs,
      identifierCount: eans.length + upcs.length,
      viaBrand: enumerated.get(it.asin)?.viaBrand ?? null,
    });
  }
}

const out = {
  harvested_utc: new Date().toISOString(),
  marketplace: MARKETPLACE,
  brands_queried: BRANDS,
  api_calls: callCount,
  enumerated: allAsins.length,
  returned: records.length,
  never_returned: neverReturned,
  no_identifier: records.filter((r) => r.identifierCount === 0).map((r) => r.asin),
  records,
};
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.error(`\nWrote ${OUT}`);
console.error(`  enumerated ${out.enumerated} | returned ${out.returned} | ` +
  `absent ${neverReturned.length} | no identifier ${out.no_identifier.length} | calls ${callCount}`);
