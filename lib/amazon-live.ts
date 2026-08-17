/**
 * Live Amazon offer lookup: the fetch, the breaker, single-flight and a seconds-scale TTL.
 *
 * SERVER ONLY. The Creators credentials never reach the client, which is the reason this is
 * a route handler rather than a browser fetch. Work-list item 22, item 60.
 *
 * ── Why a breaker is in the first cut ────────────────────────────────────────────────
 *
 * The rate limit is NOT DISCOVERABLE. Ten response headers on the success path, seven of
 * them CloudFront plumbing, and not one names a quota, a remaining count, a reset or a TPS.
 * Even a 429 carries only a message string. So every backoff number below is a CHOICE and
 * cannot be validated against anything the API says.
 *
 * Given that, a QUEUE IS THE WRONG RESPONSE TO A RATE LIMIT: it converts a fast failure
 * into a slow one and keeps the pressure on the thing already refusing. The breaker
 * converts it into an immediate honest failure instead — the shopper gets
 * "couldn't reach Amazon" in about 5ms rather than a spinner for thirty seconds.
 *
 * Adding it later would mean the first time the limit bites is the time there is no
 * protection, on the page where the feature matters most.
 *
 * ── THE PER-INSTANCE LIMITATION, WHICH IS A DECISION AND NOT AN OVERSIGHT ─────────────
 *
 * Route handlers are serverless. This module's state lives in module scope, so THE BREAKER,
 * THE CACHE AND THE IN-FLIGHT MAP ARE ALL PER-INSTANCE. Under load you get N instances each
 * learning independently: N first-429s before N breakers open, and N copies of the same
 * cached offer.
 *
 * At 69 products carrying an ASIN this is fine and the alternative is worse — shared state
 * means an Edge Config or database read on EVERY request, to protect a call that takes
 * 200ms. IT BECOMES A REAL LIMIT AT SCALE, and the shape of the fix is known: move
 * `breakerOpenUntil` into Edge Config beside `amazon_live_enabled`, where the same
 * mechanism already reads a flag.
 *
 * Recorded here rather than in the work list deliberately: the next person to hit it will
 * be reading this file, not searching a 14,000-line document.
 */
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

export type LiveOffer = {
  asin: string;
  price: number;
  currency: string;
  displayPrice: string;
  sellerName: string | null;
  isBuyBoxWinner: boolean;
  inStock: boolean;
};

/** Four outcomes, and `no_offers` is deliberately not a failure. See below. */
export type FetchOutcome =
  | 'ok'
  | 'no_offers'
  | 'rate_limited'
  | 'breaker_open'
  | 'upstream_error'
  | 'timeout';

export type FetchResult = {
  outcome: FetchOutcome;
  offers: Record<string, LiveOffer>;
  durationMs: number;
  coalesced: boolean;
  cached: boolean;
};

const MARKETPLACE = 'www.amazon.co.uk';
const BATCH = 10;              // server ceiling; 12 returns 400 (item 60)
const TIMEOUT_MS = 4000;       // a shopper will not wait longer than the page took to load
const CACHE_TTL_MS = 30_000;   // SECONDS-SCALE ON PURPOSE — see the note below
const BREAKER_COOLDOWN_MS = 60_000;

// ── THE TTL IS COALESCING, NOT STORAGE ───────────────────────────────────────────────
//
// Amazon prices may not be STORED beyond 24 hours, and item 22 rules out caching for a
// stronger reason than the licence: a cached price served through an outage is a stored
// price whose refresh path no longer exists — the same frozen-state failure as a retired
// retailer's retained rows.
//
// A 30-SECOND TTL CANNOT OUTLIVE ITS REFRESH PATH. It exists to stop ten concurrent
// viewers of one product making ten identical calls, which is a property of concurrency
// rather than of storage. Raising it into minutes starts to make the frozen-state argument
// apply, so it is a constant with a reason and not a tunable.

let breakerOpenUntil = 0;
const cache = new Map<string, { at: number; offer: LiveOffer | null }>();
const inFlight = new Map<string, Promise<Map<string, LiveOffer | null>>>();

