// Client-side affiliate click-out tracking. Fires a GA4 event via the global
// gtag (loaded, consent-gated, by public/fmb-cookie-banner.js). No-ops on the
// server and when analytics consent hasn't loaded gtag.
//
// `retailer` distinguishes the destination so Amazon/eBay cross-checks can be
// reported alongside real partner-retailer click-outs in GA4. (The brief asks
// for a Meta-pixel "AffiliateClickOut"; the site has no Meta Pixel, only GA4,
// so this is the GA4 equivalent.)
export function trackAffiliateClickOut(retailer: string, productId?: number): void {
  if (typeof window === 'undefined') return;
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== 'function') return;
  gtag('event', 'affiliate_clickout', {
    retailer,
    ...(productId != null ? { product_id: productId } : {}),
  });
}

export type AffiliateNetwork = 'awin' | 'rakuten' | 'amazon' | 'ebay' | 'other';

// AWIN retailers all pool into awin1.com and Rakuten into click.linksynergy.com,
// so the destination host — not any retailer config — is the reliable source of
// the network. (Superdrug's feed_format says "awin" but it actually routes via
// Rakuten; reading the URL host gets this right and ends the manual URL reading.)
export function affiliateNetworkFromUrl(url: string): AffiliateNetwork {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  if (host.includes('awin1.com') || host.endsWith('awin.com')) return 'awin';
  if (host.includes('linksynergy.com')) return 'rakuten';
  if (host.includes('amazon.')) return 'amazon';
  if (host.includes('ebay.')) return 'ebay';
  return 'other';
}

// Per-retailer routing visibility. Fires alongside affiliate_clickout (which is
// kept) so GA4 can name the retailer behind the pooled awin1.com/linksynergy
// redirects. basket_value/product_count are optional and only carry meaning when
// a whole-basket routing context is known at the call site.
export function trackRetailerClick(params: {
  retailerId?: number;
  retailerName: string;
  affiliateNetwork: AffiliateNetwork;
  basketValue?: number;
  productCount?: number;
}): void {
  if (typeof window === 'undefined') return;
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== 'function') return;
  gtag('event', 'retailer_click', {
    ...(params.retailerId != null ? { retailer_id: params.retailerId } : {}),
    retailer_name: params.retailerName,
    affiliate_network: params.affiliateNetwork,
    ...(params.basketValue != null ? { basket_value: params.basketValue } : {}),
    ...(params.productCount != null ? { product_count: params.productCount } : {}),
  });
}
