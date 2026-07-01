'use client';

import { trackAffiliateClickOut, trackRetailerClick, affiliateNetworkFromUrl } from '../lib/analytics';

// Pull the AWIN merchant id out of a cread.php url (awinmid=NNNN) for attribution.
// Returns null for non-AWIN hrefs (Amazon/eBay cross-checks etc.).
function awinMidFromHref(href: string): string | null {
  const m = /[?&]awinmid=(\d+)/i.exec(href);
  return m ? m[1] : null;
}

// Affiliate click-out anchor that fires the GA4 click-out events before opening
// the destination. Used on the product detail page (server component) where we
// still need a client onClick handler. Defaults to the safe affiliate rel/target.
//
// Fires two GA4 events (affiliate_clickout + retailer_click) and, in addition,
// sends a fire-and-forget beacon to /api/track/outbound so the click is recorded
// server-side (service-role write, no redirect hop, direct affiliate href kept).
export function ClickOutLink({
  href,
  retailer,
  retailerId,
  productId,
  price,
  source,
  basketValue,
  productCount,
  className,
  children,
  rel = 'nofollow sponsored noopener',
  target = '_blank',
}: {
  href: string;
  retailer: string;
  retailerId?: number;
  productId?: number;
  price?: number;
  source?: string;
  basketValue?: number;
  productCount?: number;
  className?: string;
  children: React.ReactNode;
  rel?: string;
  target?: string;
}) {
  return (
    <a
      href={href}
      target={target}
      rel={rel}
      className={className}
      onClick={() => {
        trackAffiliateClickOut(retailer, productId);
        trackRetailerClick({
          retailerId,
          retailerName: retailer,
          affiliateNetwork: affiliateNetworkFromUrl(href),
          basketValue,
          productCount,
        });
        // Server-side outbound-click log. sendBeacon survives the navigation that
        // follows this click and never blocks it. Errors are swallowed so a logging
        // hiccup can never stop the user reaching the retailer.
        try {
          const payload = JSON.stringify({
            productId: productId ?? null,
            retailerId: retailerId ?? null,
            awinMid: awinMidFromHref(href),
            price: price ?? null,
            source: source ?? null,
            path: typeof window !== 'undefined' ? window.location.pathname : null,
          });
          navigator.sendBeacon?.(
            '/api/track/outbound',
            new Blob([payload], { type: 'application/json' })
          );
        } catch {
          /* never block the click-out */
        }
      }}
    >
      {children}
    </a>
  );
}
