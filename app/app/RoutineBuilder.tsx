'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { supabaseBrowser as db } from '@/lib/supabase-browser';
import { AffiliateDisclosure } from '@/components/AffiliateDisclosure';
import {
  getRoutine,
  addToRoutine as storeAdd,
  removeFromRoutine as storeRemove,
  onRoutineChange,
  type RoutineItem,
} from '@/lib/routine-store';
import { displayProductTitle } from '@/lib/format/product-name';
import { trackAffiliateClickOut, trackRetailerClick, affiliateNetworkFromUrl } from '@/lib/analytics';

// Affiliate tags — reused exactly from the previous bottom-of-basket links.
const AMAZON_TAG = 'findmybasket-21';

function amazonSearchUrl(p: RoutineItem): string {
  const q = encodeURIComponent(displayProductTitle(p.name, p.brand).replace(/\s+/g, ' ').trim());
  return `https://www.amazon.co.uk/s?k=${q}&tag=${AMAZON_TAG}`;
}

function ebaySearchUrl(p: RoutineItem): string {
  const q = encodeURIComponent(displayProductTitle(p.name, p.brand).replace(/\s+/g, ' ').trim());
  return `https://www.ebay.co.uk/sch/i.html?_nkw=${q}&_sacat=26396&mkrid=710-53481-19255-0&campid=7221119&customid=findmybasket&toolid=10001`;
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
  url: string;
}

interface BasketOption {
  retailers: string[];
  total: number;
  productsTotal: number;
  deliveryCost: number;
  breakdown: BreakdownItem[];
  type: 'single' | 'split';
  partial?: boolean;
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

