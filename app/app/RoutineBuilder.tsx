'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { supabaseBrowser as db } from '@/lib/supabase-browser';
import { AffiliateDisclosure } from '@/components/AffiliateDisclosure';
import {
  getRoutine,
  addToRoutine as storeAdd,
  removeFromRoutine as storeRemove,
  clearRoutine as storeClear,
  onRoutineChange,
  type RoutineItem,
} from '@/lib/routine-store';
import { displayProductTitle } from '@/lib/format/product-name';
import {
  trackAffiliateClickOut,
  trackRetailerClick,
  trackBasketOptimised,
  affiliateNetworkFromUrl,
  directDestinationUrl,
  sendOutboundBeacon,
  awinMidFromHref,
} from '@/lib/analytics';
import { ClickOutLink } from '@/components/ClickOutLink';
import { retailerSubtotals } from '@/lib/basket-attribution';
import { deliveryFor } from '@/lib/delivery';

// Affiliate tags — reused exactly from the previous bottom-of-basket links.
const AMAZON_TAG = 'findmybasket-21';

// How long the arrival waits for a `?routine=` preload before showing the explicit
// failure state instead of a spinner.
//
// This is NOT a give-up point. The request is never aborted, so a response landing
// after this still repopulates the routine and clears the failure (see the preload
// effect). The only thing this bound decides is how long someone stares at a
// spinner before being told something honest — which is why it can be short.
//
// Measured 2026-08-02 on the preview deployment: the preload query ran at a median
// of 56ms (range 33-71ms over 8 runs) and the routine rendered at a median of 146ms.
// 3s is roughly 50x the measured median, which absorbs a badly degraded mobile
// connection while halving the worst-case wait for someone arriving from a pin.
// Network throttling could not be applied with the available tooling, so the
// headroom is reasoned from that baseline rather than measured under load.
const PRELOAD_TIMEOUT_MS = 3000;

// Where a `?routine=` arrival came from, for the load_routine_from_url event.
//
// This was hardcoded to 'email' because saved-routine emails were the only thing
// that produced these links. Pinterest routine pins now point here too, so a
// hardcoded value would report every pin arrival as email and make the whole
// preload test unreadable.
//
// Read from utm_source, which is what a campaign link carries. Returns 'unknown'
// rather than guessing when there is none: the saved-routine emails currently send
// no utm_source (see supabase/functions/send-routine-email/index.ts), so email
// arrivals land in 'unknown' until that function is changed to tag its links. That
// is deliberate — an honest 'unknown' beats an 'email' default that would silently
// absorb every untagged source.
function routineArrivalSource(): string {
  if (typeof window === 'undefined') return 'unknown';
  const p = new URLSearchParams(window.location.search);
  return p.get('utm_source') || p.get('source') || 'unknown';
}

// Parse `?routine=1,2,3` into product ids. Shared by the hydration gate and the
// preload effect so the two can never disagree about whether a URL routine is
// present — if they did, the gate would hold a spinner for a preload that is
// never going to run, or release the empty state over one that is.
function parseRoutineParam(): number[] {
  if (typeof window === 'undefined') return [];
  const raw = new URLSearchParams(window.location.search).get('routine');
  if (!raw) return [];
  return raw
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n));
}

// ── TYPES ──────────────────────────────────────────────────────────────────

interface PriceRow {
  product_id: number;
  retailer_id: number;
  price: string | number;
  url: string;
  in_stock: boolean;
  retailers: {
    name: string;
    delivery_threshold: number | string | null;
    delivery_cost: number | string | null;
  };
}

interface BreakdownItem {
  product: RoutineItem;
  price: number | null;
  retailerName: string;
  // Absent only for the "Not tracked yet" fallback row, which has no retailer.
  retailerId?: number;
  url: string;
}

interface BasketOption {
  retailers: string[];
  total: number;
  productsTotal: number;
  // null when the retailer's delivery terms are unrecorded. NOT zero: zero means
  // "free", null means "we do not know", and conflating them is what let a flat
  // retailer be shown as free delivery. See lib/delivery.ts.
  deliveryCost: number | null;
  deliveryUnknown?: boolean;
  breakdown: BreakdownItem[];
  type: 'single' | 'split';
  partial?: boolean;
}

// What a `?routine=` arrival landed on. Three cases are distinguishable at the
// moment the preload writes to the store, and they must be, because two of them
// look identical to a naive "was the basket empty" test:
//
//   clean         nothing in the basket before the preload.
//   self_reload   the basket already contained every product the link resolved to,
//                 so nothing was added. This is a refresh of a preload URL, or a
//                 back-navigation from a retailer tab, and it is almost certainly
//                 the commonest non-empty case on pin traffic. It is a CLEAN
//                 arrival that a "basket was not empty" flag would misfile as a
//                 collision, filling the merged bucket with the exact sessions the
//                 test is trying to isolate.
//   merged        a genuine collision: the visitor had a basket, and the link added
//                 to it. The only case the notice speaks to.
//
// merged_cleared is not an arrival case — it is set when the visitor takes the way
// out below. See startFresh.
type PreloadCase = 'clean' | 'self_reload' | 'merged' | 'merged_cleared';

// Amazon search URL for the unranked cross-check row. The per-routine-item
// "Also check Amazon" LINK was removed in phase 0.3; this builds the URL for the
// cross-check that remains outside the ranking. Item 245.
function amazonSearchUrl(p: RoutineItem): string {
  const q = encodeURIComponent(`${p.brand ?? ''} ${p.name}`.trim());
  return `https://www.amazon.co.uk/s?k=${q}&tag=${AMAZON_TAG}`;
}

const ROUTINE_EMOJIS = ['🧴', '✨', '💧', '🌿', '☀️', '🫧', '💆', '🌸'];

// ── COMPONENT ──────────────────────────────────────────────────────────────

