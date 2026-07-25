'use client';

import {
  trackAffiliateClickOut,
  trackRetailerClick,
  affiliateNetworkFromUrl,
  directDestinationUrl,
  awinMidFromHref,
  sendOutboundBeacon,
} from '../lib/analytics';

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
  clickSource,
  brandSlug,
  isBestValue,
  listPosition,
  basketItemCount,
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
  // Brand-hub only: stable brand key (hub slug) for the GA4 brand_slug dimension.
  brandSlug?: string;
  // `source` labels the server-side outbound_clicks row (its own established
  // vocabulary, e.g. amazon_crosscheck/ebay_search). `clickSource` is the GA4
  // click_source dimension and defaults to `source` when not given; pass it
  // explicitly where the two diverge (e.g. a product-page cross-check whose GA4
  // surface should read product_page, not amazon_crosscheck).
  source?: string;
  clickSource?: string;
  // Attribution context. `price` is the amount attributable to this single click
  // and maps to the GA4 reserved `value`. isBestValue/listPosition describe this
  // offer's standing in the comparison list it was clicked from.
  isBestValue?: boolean;
  listPosition?: number;
  basketItemCount?: number;
  className?: string;
  children: React.ReactNode;
  rel?: string;
  target?: string;
}) {
  // Navigate to the unwrapped destination (strips Rakuten/linksynergy tracking for
  // Superdrug; all other hrefs pass through unchanged). Analytics keep reading the
  // ORIGINAL href so retailer/network attribution in GA4 stays continuous.
  const destHref = directDestinationUrl(href);
  return (
    <a
      href={destHref}
      target={target}
      rel={rel}
      className={className}
      onClick={() => {
        trackAffiliateClickOut(retailer, productId);
        trackRetailerClick({
          retailerId,
          retailerName: retailer,
          affiliateNetwork: affiliateNetworkFromUrl(href),
          itemId: productId,
          value: price,
          isBestValue,
          listPosition,
          basketItemCount,
          clickSource: clickSource ?? source,
          brandSlug,
        });
        // Server-side outbound-click log, resilient to the navigation that follows.
        sendOutboundBeacon({
          productId,
          retailerId,
          awinMid: awinMidFromHref(href),
          price,
          source,
        });
      }}
    >
      {children}
    </a>
  );
}