  // Save routine state
  const [saveEmail, setSaveEmail] = useState('');
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'success' | 'error'
  >('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [emailDisabled, setEmailDisabled] = useState(false);

  // Modal for popup-blocked product links
  const [blockedLinks, setBlockedLinks] = useState<
    { name: string; url: string; retailer: string }[] | null
  >(null);

  // ── ROUTINE STORE SYNC ────────────────────────────────────────────────

  useEffect(() => {
    setRoutine(getRoutine());
    setHydrated(true);
    const unsub = onRoutineChange(() => setRoutine(getRoutine()));
    return unsub;
  }, []);

  // ── URL PARAM PRELOAD ─────────────────────────────────────────────────
  // Saved-routine emails link to /app?routine=1,2,3 — preserve that behaviour.

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ids = params.get('routine');
    if (!ids) return;

    const productIds = ids
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n));
    if (productIds.length === 0) return;

    let cancelled = false;
    (async () => {
      const { data, error } = await db
        .from('products_active')
        .select('id, name, brand, product_type')
        .in('id', productIds);

      if (cancelled || error || !data) return;

      const items: RoutineItem[] = data.map(p => ({
        id: p.id,
        name: p.name,
        brand: p.brand || '',
        category: p.product_type || '',
      }));

      for (const it of items) storeAdd(it);
      setRoutine(getRoutine());

      if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
        (window as any).gtag('event', 'load_routine_from_url', {
          routine_size: items.length,
          source: 'email',
        });
      }

      // Auto-run the optimiser so users see savings immediately
      setTimeout(() => runOptimiser(), 300);
    })();

    return () => {
      cancelled = true;
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
  }, []);

  const runOptimiser = useCallback(async () => {
    const current = getRoutine();
    if (current.length === 0) return;

    setIsOptimising(true);
    setErrorMsg(null);

    const productIds = current.map(p => p.id);

    const { data: pricesRaw } = await db
      .from('retailer_prices')
      .select('*, retailers(*)')
      .in('product_id', productIds)
      .eq('in_stock', true);

    // Stylevana de-rank: hide Stylevana for any product with a UK alternative
    const prices: PriceRow[] | null = (() => {
      if (!pricesRaw) return null;
      const byProduct: Record<number, PriceRow[]> = {};
      for (const row of pricesRaw as any[]) {
        if (!byProduct[row.product_id]) byProduct[row.product_id] = [];
        byProduct[row.product_id].push(row as PriceRow);
      }
      const out: PriceRow[] = [];
      for (const pid in byProduct) {
        const rows = byProduct[pid];
        const hasNonStylevana = rows.some(
          r => r.retailers && r.retailers.name !== 'Stylevana',
        );
        for (const r of rows) {
          const isStylevana = r.retailers && r.retailers.name === 'Stylevana';
          if (!isStylevana || !hasNonStylevana) out.push(r);
        }
      }
      return out;
    })();

    setIsOptimising(false);

    if (!prices || prices.length === 0) {
      setErrorMsg('No price data found. Please try again later.');
      return;
    }

    type PriceEntry = {
      price: number;
      url: string;
      retailerName: string;
      deliveryThreshold: number;
      deliveryCost: number;
    };
    const priceMap: Record<number, Record<number, PriceEntry>> = {};
    for (const row of prices) {
      if (!priceMap[row.product_id]) priceMap[row.product_id] = {};
      priceMap[row.product_id][row.retailer_id] = {
        price: parseFloat(String(row.price)),
        url: row.url,
        retailerName: row.retailers.name,
        deliveryThreshold: parseFloat(String(row.retailers.delivery_threshold ?? '25')),
        deliveryCost: parseFloat(String(row.retailers.delivery_cost ?? '3.95')),
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
            url: pp.url,
          });
        }
      }

      if (covered === current.length) {
        const rInfo = prices.find(p => p.retailer_id === rid)?.retailers;
        const threshold = parseFloat(String(rInfo?.delivery_threshold ?? '25'));
        const dCost = parseFloat(String(rInfo?.delivery_cost ?? '3.95'));
        const deliveryCost = total >= threshold ? 0 : dCost;
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
              url: p2.url,
            });
          }
        }

        if (!allCovered) continue;

        const r1Threshold = parseFloat(String(r1Info?.delivery_threshold ?? '25'));
        const r1DCost = parseFloat(String(r1Info?.delivery_cost ?? '3.95'));
        const r2Threshold = parseFloat(String(r2Info?.delivery_threshold ?? '25'));
        const r2DCost = parseFloat(String(r2Info?.delivery_cost ?? '3.95'));
        const d1 = r1Total > 0 ? (r1Total >= r1Threshold ? 0 : r1DCost) : 0;
        const d2 = r2Total > 0 ? (r2Total >= r2Threshold ? 0 : r2DCost) : 0;

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
      );
      return;
    }

    finishRender(allOptions, worstSingleShopTotal);
  }, []);

  const finishRender = (options: BasketOption[], worstSingleShopTotal: number) => {
    let saving = 0;
    let suspect = false;

    if (options.length >= 1 && worstSingleShopTotal > options[0].total) {
      saving = worstSingleShopTotal - options[0].total;
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

    setSavings(saving);
    setShowSavings(saving > 0.01 && !suspect);
    setShowSaveCard(true);
    setResults(options);
  };

  // ── SAVE ROUTINE ──────────────────────────────────────────────────────

  const saveRoutine = async () => {
    const email = saveEmail.trim().toLowerCase();
    if (!email || !email.includes('@') || !email.includes('.')) {
      setSaveError('Please enter a valid email address.');
      setSaveStatus('error');
      return;
    }
    if (routine.length === 0) {
      setSaveError('Add some products to your routine first.');
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
    products: { name: string; url: string; retailer: string }[],
  ) => {
    if (!products || products.length === 0) return;

    const blocked: typeof products = [];
    products.forEach(p => {
      const win = window.open(p.url, '_blank', 'noopener,noreferrer');
      if (!win || win.closed || typeof win.closed === 'undefined') {
        blocked.push(p);
      }
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

  const worstViableTotal =
    results && results.length > 0 ? Math.max(...results.map(o => o.total)) : 0;

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
        {!hydrated ? (
          <div className="rb-loading">Loading your routine...</div>
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

              <div className="rb-routine-list">
                {routine.map((p, i) => (
                  <div key={p.id} className="rb-routine-item">
                    <div className="rb-routine-dot">
                      {ROUTINE_EMOJIS[i % ROUTINE_EMOJIS.length]}
                    </div>
                    <div className="rb-routine-info">
                      <div className="rb-routine-name">{p.name}</div>
                      <div className="rb-routine-brand">{p.brand}</div>
                      <div className="rb-routine-also">
                        <a
                          href={amazonSearchUrl(p)}
                          target="_blank"
                          rel="nofollow sponsored noopener"
                          onClick={() => {
                            trackAffiliateClickOut('amazon', p.id);
                            trackRetailerClick({
                              retailerName: 'amazon',
                              affiliateNetwork: affiliateNetworkFromUrl(amazonSearchUrl(p)),
                              productCount: routine.length,
                            });
                          }}
                        >
                          Also check Amazon ↗
                        </a>
                        <a
                          href={ebaySearchUrl(p)}
                          target="_blank"
                          rel="nofollow sponsored noopener"
                          onClick={() => {
                            trackAffiliateClickOut('ebay', p.id);
                            trackRetailerClick({
                              retailerName: 'ebay',
                              affiliateNetwork: affiliateNetworkFromUrl(ebaySearchUrl(p)),
                              productCount: routine.length,
                            });
                          }}
                        >
                          eBay ↗
                        </a>
                      </div>
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
              onClick={runOptimiser}
            >
              <span>🛒</span>
              <span>{isOptimising ? 'Finding best prices...' : 'Find my basket'}</span>
            </button>

            {/* Savings summary */}
            {showSavings && (
              <div className="rb-savings-summary">
                <div className="rb-savings-label">YOU COULD SAVE</div>
                <div className="rb-savings-amount">£{savings.toFixed(2)}</div>
                <div className="rb-savings-desc">
                  this basket at its best-value split across retailers, versus buying the whole basket
                  at the most expensive single shop. Checkout prices may be lower with active sales or
                  member discounts.
                </div>
              </div>
            )}

            {/* Save routine card — surfaced here, directly under the savings
                figure and above the basket options, so the email capture is
                visible at the most engaged moment rather than buried at the
                foot of a long results list. Email only, one action, shared
                store/logic unchanged. */}
            {showSaveCard && (
              <div className="rb-save-card">
                <div className="rb-save-title">Save your routine ✨</div>
                <p className="rb-save-desc">
                  Get the best prices for your routine emailed to you each month. Free,
                  and you can unsubscribe anytime.
                </p>
                <div className="rb-save-form">
                  <input
                    type="email"
                    className="rb-save-input"
                    placeholder="your@email.com"
                    value={saveEmail}
                    disabled={emailDisabled}
                    onChange={e => setSaveEmail(e.target.value)}
                  />
                  <button
                    className="rb-save-btn"
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
                      : 'Save routine'}
                  </button>
                </div>
                {saveStatus === 'success' && (
                  <p className="rb-save-success">
                    ✓ Saved. We&apos;ll email you with this month&apos;s best prices.
                  </p>
                )}
                {saveStatus === 'error' && (
                  <p className="rb-save-error">
                    {saveError || 'Something went wrong. Please try again.'}
                  </p>
                )}
                <p className="rb-save-fineprint">
                  No account needed. Unsubscribe link in every email.
                </p>
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
                <AffiliateDisclosure variant="banner" />
                {results.map((opt, i) => {
                  const isBest = i === 0;
                  const savingVsWorst = worstViableTotal - opt.total;
                  const distinctRetailerCount = new Set(
                    opt.breakdown
                      .filter(b => b.retailerName && b.retailerName !== 'Not tracked yet')
                      .map(b => b.retailerName),
                  ).size;
                  const descText =
                    opt.type === 'single' || distinctRetailerCount === 1
                      ? 'Shop everything from one retailer'
                      : `Split across ${distinctRetailerCount} retailers for best price`;

                  const retailerUrls: Record<string, string> = {};
                  opt.breakdown.forEach(b => {
                    if (b.url && !retailerUrls[b.retailerName]) {
                      retailerUrls[b.retailerName] = b.url;
                    }
                  });
                  const productLinks = opt.breakdown
                    .filter(b => b.url)
                    .map(b => ({
                      name: `${b.product.brand} ${b.product.name}`,
                      url: b.url,
                      retailer: b.retailerName,
                    }));

                  return (
                    <div key={i} className={`rb-basket-card ${isBest ? 'best' : ''}`}>
                      <div className="rb-basket-retailers">{opt.retailers.join(' + ')}</div>
                      <div className="rb-basket-desc">{descText}</div>
                      <div className="rb-basket-price-row">
                        <div className="rb-basket-total">£{opt.total.toFixed(2)}</div>
                        {!isBest && savingVsWorst > 0 && (
                          <div className="rb-basket-saving">
                            £{savingVsWorst.toFixed(2)} more
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
                          {opt.deliveryCost === 0 ? (
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
                          {Object.entries(retailerUrls).length > 0 ? (
                            Object.entries(retailerUrls).map(([name, url]) => (
                              <a
                                key={name}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rb-shop-retailer-btn"
                              >
                                Shop {name} →
                              </a>
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

            {/* Per-item "Also check Amazon / eBay" links now live inline with
                each routine item above (more discoverable, honest cross-check). */}
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
                <a
                  key={i}
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rb-modal-link"
                >
                  {p.name} → {p.retailer}
                </a>
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
