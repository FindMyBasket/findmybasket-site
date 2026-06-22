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
