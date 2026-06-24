'use client';

import { trackAffiliateClickOut, trackRetailerClick, affiliateNetworkFromUrl } from '../lib/analytics';

// Affiliate click-out anchor that fires the GA4 click-out events before opening
// the destination. Used on the product detail page (server component) where we
// still need a client onClick handler. Defaults to the safe affiliate rel/target.
//
// Fires two events: the existing affiliate_clickout (kept) and retailer_click,
// which carries the retailer identity + network (derived from the href host) so
// pooled awin1.com/linksynergy redirects can be attributed in GA4.
export function ClickOutLink({
  href,
  retailer,
  retailerId,
  productId,
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
      }}
    >
      {children}
    </a>
  );
}