export default function RoutineBuilder() {
  // Routine state — driven by routine-store so it syncs with other pages
  const [routine, setRoutine] = useState<RoutineItem[]>([]);
  // Track whether we've finished hydrating from localStorage so we don't
  // flash the empty state on the first paint for users with a saved routine.
  const [hydrated, setHydrated] = useState(false);

  // Optimisation results
  const [isOptimising, setIsOptimising] = useState(false);
  const [results, setResults] = useState<BasketOption[] | null>(null);
  const [savings, setSavings] = useState<number>(0);
  const [showSavings, setShowSavings] = useState(false);
  const [showSaveCard, setShowSaveCard] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Size of the basket that produced the CURRENT results — snapshotted at run time
  // so every optimiser-basket event (basket_optimised + the Shop/open-all/modal
  // retailer_clicks) reports the same count, even if the routine is edited after the
  // run leaves stale results on screen. Live routine.length would diverge from the
  // basket_optimised count in that window. Null until the first run.
  const [optimisedItemCount, setOptimisedItemCount] = useState<number | null>(null);

  // Save routine state
  const [saveEmail, setSaveEmail] = useState('');
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'success' | 'error'
  >('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [emailDisabled, setEmailDisabled] = useState(false);

  // Signed-in users save straight to their account (fmb_track_product);
  // everyone else keeps the legacy email path until the cutover completes.
  const [authedEmail, setAuthedEmail] = useState<string | null>(null);

  // Arrival state for a `?routine=` link. 'idle' is every ordinary visit, so the
  // no-parameter path is untouched. 'pending' holds the loading state open so the
  // empty state cannot render in the gap between hydration and the preload
  // resolving. 'failed' is an explicit "we couldn't load that routine" — never a
  // silent fall-through to the empty state, which would be the same bug arriving
  // five seconds later.
  const [preload, setPreload] = useState<'idle' | 'pending' | 'failed'>('idle');

  // How many ids in a `?routine=` link resolved to nothing, so the routine can say
  // it arrived short instead of silently being shorter than the link promised.
  //
  // The observed cause is a product losing every price row at an active retailer:
  // of the unresolvable ids in real saved routines, none were merged or reparented
  // (measured 2 August 2026). Merged and variant ids CAN also land here — resolving
  // those is deliberately deferred, see the preload query's comment — so the wording
  // stays on what the visitor experiences ("no longer available") rather than naming
  // a cause that would be wrong for most of them.
  const [preloadMissing, setPreloadMissing] = useState(0);

  // Non-null once a `?routine=` link has populated the routine, carrying WHICH
  // arrival case it was. Suffixes the click source on every outbound click this
  // page writes to `outbound_clicks`, so preload-originated clicks are separable
  // from ones made by a visitor who built the basket themselves. Without it the
  // preload test deploys and measures nothing: `source` already carries
  // product_page / optimiser_shop_button / optimiser_modal, and both arrivals
  // would land in the same buckets.
  //
  // This carries the case rather than a boolean because the distinction has to
  // ride on the CLICK, not only on the arrival event. GA4 event-scoped parameters
  // do not join across events, so a flag on load_routine_from_url alone cannot
  // filter retailer_click — numerator and denominator each need it on their own
  // event. The same string reaches outbound_clicks.source via sendOutboundBeacon,
  // so both pipelines get the distinction from this one line and neither needs a
  // schema change, a session cookie, or the consent question that would come with
  // one. (session_id is NULL on every row of outbound_clicks and search_events, by
  // DECISION rather than omission — the writer was removed 13 Aug 2026, work-list
  // item 82. A click cannot be linked to an arrival server-side, and will not be.)
  const [preloadCase, setPreloadCase] = useState<PreloadCase | null>(null);

  // `optimiser_shop_button` -> `optimiser_shop_button_preload_merged`. Suffixing
  // keeps the established vocabulary intact and greppable rather than inventing a
  // parallel set of names, and needs no schema change. `_preload` stays the common
  // stem so `source like '%_preload%'` still catches every preload click including
  // the three rows written before this commit, which carry the bare `_preload`.
  const clickSourceFor = useCallback(
    (base: string) => (preloadCase ? `${base}_preload_${preloadCase}` : base),
    [preloadCase],
  );

  // How many products the preload actually added, for the collision notice. Not
  // the count in the URL and not the count that resolved: addToRoutine is a union
  // and returns added:false for an id already in the basket, so an overlapping
  // basket adds fewer than it resolved. Zero on a self_reload, which is why the
  // notice is suppressed there rather than rendering "Added 0 products".
  const [preloadAddedCount, setPreloadAddedCount] = useState(0);

  // The resolved, URL-ordered products this link asked for, kept so the way out of
  // a collision can repopulate from them without re-querying, and so the notice can
  // tell link products from everything else. Held in a ref rather than state because
  // nothing renders it directly.
  const preloadItems = useRef<RoutineItem[]>([]);

  // How many products in the routine did NOT come from this link. The notice renders
  // on this rather than on the arrival case, so it describes the basket the visitor is
  // looking at instead of an event that happened once.
  //
  // BY IDENTITY, NOT ARITHMETIC. `routine.length - preloadItems.current.length` agrees
  // with this only while the basket is a superset of the link. Remove one of the LINK's
  // own products and the subtraction reports one extra where there are still two, which
  // is wrong in the one direction that matters — it understates how much of the basket
  // the pin did not promise. Set membership stays exact under any editing.
  //
  // Zero on a clean arrival (the routine is exactly the link), zero on a reload of a
  // basket holding only the link's products, and zero again after startFresh — so
  // merged_cleared needs no special case here, it falls out.
  const preloadLinkIds = new Set(preloadItems.current.map(p => p.id));
  const preloadExtras = preloadCase
    ? routine.filter(p => !preloadLinkIds.has(p.id)).length
    : 0;

  useEffect(() => {
    db.auth.getSession().then(({ data }) => {
      setAuthedEmail(data.session?.user?.email ?? null);
    });
  }, []);

  // Modal for popup-blocked product links
  const [blockedLinks, setBlockedLinks] = useState<
    {
      name: string;
      url: string;
      retailer: string;
      retailerId?: number;
      price: number | null;
      productId: number;
    }[] | null
  >(null);

  // ── ROUTINE STORE SYNC ────────────────────────────────────────────────

  useEffect(() => {
    const stored = getRoutine();
    setRoutine(stored);
    // Claim the loading state BEFORE hydrating, in the same tick, so there is no
    // render in which hydrated is true and the routine is still empty — that gap
    // is what showed "Your routine is empty" to visitors following a routine link.
    // Only when the store is empty: a visitor who already has a basket sees it
    // immediately rather than waiting behind the network (the preload still merges
    // into it when it lands).
    if (stored.length === 0 && parseRoutineParam().length > 0) setPreload('pending');
    setHydrated(true);
    const unsub = onRoutineChange(() => setRoutine(getRoutine()));
    return unsub;
  }, []);

  // ── URL PARAM PRELOAD ─────────────────────────────────────────────────
  // Saved-routine emails link to /app?routine=1,2,3 — preserve that behaviour.

  useEffect(() => {
    const productIds = parseRoutineParam();
    if (productIds.length === 0) {
      // Covers `?routine=` and `?routine=abc`. The gate uses the same parser, so
      // it never went pending here — but clear defensively rather than rely on it.
      setPreload('idle');
      return;
    }

    let cancelled = false;
    // Bounded wait. Only escalates a still-pending arrival; it never overrides a
    // preload that already resolved, and the request is NOT aborted — if it lands
    // late it still repopulates the routine below.
    const timer = setTimeout(() => {
      if (!cancelled) setPreload(p => (p === 'pending' ? 'failed' : p));
    }, PRELOAD_TIMEOUT_MS);

    (async () => {
      const { data, error } = await db
        .from('products_active')
        .select('id, name, brand, product_type')
        .in('id', productIds);

      if (cancelled) return;

      if (error || !data || data.length === 0) {
        // Only claim failure if there is nothing to show. A visitor who already
        // had a basket keeps it, and never sees a failure screen over it.
        setPreload(getRoutine().length === 0 ? 'failed' : 'idle');
        return;
      }

      // `.in()` returns database order (ascending id), not the order given in the
      // URL, so a routine pin's steps arrive sorted by id rather than cleanse ->
      // tone -> serum -> SPF. Reorder before adding: storeAdd appends, and the
      // store preserves insertion order, so this is the only place order is set.
      // First occurrence wins for a repeated id, and anything unexpectedly absent
      // from the map sorts last rather than jumping to the front.
      const urlOrder = new Map<number, number>();
      productIds.forEach((id, i) => {
        if (!urlOrder.has(id)) urlOrder.set(id, i);
      });

      // Anything the link asked for that products_active did not return. Counted
      // against the de-duplicated request (urlOrder), so a repeated id in the URL
      // is not reported as a missing product.
      setPreloadMissing(Math.max(0, urlOrder.size - data.length));
      const items: RoutineItem[] = data
        .slice()
        .sort(
          (a, b) =>
            (urlOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (urlOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        )
        .map(p => ({
          id: p.id,
          name: p.name,
          brand: p.brand || '',
          category: p.product_type || '',
        }));

      preloadItems.current = items;

      // Read the basket state at the ONLY moment it is still the pre-preload one.
      // Nothing between this effect starting and here writes to the store — just
      // the awaited query and the sort above — so localStorage still holds exactly
      // what the visitor arrived with. The hydration gate's `preload === 'pending'`
      // cannot be used as a proxy for "was empty": it is only ever set when the
      // store was empty, but the 3s timeout can flip it to 'failed' before the
      // query lands, so reading it here would be wrong on a slow connection.
      const existingCount = getRoutine().length;

      let addedCount = 0;
      for (const it of items) {
        if (storeAdd(it).added) addedCount++;
      }
      setPreloadAddedCount(addedCount);
      setRoutine(getRoutine());
      // Release the gate: the routine is populated, so the layout renders. Also
      // clears a 'failed' set by the timeout if the response arrived late.
      setPreload('idle');

      // addedCount === 0 on a non-empty basket means every product the link
      // resolved to was already there — a refresh or a back-navigation, not a
      // collision. Tested on added rather than on set-superset because the two are
      // equivalent here and this one is measured against what was actually
      // addable: an id the link asked for but products_active did not return was
      // never going to be added, and must not make a self_reload look merged.
      const arrivalCase: PreloadCase =
        existingCount === 0 ? 'clean' : addedCount === 0 ? 'self_reload' : 'merged';

      // Every outbound click from here on is attributable to a preloaded arrival,
      // and now to which kind. Session-scoped on purpose: if the visitor adds more
      // products by hand and re-optimises, the session still originated from the
      // link, which is the question the test is asking.
      setPreloadCase(arrivalCase);

      if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
        (window as any).gtag('event', 'load_routine_from_url', {
          routine_size: items.length,
          source: routineArrivalSource(),
          // preload_case, not a basket_was_empty boolean. A boolean cannot separate
          // self_reload from merged, and on pin traffic that is the difference
          // between a readable test and a merged bucket full of clean sessions.
          preload_case: arrivalCase,
          // Both counts, so the size of any contamination is quantifiable rather
          // than inferred from the case alone.
          existing_item_count: existingCount,
          added_item_count: addedCount,
        });
      }

      // Auto-run the optimiser so users see savings immediately
      setTimeout(() => runOptimiser('auto_shared_link'), 300);
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── REMOVE FROM ROUTINE ───────────────────────────────────────────────

  const handleRemove = (id: number) => {
    storeRemove(id);
    const next = getRoutine();
    setRoutine(next);
    if (next.length === 0) resetResults();
  };

  // ── BASKET OPTIMISATION ───────────────────────────────────────────────

  const resetResults = useCallback(() => {
    setResults(null);
    setShowSavings(false);
    setShowSaveCard(false);
    setErrorMsg(null);
    setOptimisedItemCount(null);
  }, []);

  const runOptimiser = useCallback(async (
    trigger: 'user_action' | 'auto_shared_link' = 'user_action',
  ) => {
    const current = getRoutine();
    if (current.length === 0) return;

    setIsOptimising(true);
    setErrorMsg(null);

    const productIds = current.map(p => p.id);

    // Only ACTIVE retailers are purchasable — an inactive retailer's offer must
    // never reach the optimiser, or it can be recommended as the basket with a
    // live outbound link to a product we no longer list. `retailers!inner` makes
    // the embed an inner join so the filter drops the price row, not just the
    // embedded object.
    const { data: pricesRaw } = await db
      .from('retailer_prices')
      .select('*, retailers!inner(*)')
      .in('product_id', productIds)
      .eq('in_stock', true)
      .eq('retailers.active', true);

    const prices: PriceRow[] | null = (pricesRaw as PriceRow[] | null);

    setIsOptimising(false);

    if (!prices || prices.length === 0) {
      setErrorMsg('No price data found. Please try again later.');
      return;
    }

    type PriceEntry = {
      price: number;
      url: string;
      retailerId: number;
      retailerName: string;
      deliveryModel: string | null;
      deliveryThreshold: number | string | null;
      deliveryCost: number | string | null;
    };
    const priceMap: Record<number, Record<number, PriceEntry>> = {};
    for (const row of prices) {
      if (!priceMap[row.product_id]) priceMap[row.product_id] = {};
      priceMap[row.product_id][row.retailer_id] = {
        price: parseFloat(String(row.price)),
        url: row.url,
        retailerId: row.retailer_id,
        retailerName: row.retailers.name,
        // Terms carried verbatim. Previously coerced here with ?? '25' / ?? '3.95',
        // which made every retailer look tiered at £25 and hid Debenhams being flat.
        deliveryModel: (row.retailers as { delivery_model?: string | null }).delivery_model ?? null,
        deliveryThreshold: row.retailers.delivery_threshold ?? null,
        deliveryCost: row.retailers.delivery_cost ?? null,
      };
    }

    const allRetailerIds = [...new Set(prices.map(p => p.retailer_id))];

    // Single-retailer options
    const singleOptions: BasketOption[] = [];
    for (const rid of allRetailerIds) {
      let total = 0;
      let covered = 0;
      const breakdown: BreakdownItem[] = [];
      let retailerName = '';

      for (const product of current) {
        const pp = priceMap[product.id]?.[rid];
        if (pp) {
          total += pp.price;
          covered++;
          retailerName = pp.retailerName;
          breakdown.push({
            product,
            price: pp.price,
            retailerName: pp.retailerName,
            retailerId: pp.retailerId,
            url: pp.url,
          });
        }
      }

      if (covered === current.length) {
        const rInfo = prices.find(p => p.retailer_id === rid)?.retailers;
        const d = deliveryFor(rInfo ?? {}, total);
        // Unknown terms: keep the goods visible, refuse to claim a delivered total.
        // Never defaulted to a number, which is what produced the original defect.
        if (!d.known) {
          singleOptions.push({
            retailers: [retailerName], total, productsTotal: total,
            deliveryCost: null, deliveryUnknown: true, breakdown, type: 'single',
          });
          continue;
        }
        const deliveryCost = d.cost;
        singleOptions.push({
          retailers: [retailerName],
          total: total + deliveryCost,
          productsTotal: total,
          deliveryCost,
          breakdown,
          type: 'single',
        });
      }
    }

    // Worst-case anchor: the whole basket bought at the single most expensive
    // retailer that stocks every item, with that one retailer's delivery applied
    // once (singleOptions already enforce full coverage + threshold logic). A real
    // basket a shopper could assemble — no multi-retailer delivery stacking — so
    // the headline saving reconciles if anyone checks it. Zero when no single shop
    // stocks the whole basket, in which case no single-shop saving is shown.
    const worstSingleShopTotal =
      singleOptions.length > 0 ? Math.max(...singleOptions.map(o => o.total)) : 0;

    // Two-retailer combinations
    const twoOptions: BasketOption[] = [];
    for (let i = 0; i < allRetailerIds.length; i++) {
      for (let j = i + 1; j < allRetailerIds.length; j++) {
        const r1 = allRetailerIds[i];
        const r2 = allRetailerIds[j];
        let total = 0;
        const breakdown: BreakdownItem[] = [];
        let r1Total = 0;
        let r2Total = 0;
        let r1Name = prices.find(p => p.retailer_id === r1)?.retailers?.name || '';
        let r2Name = prices.find(p => p.retailer_id === r2)?.retailers?.name || '';
        let r1Info = prices.find(p => p.retailer_id === r1)?.retailers || null;
        let r2Info = prices.find(p => p.retailer_id === r2)?.retailers || null;
        let allCovered = true;

        for (const product of current) {
          const p1 = priceMap[product.id]?.[r1];
          const p2 = priceMap[product.id]?.[r2];

          if (!p1 && !p2) {
            allCovered = false;
            break;
          }

          if (p1 && p2) {
            if (p1.price <= p2.price) {
              r1Total += p1.price;
              total += p1.price;
              r1Name = p1.retailerName;
              if (!r1Info) r1Info = prices.find(p => p.retailer_id === r1)?.retailers || null;
              breakdown.push({
                product,
                price: p1.price,
                retailerName: p1.retailerName,
                retailerId: p1.retailerId,
                url: p1.url,
              });
            } else {
              r2Total += p2.price;
              total += p2.price;
              r2Name = p2.retailerName;
              if (!r2Info) r2Info = prices.find(p => p.retailer_id === r2)?.retailers || null;
              breakdown.push({
                product,
                price: p2.price,
                retailerName: p2.retailerName,
                retailerId: p2.retailerId,
                url: p2.url,
              });
            }
          } else if (p1) {
            r1Total += p1.price;
            total += p1.price;
            r1Name = p1.retailerName;
            if (!r1Info) r1Info = prices.find(p => p.retailer_id === r1)?.retailers || null;
            breakdown.push({
              product,
              price: p1.price,
              retailerName: p1.retailerName,
              retailerId: p1.retailerId,
              url: p1.url,
            });
          } else if (p2) {
            r2Total += p2.price;
            total += p2.price;
            r2Name = p2.retailerName;
            if (!r2Info) r2Info = prices.find(p => p.retailer_id === r2)?.retailers || null;
            breakdown.push({
              product,
              price: p2.price,
              retailerName: p2.retailerName,
              retailerId: p2.retailerId,
              url: p2.url,
            });
          }
        }

        if (!allCovered) continue;

        const o1 = deliveryFor(r1Info ?? {}, r1Total);
        const o2 = deliveryFor(r2Info ?? {}, r2Total);
        // If either leg's terms are unknown the PAIR's delivered total is unknown, so
        // it cannot be ranked against pairs whose delivery is known. Skip rather than
        // guess: a guessed number competing with a real one is how the £25 default
        // made Debenhams look free.
        if (!o1.known || !o2.known) continue;
        const d1 = o1.cost;
        const d2 = o2.cost;

        const retailers: string[] = [];
        if (r1Total > 0 && r1Name) retailers.push(r1Name);
        if (r2Total > 0 && r2Name) retailers.push(r2Name);

        if (retailers.length < 2) continue;

        twoOptions.push({
          retailers,
          total: total + d1 + d2,
          productsTotal: total,
          deliveryCost: d1 + d2,
          breakdown,
          type: 'split',
        });
      }
    }

    const allOptions = [...singleOptions, ...twoOptions].sort(
      (a, b) => a.total - b.total,
    );

    if (allOptions.length === 0) {
      // Fallback: best effort using cheapest per product
      const fallbackBreakdown: BreakdownItem[] = [];
      let fallbackTotal = 0;

      for (const product of current) {
        const productPrices = priceMap[product.id];
        if (!productPrices || Object.keys(productPrices).length === 0) {
          fallbackBreakdown.push({
            product,
            price: null,
            retailerName: 'Not tracked yet',
            url: amazonSearchUrl(product),
          });
        } else {
          const cheapest = Object.values(productPrices).sort(
            (a, b) => a.price - b.price,
          )[0];
          fallbackTotal += cheapest.price;
          fallbackBreakdown.push({
            product,
            price: cheapest.price,
            retailerName: cheapest.retailerName,
            retailerId: cheapest.retailerId,
            url: cheapest.url,
          });
        }
      }

      const fallbackRetailers = [
        ...new Set(
          fallbackBreakdown
            .filter(b => b.retailerName && b.retailerName !== 'Not tracked yet')
            .map(b => b.retailerName),
        ),
      ];

      finishRender(
        [
          {
            retailers:
              fallbackRetailers.length > 0
                ? fallbackRetailers
                : ['Best available prices'],
            total: fallbackTotal,
            productsTotal: fallbackTotal,
            deliveryCost: 0,
            breakdown: fallbackBreakdown,
            type: fallbackRetailers.length === 1 ? 'single' : 'split',
            partial: true,
          },
        ],
        worstSingleShopTotal,
        trigger,
        current.length,
      );
      return;
    }

    finishRender(allOptions, worstSingleShopTotal, trigger, current.length);
  }, []);

  const finishRender = (
    options: BasketOption[],
    worstSingleShopTotal: number,
    trigger: 'user_action' | 'auto_shared_link',
    basketSize: number,
  ) => {
    let saving = 0;
    let suspect = false;

    // NEXT-BEST ANCHOR. Was `worstSingleShopTotal - options[0].total` -- the whole
    // basket at the single MOST EXPENSIVE retailer that stocks everything. That is a
    // basket nobody would assemble, and it produced a GBP 19.63 headline on a GBP
    // 30.37 recommendation where the real gap to the next viable basket was GBP 1.85.
    //
    // The honest quantity is what the recommendation saves against the NEXT BEST
    // thing the visitor could actually have chosen. options is sorted ascending by
    // delivered total, so options[1] IS that next best. Work-list item 245.
    //
    // Expect this to reduce the headline substantially on most baskets. That is the
    // point: it is what the optimiser is worth, and it is better known than hidden.
    if (options.length >= 2) {
      saving = Math.max(0, options[1].total - options[0].total);
    }

    if (options[0]?.breakdown) {
      const productPriceMap: Record<number, number[]> = {};
      for (const opt of options) {
        for (const item of opt.breakdown || []) {
          if (item.product && item.price !== null && item.price !== undefined) {
            const pid = item.product.id;
            if (!productPriceMap[pid]) productPriceMap[pid] = [];
            productPriceMap[pid].push(item.price);
          }
        }
      }
      for (const pid in productPriceMap) {
        const ps = productPriceMap[pid];
        if (ps.length >= 2) {
          const min = Math.min(...ps);
          const max = Math.max(...ps);
          if (min > 0 && max / min > 2.5) {
            suspect = true;
            break;
          }
        }
      }
    }

    // NO FLOOR BEYOND A GENUINE ZERO. The old `saving > 0.01` floor was written for
    // a worst-case anchor, where a sub-penny figure meant the optimiser had found
    // nothing. Under a next-best anchor a small number is the ANSWER, not noise:
    // suppressing it would mean the feature only speaks when the result flatters it.
    // A GBP 1.85 saving stated plainly is the honest figure.
    //
    // The `suspect` guard is NOT a floor and is kept unchanged -- it fires on a
    // price spread wide enough to indicate a data defect rather than a bargain, and
    // that is a correctness guard, not a presentation one.
    //
    // Rounds to two decimals before testing, so a float residue of 0.004 reads as
    // the genuine zero it is rather than as a saving that renders "GBP 0.00".
    const roundedSaving = Math.round(saving * 100) / 100;
    const suppressed = !(roundedSaving > 0 && !suspect);

    setSavings(roundedSaving);
    setShowSavings(!suppressed);
    setShowSaveCard(true);
    setResults(options);
    // Snapshot the basket size for every optimiser-basket event tied to THESE
    // results, so a later routine edit (which leaves stale results on screen) can't
    // make the Shop/open-all/modal clicks report a different count than the
    // basket_optimised event that produced them. Verified equal to
    // winning.breakdown.length in all paths; basketSize is current.length at run time.
    setOptimisedItemCount(basketSize);

    // basket_optimised — fired here (once per optimisation run) rather than in the
    // results render, which re-runs on every state change. winning_retailer_count
    // counts distinct real retailers (the "Not tracked yet" fallback row is not a
    // retailer), which also decides single vs split. NOTE for the dashboard:
    // result_type is derived from that untracked-excluding count, so treat it as
    // UNRELIABLE whenever unpriced_item_count > 0 (a basket with untracked items may
    // report "single" while really only one retailer's worth of items was priceable).
    // savings_value is the raw computed saving, reported even when suppressed.
    const winning = options[0];
    if (winning) {
      const pricedRetailers = new Set(
        winning.breakdown
          .filter(b => b.retailerName && b.retailerName !== 'Not tracked yet')
          .map(b => b.retailerName),
      );
      trackBasketOptimised({
        basketItemCount: basketSize,
        winningRetailerCount: pricedRetailers.size,
        resultType: pricedRetailers.size <= 1 ? 'single' : 'split',
        unpricedItemCount: winning.breakdown.filter(b => b.price == null).length,
        winningBasketTotal: winning.total,
        savingsValue: saving,
        savingsSuppressed: suppressed,
        optimisationTrigger: trigger,
      });
    }
  };

  // ── THE WAY OUT OF A COLLISION ────────────────────────────────────────

  // Clear the merged basket and repopulate from the link alone, so the visitor
  // ends up with exactly the routine the pin promised. Deliberately NOT a clear to
  // empty: that leaves them with nothing and sends them back to the pin. Uses the
  // items already resolved by the preload rather than re-querying, so this cannot
  // fail differently from the arrival that produced it.
  //
  // clearRoutine writes storage AND dispatches fmb_routine_change, which the store
  // subscription turns into setRoutine, so component state follows on its own. The
  // explicit setRoutine below is belt-and-braces consistent with every other call
  // site. resetResults is the part that is NOT automatic: clearRoutine knows
  // nothing about the optimiser, so without it the merged basket's results stay on
  // screen underneath the corrected routine.
  const startFresh = useCallback(() => {
    storeClear();
    for (const it of preloadItems.current) storeAdd(it);
    setRoutine(getRoutine());
    setPreloadAddedCount(0);
    // The arrival was still a collision — this records that the visitor resolved
    // it, rather than relabelling the session 'clean'. Clicks after this point
    // carry _preload_merged_cleared, which keeps the clean bucket uncontaminated
    // and makes the take-up of this link measurable, which is the only way to know
    // whether shipping it was worth it. preloadMissing is left alone: products the
    // link could not resolve are still unresolved.
    setPreloadCase('merged_cleared');
    resetResults();
    // No setTimeout: runOptimiser reads getRoutine() directly, not React state, and
    // the writes above are synchronous. The preload path's 300ms delay exists for
    // the gtag hydration race on a cold load, which this click is well past.
    runOptimiser('auto_shared_link');
  }, [resetResults, runOptimiser]);

  // ── SAVE ROUTINE ──────────────────────────────────────────────────────

  const saveRoutine = async () => {
    if (routine.length === 0) {
      setSaveError('Add some products to your routine first.');
      setSaveStatus('error');
      return;
    }

    // Signed-in path: track every product on the account (fmb_track_product is
    // idempotent — ON CONFLICT DO NOTHING — so re-saving never clobbers an
    // existing row's slot/note or baseline). The category seeds the slot.
    if (authedEmail) {
      setSaveStatus('saving');
      setSaveError(null);
      try {
        for (const item of routine) {
          const { error } = await db.rpc('fmb_track_product', {
            p_product_id: item.id,
            p_slot: item.category || null,
          });
          if (error) throw error;
        }
        setSaveStatus('success');
        if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
          (window as any).gtag('event', 'save_routine', {
            routine_size: routine.length,
            method: 'account',
          });
        }
      } catch (err) {
        console.error('Track routine error:', err);
        setSaveError('Something went wrong. Please try again.');
        setSaveStatus('error');
      }
      return;
    }

    // Legacy email path — stays live until the account cutover completes.
    const email = saveEmail.trim().toLowerCase();
    if (!email || !email.includes('@') || !email.includes('.')) {
      setSaveError('Please enter a valid email address.');
      setSaveStatus('error');
      return;
    }

    setSaveStatus('saving');
    setSaveError(null);

    const productIds = routine.map(p => p.id);

    try {
      // Save via the fmb_save_routine RPC (SECURITY DEFINER) rather than writing
      // saved_routines directly. An upsert-by-email must read the conflicting
      // row, which for an anon client would require a SELECT policy that exposes
      // every stored email/routine; the RPC keeps the table locked while doing
      // the upsert server-side. It returns the saved row id — a null id (or a
      // thrown error) means the save did NOT persist, so we never show success
      // without a real id. (The old code inferred success from the mere absence
      // of an error, which is how a silently-filtered 0-row write reported
      // "Saved ✓" while nothing landed.)
      const { data: savedId, error } = await db.rpc('fmb_save_routine', {
        p_email: email,
        p_routine: productIds,
      });

      if (error) throw error;
      if (savedId == null) {
        throw new Error('Save did not return a routine id — nothing persisted');
      }

      setSaveStatus('success');
      setEmailDisabled(true);

      if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
        (window as any).gtag('event', 'save_routine', {
          routine_size: productIds.length,
          method: 'email',
        });
      }
    } catch (err) {
      console.error('Save routine error:', err);
      setSaveError('Something went wrong. Please try again.');
      setSaveStatus('error');
    }
  };

  // ── OPEN ALL PRODUCTS (popup-blocker fallback) ────────────────────────

  const openAllProducts = (
    products: {
      name: string;
      url: string;
      retailer: string;
      retailerId?: number;
      price: number | null;
      productId: number;
    }[],
  ) => {
    if (!products || products.length === 0) return;

    const blocked: typeof products = [];
    products.forEach((p, i) => {
      const win = window.open(directDestinationUrl(p.url), '_blank', 'noopener,noreferrer');
      if (!win || win.closed || typeof win.closed === 'undefined') {
        blocked.push(p);
        return;
      }
      // Fire a retailer_click per product that actually opened. These come from the
      // best-value basket, so is_best_value is always true here; value is the single
      // item's price (the amount attributable to this click, never the basket total).
      trackAffiliateClickOut(p.retailer, p.productId);
      trackRetailerClick({
        retailerId: p.retailerId,
        retailerName: p.retailer,
        affiliateNetwork: affiliateNetworkFromUrl(p.url),
        itemId: p.productId,
        value: p.price ?? undefined,
        basketItemCount: optimisedItemCount ?? routine.length,
        isBestValue: true,
        listPosition: i,
        clickSource: clickSourceFor('optimiser_open_all'),
      });
      // Same server-side log the anchor-based surfaces get, so these high-intent
      // clicks are not GA4-only. window.open() is programmatic so there is no
      // ClickOutLink anchor to carry it — the beacon is sent explicitly here.
      sendOutboundBeacon({
        productId: p.productId,
        retailerId: p.retailerId,
        awinMid: awinMidFromHref(p.url),
        price: p.price,
        source: clickSourceFor('optimiser_open_all'),
      });
    });

    if (blocked.length > 0) setBlockedLinks(blocked);

    if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
      (window as any).gtag('event', 'open_all_products', {
        product_count: products.length,
        blocked_count: blocked.length,
      });
    }
  };

  // ── DERIVED ───────────────────────────────────────────────────────────

  // Distinct REAL retailers in the winning basket. Counted off the breakdown and
  // excluding the "Not tracked yet" row, matching how winningRetailerCount is
  // derived for basket_optimised — the two must not be able to disagree. Reading
  // option.retailers instead would be wrong: on the partial fallback it can hold
  // the sentinel 'Best available prices', which is not a retailer.
  const winningRetailerCount =
    results && results.length > 0
      ? new Set(
          results[0].breakdown
            .filter(b => b.retailerName && b.retailerName !== 'Not tracked yet')
            .map(b => b.retailerName),
        ).size
      : 0;

  // ── RENDER ────────────────────────────────────────────────────────────

  return (
    <main className="routine-builder-scope">
      <div className="rb-page">
        <header className="rb-header">
          <h1 className="rb-title">
            Your <em>routine</em>
          </h1>
          <p className="rb-sub">
            Review your routine and we&apos;ll find the best value way to buy everything,
            in as few orders as possible.
          </p>
        </header>

        {/* Routine list — or empty state */}
        {!hydrated || preload === 'pending' ? (
          <div className="rb-loading">Loading your routine...</div>
        ) : preload === 'failed' ? (
          // Explicit failure, never the bare empty state. A visitor who followed a
          // routine link and is shown "your routine is empty" has been told
          // something false about their own link; this says what happened and
          // leaves a way forward.
          <div className="rb-empty">
            <div className="rb-empty-icon">🧺</div>
            <h2 className="rb-empty-title">We couldn&apos;t load that routine</h2>
            <p className="rb-empty-desc">
              This link may be out of date. You can still browse the catalogue and
              build a routine, and we&apos;ll find the best value way to buy it.
            </p>
            <div className="rb-browse-grid">
              <Link href="/skincare" className="rb-browse-card">
                <span className="rb-browse-icon">🧴</span>
                <span className="rb-browse-label">Browse skincare</span>
                <span className="rb-browse-arrow">→</span>
              </Link>
              <Link href="/makeup" className="rb-browse-card">
                <span className="rb-browse-icon">💄</span>
                <span className="rb-browse-label">Browse makeup</span>
                <span className="rb-browse-arrow">→</span>
              </Link>
              <Link href="/hair" className="rb-browse-card">
                <span className="rb-browse-icon">💇</span>
                <span className="rb-browse-label">Browse hair</span>
                <span className="rb-browse-arrow">→</span>
              </Link>
            </div>
          </div>
        ) : routine.length === 0 ? (
          <div className="rb-empty">
            <div className="rb-empty-icon">🧴</div>
            <h2 className="rb-empty-title">Your routine is empty</h2>
            <p className="rb-empty-desc">
              Browse the catalogue to add products and we&apos;ll find the best value
              way to buy them across UK retailers.
            </p>
            <div className="rb-browse-grid">
              <Link href="/skincare" className="rb-browse-card">
                <span className="rb-browse-icon">🧴</span>
                <span className="rb-browse-label">Browse skincare</span>
                <span className="rb-browse-arrow">→</span>
              </Link>
              <Link href="/makeup" className="rb-browse-card">
                <span className="rb-browse-icon">💄</span>
                <span className="rb-browse-label">Browse makeup</span>
                <span className="rb-browse-arrow">→</span>
              </Link>
              <Link href="/hair" className="rb-browse-card">
                <span className="rb-browse-icon">💇</span>
                <span className="rb-browse-label">Browse hair</span>
                <span className="rb-browse-arrow">→</span>
              </Link>
            </div>
          </div>
        ) : (
          <div className="rb-layout">
            {/* LEFT column: the routine itself. Sticky on desktop so it stays
                in view while the actions and results scroll on the right.
                Collapses into the single mobile stack below the breakpoint. */}
            <div className="rb-col-left">
            <div className="rb-routine-section">
              <div className="rb-routine-header">
                <span className="rb-routine-label">Your routine</span>
                <span className="rb-routine-count">
                  {routine.length} product{routine.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* A preload that landed on an existing basket says so and offers one tap
                  out of it. Merging stays the default — destroying a basket someone
                  built by hand is worse — so this states the fact and leaves the choice.
                  Same class and same plain-statement register as the
                  unresolvable-products line below, not a second pattern.

                  STATE-DERIVED, NOT ARRIVAL-DERIVED, and that is the fix. The first
                  version rendered on preloadCase === 'merged', which is a fact about the
                  ARRIVAL. The merged basket is persistent but the arrival happens once,
                  so a reload re-entered as self_reload, suppressed the notice, and left
                  the visitor looking at seven products with no explanation and no way
                  out — reached by doing the most ordinary thing a confused person does.
                  Reproduced on production 5 August 2026.

                  preloadExtras is computed from the routine as it stands, so the line
                  survives reloads for exactly as long as the basket holds something the
                  link did not bring, and clears itself the moment it does not. */}
              {preloadExtras > 0 && (
                <p className="rb-routine-missing">
                  {preloadAddedCount > 0
                    ? (preloadAddedCount === 1
                        ? 'Added one product to your existing routine.'
                        : `Added ${preloadAddedCount} products to your existing routine.`)
                    : `${routine.length === 1 ? 'Your routine has 1 product.' : `Your routine has ${routine.length} products.`} ${
                        preloadExtras === 1
                          ? 'One was not from this link.'
                          : `${preloadExtras} were not from this link.`
                      }`}{' '}
                  <button type="button" className="rb-routine-reset" onClick={startFresh}>
                    Clear it and start fresh
                  </button>
                </p>
              )}

              {/* A preloaded routine that arrived short says so. Without this the
                  link silently delivers fewer products than it promised, which is
                  indistinguishable from having promised fewer. Plain statement, no
                  apology, no cause: the visitor can act on neither. */}
              {preloadMissing > 0 && (
                <p className="rb-routine-missing">
                  {preloadMissing === 1
                    ? 'One product from this routine is no longer available.'
                    : `${preloadMissing} products from this routine are no longer available.`}
                </p>
              )}

              <div className="rb-routine-list">
                {routine.map((p, i) => (
                  <div key={p.id} className="rb-routine-item">
                    <div className="rb-routine-dot">
                      {ROUTINE_EMOJIS[i % ROUTINE_EMOJIS.length]}
                    </div>
                    <div className="rb-routine-info">
                      <div className="rb-routine-name">{p.name}</div>
                      <div className="rb-routine-brand">{p.brand}</div>
                      {/* LEAK LINKS REMOVED. Every routine row carried "Also check
                          Amazon" and an eBay link -- inside the one flow that uses the
                          differentiating feature, next to a recommendation the optimiser
                          had just computed. Two exits from the funnel the builder exists
                          to complete, on every line.

                          Amazon stays on PRODUCT pages, outside the ranking and already
                          labelled as an unranked cross-check. eBay is removed everywhere:
                          it was never ranked, never priced, and only ever a search link.
                          Work-list item 245, phase 0.3. */}
                    </div>
                    <button
                      className="rb-remove-btn"
                      onClick={() => handleRemove(p.id)}
                      aria-label={`Remove ${p.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <div className="rb-add-more">
                Add more from{' '}
                <Link href="/skincare">skincare</Link> ·{' '}
                <Link href="/makeup">makeup</Link> ·{' '}
                <Link href="/hair">hair</Link>
              </div>
            </div>
            </div>

            {/* RIGHT column: primary action, then savings, results and the
                email capture, in source order. On mobile this stacks straight
                after the routine list. */}
            <div className="rb-col-right">
            <button
              className={`rb-optimise-btn ${isOptimising ? 'loading' : ''}`}
              disabled={routine.length === 0 || isOptimising}
              onClick={() => runOptimiser('user_action')}
            >
              <span>🛒</span>
              <span>{isOptimising ? 'Finding best prices...' : 'Find my basket'}</span>
            </button>

            {/* Savings summary */}
            {showSavings && (
              <div className="rb-savings-summary">
                <div className="rb-savings-label">YOU COULD SAVE</div>
                <div className="rb-savings-amount">£{savings.toFixed(2)}</div>
                {/* Names the actual comparison. The previous copy said "versus buying
                    the whole basket at the most expensive single shop", which was an
                    accurate description of a baseline nobody would choose. Item 245. */}
                <div className="rb-savings-desc">
                  versus the next-best way to buy this basket, delivery included. Checkout prices may
                  be lower with active sales or member discounts.
                </div>
              </div>
            )}

            {/* Suppressed savings figure. The guard that suppresses it is correct
                and unchanged, but it fires on the widest price spreads, which are
                the baskets where the optimiser did the most work. Saying nothing
                there leaves a visitor looking at a split basket with no account of
                why it is split.

                States what the optimiser DID, never what it is worth: no prices,
                no percentages, no retailer names, no comparison. The retailer
                count is the only quantity and it describes the basket rather than
                asserting anything about price. */}
            {/* A GENUINE ZERO IS A RESULT AND IS SAID PLAINLY. Three distinct
                states reach here and they are not the same finding:

                  one viable option   -- nothing to compare against. Saying "no
                                         saving" would imply a comparison was made.
                  next best is equal  -- a comparison WAS made and came out level.
                  suspect spread      -- the correctness guard fired; no figure is
                                         claimed at all, unchanged behaviour.

                Collapsing these into one sentence is what made the old copy read as
                an apology. Each states what the optimiser found. Item 245. */}
            {!showSavings && winningRetailerCount > 0 && (
              <div className="rb-savings-summary rb-savings-qualitative">
                <div className="rb-savings-desc">
                  {results && results.length === 1
                    ? (winningRetailerCount > 1
                        ? `One way to buy this basket, split across ${winningRetailerCount} retailers, delivery included.`
                        : 'One retailer stocks everything in this basket, delivery included.')
                    : winningRetailerCount > 1
                      ? `Your basket is split across ${winningRetailerCount} retailers for the best total, delivery included. The next-best way to buy it costs the same.`
                      : 'Everything in your basket is best value at one retailer, delivery included. The next-best way to buy it costs the same.'}
                </div>
              </div>
            )}

            {/* Error / placeholder / results */}
            {errorMsg ? (
              <div className="rb-results-placeholder">
                <div className="rb-results-icon">⚠️</div>
                <p>{errorMsg}</p>
              </div>
            ) : !results ? null : (
              <div className="rb-results">
                {results.map((opt, i) => {
                  const isBest = i === 0;
                  // Was `worstViableTotal - opt.total` -- how much CHEAPER this
                  // option is than the WORST one -- rendered with the word "more".
                  // The variable name stated the referent and the label stated its
                  // opposite, so a GBP 1.85 difference from the recommendation
                  // rendered as "GBP 23.11 more". Referent and direction both wrong.
                  // Item 245.
                  const moreThanBest = opt.total - results[0].total;
                  const distinctRetailerCount = new Set(
                    opt.breakdown
                      .filter(b => b.retailerName && b.retailerName !== 'Not tracked yet')
                      .map(b => b.retailerName),
                  ).size;
                  const descText =
                    opt.type === 'single' || distinctRetailerCount === 1
                      ? 'Shop everything from one retailer'
                      : `Split across ${distinctRetailerCount} retailers for best price`;

                  // Per-retailer aggregation for the "Shop {retailer}" buttons:
                  // first deep-link plus the subtotal of this basket's items at
                  // that retailer. The subtotal is the amount attributable to a
                  // click on that retailer's button (never the whole-basket total).
                  // Extracted to lib/basket-attribution so the value semantics are
                  // unit-tested against silent regression.
                  const retailerAgg = retailerSubtotals(opt.breakdown);
                  const productLinks = opt.breakdown
                    .filter(b => b.url)
                    .map(b => ({
                      name: `${b.product.brand} ${b.product.name}`,
                      url: b.url,
                      retailer: b.retailerName,
                      retailerId: b.retailerId,
                      price: b.price,
                      productId: b.product.id,
                    }));

                  return (
                    <div key={i} className={`rb-basket-card ${isBest ? 'best' : ''}`}>
                      <div className="rb-basket-retailers">{opt.retailers.join(' + ')}</div>
                      <div className="rb-basket-desc">{descText}</div>
                      <div className="rb-basket-price-row">
                        <div className="rb-basket-total">£{opt.total.toFixed(2)}</div>
                        {!isBest && moreThanBest > 0.004 && (
                          <div className="rb-basket-saving">
                            £{moreThanBest.toFixed(2)} more
                          </div>
                        )}
                      </div>
                      {isBest && (
                        <div className="rb-basket-checkout-note">
                          Final checkout price may be lower with active sales or member discounts.
                        </div>
                      )}
                      <div className="rb-basket-breakdown">
                        {opt.breakdown.map((b, bi) => (
                          <div key={bi} className="rb-breakdown-item">
                            <span className="rb-breakdown-product">{b.product.name}</span>
                            <div className="rb-breakdown-retailer-price">
                              <span className="rb-breakdown-retailer">{b.retailerName}</span>
                              <span className="rb-breakdown-price">
                                {b.price !== null ? `£${b.price.toFixed(2)}` : '–'}
                              </span>
                            </div>
                          </div>
                        ))}
                        <div className="rb-delivery-row">
                          <span>Delivery</span>
                          {opt.deliveryCost === null ? (
                            <span>Delivery not known</span>
                          ) : opt.deliveryCost === 0 ? (
                            <span className="rb-delivery-free">Free delivery</span>
                          ) : (
                            <span>£{opt.deliveryCost.toFixed(2)}</span>
                          )}
                        </div>
                      </div>
                      {isBest && (
                        <div className="rb-shop-actions">
                          {productLinks.length > 1 && (
                            <button
                              className="rb-shop-all-btn"
                              onClick={() => openAllProducts(productLinks)}
                            >
                              Open all {productLinks.length} products →
                            </button>
                          )}
                          {Object.entries(retailerAgg).length > 0 ? (
                            Object.entries(retailerAgg).map(([name, info], ri) => (
                              // Full ClickOutLink so the highest-intent click on the
                              // site also lands in the (non-consent-gated, more
                              // complete) outbound_clicks pipeline, not GA4 alone.
                              // `value` is this retailer's subtotal, not the basket
                              // total. ClickOutLink unwraps the href for navigation
                              // and reads the original for network attribution.
                              <ClickOutLink
                                key={name}
                                href={info.url}
                                retailer={name}
                                retailerId={info.retailerId}
                                price={info.subtotal}
                                source={clickSourceFor('optimiser_shop_button')}
                                clickSource={clickSourceFor('optimiser_shop_button')}
                                isBestValue={isBest}
                                listPosition={ri}
                                basketItemCount={optimisedItemCount ?? routine.length}
                                rel="noopener noreferrer"
                                className="rb-shop-retailer-btn"
                              >
                                Shop {name} →
                              </ClickOutLink>
                            ))
                          ) : (
                            <a href="/index.html#waitlist" className="rb-shop-btn">
                              Join waitlist to shop →
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* SAVE PROMPT SITS BELOW THE RESULT CARDS. It previously sat ABOVE
                them, between the savings figure and the options, on the reasoning
                that the email capture should appear "at the most engaged moment".
                That put a commitment ask in front of the answer the visitor came
                for: the cards ARE the value, and asking to save a result before
                showing it inverts the exchange.

                Value first, then commitment, then the disclosure. Item 245,
                phase 0.5. */}
            {showSaveCard && (
              <div className="rb-save-card">
                <div className="rb-save-title">Save your routine ✨</div>
                <p className="rb-save-desc">
                  {authedEmail
                    ? `Save these products to your account (${authedEmail}) and we'll track their prices for you.`
                    : 'Create a free account to edit your routine anytime and get price-drop alerts. Just your email, no password needed.'}
                </p>
                {/* Account is the primary action; the email-only save below is
                    the quieter legacy fallback we're retiring. */}
                {!authedEmail && (
                  <>
                    <a href="/account" className="rb-save-btn rb-save-account-cta">
                      Create a free account
                    </a>
                    <p className="rb-save-alt-lead">
                      Or skip the account and we&apos;ll email you this
                      routine&apos;s best prices each month:
                    </p>
                  </>
                )}
                <div className="rb-save-form">
                  {!authedEmail && (
                    <input
                      type="email"
                      className="rb-save-input"
                      placeholder="your@email.com"
                      value={saveEmail}
                      disabled={emailDisabled}
                      onChange={e => setSaveEmail(e.target.value)}
                    />
                  )}
                  <button
                    className={`rb-save-btn ${authedEmail ? '' : 'rb-save-btn-quiet'}`}
                    onClick={saveRoutine}
                    disabled={
                      saveStatus === 'saving' ||
                      saveStatus === 'success'
                    }
                  >
                    {saveStatus === 'saving'
                      ? 'Saving...'
                      : saveStatus === 'success'
                      ? 'Saved ✓'
                      : authedEmail
                      ? 'Save to my account'
                      : 'Email me instead'}
                  </button>
                </div>
                {saveStatus === 'success' && (
                  <p className="rb-save-success">
                    {authedEmail ? (
                      <>
                        ✓ Saved to your account.{' '}
                        <a href="/account">Manage your routine</a>
                      </>
                    ) : (
                      <>✓ Saved. We&apos;ll email you with this month&apos;s best prices.</>
                    )}
                  </p>
                )}
                {saveStatus === 'error' && (
                  <p className="rb-save-error">
                    {saveError || 'Something went wrong. Please try again.'}
                  </p>
                )}
                {!authedEmail && (
                  <p className="rb-save-fineprint">
                    Unsubscribe link in every email.{' '}
                    <a href="/account">Have an account? Sign in</a>
                  </p>
                )}
              </div>
            )}


            {/* DISCLOSURE LAST. It was the first child of the results block, above
                the cards. It is a legal/truststatement about how the links are
                monetised, not a piece of the answer, and putting it first delayed
                the result to make a declaration nobody arrived for. Below the cards
                and below the save prompt it is still on the screen, still before any
                outbound click, and no longer standing in front of the value.
                Item 245, phase 0.5. */}
            {results && results.length > 0 && (
              <div className="rb-results-disclosure">
                <AffiliateDisclosure variant="banner" />
              </div>
            )}

            {/* The per-item "Also check Amazon / eBay" links this note described were
                REMOVED in phase 0.3. Note kept, corrected, rather than deleted: it is
                the only record in this file that they were once here and deliberately
                placed, so a future reader does not re-add them as an improvement. */}
            </div>
          </div>
        )}
      </div>

      {/* Popup-blocked links modal */}
      {blockedLinks && (
        <div
          className="rb-modal-overlay"
          onClick={e => {
            if (e.target === e.currentTarget) setBlockedLinks(null);
          }}
        >
          <div className="rb-modal-dialog">
            <h3 className="rb-modal-title">Open your products</h3>
            <p className="rb-modal-subtitle">
              Your browser blocked some of the popups. Click each link below to open it
              in a new tab.
            </p>
            <div className="rb-modal-list">
              {blockedLinks.map((p, i) => (
                // The retailer_click (and server beacon) that would have fired when
                // the tab was blocked. Same best-value basket context as openAllProducts.
                <ClickOutLink
                  key={i}
                  href={p.url}
                  retailer={p.retailer}
                  retailerId={p.retailerId}
                  productId={p.productId}
                  price={p.price ?? undefined}
                  source={clickSourceFor('optimiser_modal')}
                  clickSource={clickSourceFor('optimiser_modal')}
                  isBestValue
                  listPosition={i}
                  basketItemCount={optimisedItemCount ?? routine.length}
                  rel="noopener noreferrer"
                  className="rb-modal-link"
                >
                  {p.name} → {p.retailer}
                </ClickOutLink>
              ))}
            </div>
            <button
              onClick={() => setBlockedLinks(null)}
              className="rb-modal-close"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
