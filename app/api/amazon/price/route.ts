import { NextResponse } from 'next/server';
import { get } from '@vercel/edge-config';
import { fetchLiveOffers, breakerState, type FetchOutcome } from '../../../../lib/amazon-live';
import { supabase } from '../../../../lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Live Amazon offers for one page's ASINs. Called from the client AFTER hydration.
 *
 * WHY A ROUTE HANDLER AND NOT A SERVER COMPONENT FETCH. Product pages are ISR at
 * revalidate = 3600. A fetch inside the render makes the price AS STALE AS THE PAGE, which
 * breaks the 24-hour rule and — worse — presents an hour-old number as live. Fetching per
 * VIEW rather than per RENDER makes the staleness problem not arise at all.
 *
 * WHY NOT FROM THE BROWSER DIRECTLY. The Creators credentials would be public, and there
 * would be no single place to throttle or back off.
 *
 * ONE REQUEST PER PAGE, BATCHED. Measured 17 Aug: ten ASINs cost the same as one (197-439ms
 * either way), so per-row would fire twelve client requests, twelve invocations and twelve
 * upstream calls on the routine builder — compounding the rate limit precisely on the page
 * where the feature is most valuable. Twelve items is two upstream calls behind one client
 * request, because the batch ceiling is ten.
 */

const MAX_ASINS = 12;   // the routine builder's largest observed routine
const KILL_SWITCH_KEY = 'amazon_live_enabled';

/**
 * KILL SWITCH, READ PER REQUEST, NO DEPLOY NEEDED.
 *
 * Same store and same mechanism as the orphan gate, deliberately: a second flag in a
 * proven place beats a new mechanism. THE POLARITY IS THE OPPOSITE OF THE ORPHAN GATE'S
 * AND THAT IS INTENTIONAL — the gate fails CLOSED because leaving 20,849 dead URLs live is
 * the harm; this fails OPEN-AS-OFF, because an unreachable config must not be able to start
 * a feature nobody has turned on.
 *
 * `typeof === 'boolean'` and not truthiness, for the reason recorded in middleware.ts: a
 * deliberate `false` must win over the default rather than being treated as "no answer".
 *
 * ── IF YOU ARE TESTING ON A PREVIEW URL AND THE ROW NEVER APPEARS, READ THIS ──────────
 *
 * `EDGE_CONFIG` is scoped to PRODUCTION ONLY. On a preview deployment the connection string
 * is absent, `get()` throws, this catch fires, and the feature stays OFF — correctly, by the
 * fail-off rule below.
 *
 * SO A PREVIEW LOOKS EXACTLY LIKE A BROKEN FEATURE: no row, no error, nothing in the
 * console. It is the default working, not a bug, and it will cost an hour to whoever meets
 * it first without this paragraph. Verify on production, or scope `EDGE_CONFIG` to Preview
 * as well and accept that previews then read the live flag.
 */
async function liveEnabled(): Promise<boolean> {
  try {
    const v = await get<boolean>(KILL_SWITCH_KEY);
    if (typeof v === 'boolean') return v;
  } catch {
    // Unreadable config is not permission to run.
  }
  return false;
}

/**
 * THIS LOG MUST NEVER CONTAIN A PRICE. Amazon prices may not be stored beyond 24 hours and
 * a log row holding one is storage. Outcomes, counts and durations only — the question it
 * answers is how often the fetch fails and how fast, never what it said. The table has a
 * migration-time assertion that no column could hold a price, a seller or an ASIN.
 */
async function logFetch(row: {
  outcome: FetchOutcome | 'disabled';   // 'disabled' is the route's own, not the fetcher's
  asin_count: number;
  offers_found: number;
  duration_ms: number;
  coalesced: boolean;
  cached: boolean;
  surface: string | null;
}) {
  try {
    await supabase.from('amazon_live_fetch_log').insert(row);
  } catch (err) {
    // A diagnostics failure must never affect the response.
    console.error('[amazon/price] log failed:', err);
  }
}

export async function POST(request: Request) {
  const started = Date.now();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const surface = typeof body.surface === 'string' ? body.surface.slice(0, 40) : null;
  const asins = Array.isArray(body.asins)
    ? body.asins.filter((a): a is string => typeof a === 'string').slice(0, MAX_ASINS)
    : [];

  if (!(await liveEnabled())) {
    await logFetch({
      outcome: 'disabled', asin_count: asins.length, offers_found: 0,
      duration_ms: Date.now() - started, coalesced: false, cached: false, surface,
    });
    // `disabled` is reported to the client as its own state, not as a failure: the row
    // should render nothing at all rather than "couldn't reach Amazon", because nothing
    // was attempted and claiming an outage would be untrue. `misconfigured` and
    // `nothing_requested` are the same category — see the enumeration in lib/amazon-live.ts.
    return NextResponse.json({ outcome: 'disabled', offers: {} });
  }

  const result = await fetchLiveOffers(asins);

  await logFetch({
    outcome: result.outcome,
    asin_count: asins.length,
    offers_found: Object.keys(result.offers).length,
    duration_ms: result.durationMs,
    coalesced: result.coalesced,
    cached: result.cached,
    surface,
  });

  // THE OUTCOME REACHES THE CLIENT VERBATIM and `no_offers` is not a failure. A disappearing
  // row is indistinguishable from a product Amazon does not carry, and those are different
  // facts — as are "we never asked" and "we asked and could not reach them".
  return NextResponse.json({
    outcome: result.outcome,
    offers: result.offers,
    // Diagnostics only; the client does not branch on these.
    meta: { cached: result.cached, coalesced: result.coalesced, breaker: breakerState().open },
  });
}