function api() {
  const SDK_DIR = path.join(os.homedir(), 'amazon-api-watch', 'sdk');
  const require = createRequire(path.join(SDK_DIR, 'examples', 'x.js'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdk: any = require(path.join(SDK_DIR, 'dist', 'index'));
  const c = new sdk.ApiClient();
  c.credentialId = process.env.CREATORS_CREDENTIAL_ID;
  c.credentialSecret = process.env.CREATORS_CREDENTIAL_SECRET;
  c.version = '3.2';
  return { api: new sdk.DefaultApi(c), GetItems: sdk.GetItemsRequestContent };
}

/** Pick the listing a shopper would actually be offered. Buy-box winner, else the first. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickListing(item: any): LiveOffer | null {
  const listings = item?.offersV2?.listings ?? [];
  if (!listings.length) return null;
  const l = listings.find((x: unknown) => (x as { isBuyBoxWinner?: boolean })?.isBuyBoxWinner) ?? listings[0];
  const money = l?.price?.money;
  if (!money || typeof money.amount !== 'number') return null;
  return {
    asin: item.asin,
    price: money.amount,
    currency: money.currency ?? 'GBP',
    displayPrice: money.displayAmount ?? `£${money.amount.toFixed(2)}`,
    // THE SELLER IS THE POINT, not a decoration. It is what the marker names, and it is the
    // single most decision-relevant fact about an Amazon listing.
    sellerName: l?.merchantInfo?.name ?? null,
    isBuyBoxWinner: l?.isBuyBoxWinner === true,
    inStock: l?.availability?.type === 'IN_STOCK',
  };
}

async function callAmazon(asins: string[]): Promise<Map<string, LiveOffer | null>> {
  const { api: client, GetItems } = api();
  const out = new Map<string, LiveOffer | null>();
  for (let i = 0; i < asins.length; i += BATCH) {
    const chunk = asins.slice(i, i + BATCH);
    const req = new GetItems();
    req.partnerTag = process.env.CREATORS_PARTNER_TAG;
    req.itemIds = chunk;
    req.resources = [
      'offersV2.listings.price',
      'offersV2.listings.availability',
      'offersV2.listings.merchantInfo',
      'offersV2.listings.isBuyBoxWinner',
    ];
    const res = await client.getItems(MARKETPLACE, req);
    // EVERY REQUESTED ASIN GETS AN ENTRY, including the ones Amazon did not return. A
    // partial return is silent and normal (item 60) and an absent ASIN is `no_offers`,
    // never a failure — those are different facts and the caller must be able to tell.
    for (const a of chunk) out.set(a, null);
    for (const item of res?.itemsResult?.items ?? []) out.set(item.asin, pickListing(item));
  }
  return out;
}

/**
 * Fetch live offers for up to a page's worth of ASINs.
 *
 * NEVER THROWS. Every failure is an outcome, because the caller's contract is to render a
 * visible state rather than to catch an exception.
 */
export async function fetchLiveOffers(asinsIn: string[]): Promise<FetchResult> {
  const started = Date.now();
  const asins = [...new Set(asinsIn.filter((a) => /^[A-Z0-9]{10}$/.test(a)))].sort();
  const empty = { offers: {}, durationMs: 0, coalesced: false, cached: false };
  if (!asins.length) return { outcome: 'no_offers', ...empty };

  if (Date.now() < breakerOpenUntil) {
    return { outcome: 'breaker_open', ...empty, durationMs: Date.now() - started };
  }

  const offers: Record<string, LiveOffer> = {};
  const missing: string[] = [];
  for (const a of asins) {
    const hit = cache.get(a);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      if (hit.offer) offers[a] = hit.offer;
    } else missing.push(a);
  }
  if (!missing.length) {
    return {
      outcome: Object.keys(offers).length ? 'ok' : 'no_offers',
      offers, durationMs: Date.now() - started, coalesced: false, cached: true,
    };
  }

  // SINGLE-FLIGHT. Concurrent requests for the same ASIN set share one upstream call —
  // most of the saving on any product page with traffic, and it costs nothing.
  const key = missing.join(',');
  let coalesced = true;
  let p = inFlight.get(key);
  if (!p) {
    coalesced = false;
    p = callAmazon(missing).finally(() => inFlight.delete(key));
    inFlight.set(key, p);
  }

  try {
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(Object.assign(new Error('timeout'), { fmbTimeout: true })), TIMEOUT_MS));
    const got = await Promise.race([p, timeout]);
    for (const [a, o] of got) {
      cache.set(a, { at: Date.now(), offer: o });
      if (o) offers[a] = o;
    }
    return {
      outcome: Object.keys(offers).length ? 'ok' : 'no_offers',
      offers, durationMs: Date.now() - started, coalesced, cached: false,
    };
  } catch (e) {
    const err = e as { status?: number; fmbTimeout?: boolean };
    if (err?.fmbTimeout) {
      return { outcome: 'timeout', offers, durationMs: Date.now() - started, coalesced, cached: false };
    }
    if (err?.status === 429) {
      // OPEN THE BREAKER. Not a retry, not a queue: the next requests fail in ~5ms with an
      // honest answer instead of joining the pile-up that caused this.
      breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
      return { outcome: 'rate_limited', offers, durationMs: Date.now() - started, coalesced, cached: false };
    }
    return { outcome: 'upstream_error', offers, durationMs: Date.now() - started, coalesced, cached: false };
  }
}

/** Exposed for the route's diagnostics only. */
export function breakerState(): { open: boolean; msRemaining: number } {
  const ms = Math.max(0, breakerOpenUntil - Date.now());
  return { open: ms > 0, msRemaining: ms };
}
