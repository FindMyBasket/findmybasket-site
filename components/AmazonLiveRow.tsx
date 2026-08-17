'use client';

import { useEffect, useState } from 'react';
import { AmazonLink } from './AmazonLink';

/**
 * The Amazon row on a product page. Fetches after hydration, renders FOUR STATES and never
 * nothing.
 *
 * ── THE VISIBLE-FAILURE CONSTRAINT IS THE DESIGN, NOT A NICETY ───────────────────────
 *
 * Item 22's finding: on a solo-retailer product Amazon IS the comparison, so a failed fetch
 * silently reverts the page to a single listing — the exact state the feature exists to fix
 * — and it fails by REVERTING rather than by erroring. Nothing surfaces the reversion; the
 * page simply looks like it did before.
 *
 * So this component has no path that renders nothing once it has started:
 *
 *   checking      "Checking Amazon…"
 *   ok            the price + "Sold by X · delivery not included"
 *   no_offers     "Amazon doesn't stock this"
 *   failure       "Couldn't reach Amazon"
 *
 * `no_offers` AND FAILURE ARE SEPARATE AND MUST STAY SEPARATE. A disappearing row is
 * indistinguishable from a product Amazon does not carry, and those are different facts.
 * The log keeps them apart for the same reason.
 *
 * The one state that renders nothing is `disabled`, and that is correct: the kill switch is
 * off, nothing was attempted, and claiming an outage would be untrue.
 *
 * NO RETRY. The client asks once. Retry logic on the client is a rate-limit amplifier with
 * a user watching it, and the server-side breaker exists precisely so that a refusal is
 * fast and honest rather than something to try again.
 */

type Offer = {
  asin: string;
  displayPrice: string;
  sellerName: string | null;
  inStock: boolean;
};

type State =
  | { kind: 'checking' }
  | { kind: 'ok'; offer: Offer }
  | { kind: 'no_offers' }
  | { kind: 'failed' }
  | { kind: 'disabled' };

export function AmazonLiveRow({
  asin,
  productId,
  fallbackHref,
  surface = 'product_page',
}: {
  asin: string;
  productId: number;
  fallbackHref: string;
  surface?: string;
}) {
  const [state, setState] = useState<State>({ kind: 'checking' });

  useEffect(() => {
    let live = true;
    fetch('/api/amazon/price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asins: [asin], surface }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { outcome: string; offers: Record<string, Offer> }) => {
        if (!live) return;
        if (data.outcome === 'disabled') return setState({ kind: 'disabled' });
        const offer = data.offers?.[asin];
        if (offer) return setState({ kind: 'ok', offer });
        if (data.outcome === 'no_offers') return setState({ kind: 'no_offers' });
        setState({ kind: 'failed' });
      })
      .catch(() => live && setState({ kind: 'failed' }));
    return () => {
      live = false;
    };
    // Asks once, on mount, for one ASIN. Deliberately no dependency on anything that
    // changes, so a re-render cannot become a second call.
  }, [asin, surface]);

  if (state.kind === 'disabled') return null;

  return (
    <div className="flex items-center justify-between px-6 py-5 border-t border-border bg-cream/60">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-ink-light italic mb-1">Also check on Amazon</p>

        {state.kind === 'checking' && (
          <p className="text-xs text-ink-light">Checking Amazon…</p>
        )}

        {state.kind === 'ok' && (
          <p className="text-xs text-ink-light">
            <span className="font-medium text-ink">{state.offer.displayPrice}</span>
            {!state.offer.inStock && ' · out of stock'}
            {/* THE SELLER NAME DOES THE WORK AND THE WORDING DOES NOT CHANGE. Naming who is
                selling is more useful than a generic third-party warning — it is the single
                most decision-relevant fact about an Amazon listing and the thing a shopper
                checks by hand — and more honest, because a blanket caveat applies equally to
                the brand's own store and to a reseller, which tells you nothing. */}
            {state.offer.sellerName ? ` · Sold by ${state.offer.sellerName}` : ''}
            {' · delivery not included'}
          </p>
        )}

        {state.kind === 'no_offers' && (
          <p className="text-xs text-ink-light">Amazon doesn&apos;t stock this</p>
        )}

        {state.kind === 'failed' && (
          <p className="text-xs text-ink-light">Couldn&apos;t reach Amazon</p>
        )}
      </div>

      <AmazonLink
        href={fallbackHref}
        productId={productId}
        source="amazon_crosscheck"
        clickSource="product_page"
        className="border border-border text-ink-light px-5 py-2.5 rounded-full text-sm font-medium hover:border-gold hover:text-ink transition-colors whitespace-nowrap"
      />
    </div>
  );
}
