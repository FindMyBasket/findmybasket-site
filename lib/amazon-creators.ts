/**
 * Direct Creators API client. Two calls, no SDK.
 *
 * ── WHY NOT THE SDK ──────────────────────────────────────────────────────────────────
 *
 * The vendored SDK lives at ~/amazon-api-watch/sdk and DOES NOT EXIST IN PRODUCTION. The
 * harvest scripts run on a laptop; this runs on Vercel. Vendoring it into the repo to reach
 * four resource strings against a large generated surface is the wrong trade, and the only
 * genuinely fiddly part — the auth — turned out to be bounded.
 *
 * ── IT IS NOT SigV4, AND THAT WAS AN ASSUMPTION WORTH CHECKING ────────────────────────
 *
 * PA-API v5 signed requests with AWS SigV4. The Creators API (Nov 2025) does not: it is
 * OAuth2 client-credentials with a Bearer token. There is no canonical request, no region,
 * no service name and no AWS4-HMAC-SHA256 anywhere in the SDK — it ships auth/OAuth2Config
 * and auth/OAuth2TokenManager and no signing module at all.
 *
 * Both shapes below were captured from the SDK's own outbound HTTP on a live call, so this
 * is a transcription of the reference implementation that harvested 764 ASINs rather than a
 * reading of documentation:
 *
 *   POST https://api.amazon.co.uk/auth/o2/token
 *        {"grant_type":"client_credentials","client_id":…,"client_secret":…,
 *         "scope":"creatorsapi::default"}                       ← JSON, not form-encoded
 *
 *   POST https://creatorsapi.amazon/catalog/v1/getItems
 *        headers: authorization: Bearer …, x-marketplace: www.amazon.co.uk
 *        {"partnerTag":…,"itemIds":[…],"resources":[…]}
 *
 * `scope` and the JSON content-type are the two details a documentation-first implementation
 * would most likely get wrong, and both are transcribed rather than guessed.
 */

const TOKEN_URL = 'https://api.amazon.co.uk/auth/o2/token';
const API_URL = 'https://creatorsapi.amazon/catalog/v1/getItems';
const MARKETPLACE = 'www.amazon.co.uk';
const SCOPE = 'creatorsapi::default';

/**
 * THE RESOURCE STRINGS ARE A CONTRACT, NOT A LIST, AND OMITTING ONE FAILS SILENTLY.
 *
 * Measured 17 August: requesting only `offersV2.listings.price` returns a listing whose
 * `merchantInfo` is `undefined` — no error, no warning, no empty object. The row then
 * renders "delivery not included" with no seller, which is EXACTLY THE GENERIC CAVEAT THE
 * SELLER NAME WAS ADDED TO REPLACE.
 *
 * So the feature would have degraded silently into the thing it was built to fix. That is
 * why this is a named constant with an assertion against it rather than an array literal at
 * the call site.
 */
export const REQUIRED_RESOURCES = [
  'offersV2.listings.price',
  'offersV2.listings.availability',
  'offersV2.listings.merchantInfo',
  'offersV2.listings.isBuyBoxWinner',
] as const;

export class CreatorsError extends Error {
  constructor(public status: number, public detail: string) {
    super(`creators ${status}: ${detail}`);
  }
}

let token: { value: string; expiresAt: number } | null = null;

/**
 * Client-credentials token, cached until shortly before expiry.
 *
 * The 60-second skew is not politeness: a token that expires mid-flight returns 401, which
 * this module would report as `upstream_error`, which the UI would render as
 * "couldn't reach Amazon" — a visible lie about a condition we could have avoided.
 */
async function getToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt) return token.value;

  const id = process.env.CREATORS_CREDENTIAL_ID;
  const secret = process.env.CREATORS_CREDENTIAL_SECRET;
  if (!id || !secret) throw new CreatorsError(0, 'CREATORS_CREDENTIAL_ID/SECRET not set');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // JSON, NOT form-encoded. The OAuth2 spec says form-encoded and Amazon accepts JSON
    // here; this is transcribed from the working SDK rather than from the spec.
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
      scope: SCOPE,
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new CreatorsError(res.status, text.slice(0, 200));

  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new CreatorsError(res.status, 'no access_token in token response');

  token = {
    value: json.access_token,
    expiresAt: Date.now() + Math.max(0, (json.expires_in ?? 3600) - 60) * 1000,
  };
  return token.value;
}

/** Discard the cached token. Used when a call returns 401 so the next attempt re-authenticates. */
export function invalidateToken() {
  token = null;
}

export type CreatorsItem = {
  asin: string;
  offersV2?: {
    listings?: Array<{
      price?: { money?: { amount?: number; currency?: string; displayAmount?: string } };
      availability?: { type?: string };
      merchantInfo?: { name?: string; id?: string };
      isBuyBoxWinner?: boolean;
    }>;
  };
};

/**
 * getItems for up to ten ASINs. Throws CreatorsError on any non-2xx.
 *
 * THROWS RATHER THAN RETURNING EMPTY, DELIBERATELY. An empty result and a failed call are
 * different facts (item 22): the caller maps them to `no_offers` and `upstream_error`
 * respectively, and the UI renders "Amazon doesn't stock this" against "couldn't reach
 * Amazon". A client that swallowed errors into an empty array would collapse that
 * distinction here, where the caller cannot recover it.
 */
export async function getItems(asins: string[]): Promise<CreatorsItem[]> {
  const partnerTag = process.env.CREATORS_PARTNER_TAG;
  if (!partnerTag) throw new CreatorsError(0, 'CREATORS_PARTNER_TAG not set');

  // ASSERT THE CONTRACT RATHER THAN TRUSTING IT. The seller marker depends on
  // merchantInfo being requested, and its absence is invisible in the response.
  if (!REQUIRED_RESOURCES.includes('offersV2.listings.merchantInfo')) {
    throw new CreatorsError(0, 'merchantInfo resource missing from REQUIRED_RESOURCES');
  }

  const doCall = async (bearer: string) =>
    fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${bearer}`,
        'x-marketplace': MARKETPLACE,
      },
      body: JSON.stringify({ partnerTag, itemIds: asins, resources: [...REQUIRED_RESOURCES] }),
    });

  let res = await doCall(await getToken());
  if (res.status === 401) {
    // One re-auth, not a retry loop: a 401 after a fresh token is a credentials problem and
    // retrying it is how a rate limit gets amplified by something that is not rate limited.
    invalidateToken();
    res = await doCall(await getToken());
  }

  const text = await res.text();
  if (!res.ok) throw new CreatorsError(res.status, text.slice(0, 200));

  const json = JSON.parse(text) as { itemsResult?: { items?: CreatorsItem[] } };
  return json.itemsResult?.items ?? [];
}
