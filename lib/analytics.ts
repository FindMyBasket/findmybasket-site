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

// Rakuten (LinkShare) deep links wrap the real destination in a click.linksynergy.com
// redirect that carries Rakuten's affiliate tracking (id / offerid / murl). Per Rakuten's
// request we no longer route Superdrug (retailer 12) click-outs through their tracking, so
// we send the user straight to the decoded destination (the `murl` param). Non-linksynergy
// urls (AWIN, Amazon, eBay, direct) pass through untouched. Falls back to the original url
// if no destination param is present, so a malformed link can never become a dead click-out.
export function directDestinationUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.hostname.toLowerCase().includes('linksynergy.com')) return url;
  const dest = parsed.searchParams.get('murl') || parsed.searchParams.get('RD_PARM1');
  return dest || url;
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

// eBay is a cross-check destination, not one of the tracked partner retailers, so
// it has no internal retailer_id. Send this explicit sentinel rather than omitting
// the parameter, so GA4 shows a single labelled "-1" row instead of scattering these
// clicks into "(not set)" where they can't be told apart from a genuine gap.
export const EBAY_RETAILER_ID = -1;

// Pull the AWIN merchant id out of a cread.php url (awinmid=NNNN) for attribution.
// Returns null for non-AWIN hrefs (Amazon/eBay cross-checks etc.). Shared by every
// surface that logs an outbound click so the extraction stays identical.
export function awinMidFromHref(href: string): string | null {
  const m = /[?&]awinmid=(\d+)/i.exec(href);
  return m ? m[1] : null;
}

// Fire-and-forget server-side outbound-click log. sendBeacon survives the navigation
// that follows the click and never blocks it; errors are swallowed so a logging
// hiccup can never stop the user reaching the retailer. The service-role write and
// the (consent-gated, currently-null) session id are both resolved server-side in
// /api/track/outbound — nothing identifying is sent from here.
export function sendOutboundBeacon(params: {
  productId?: number | null;
  retailerId?: number | null;
  awinMid?: string | null;
  price?: number | null;
  source?: string | null;
}): void {
  if (typeof window === 'undefined') return;
  try {
    const payload = JSON.stringify({
      productId: params.productId ?? null,
      retailerId: params.retailerId ?? null,
      awinMid: params.awinMid ?? null,
      price: params.price ?? null,
      source: params.source ?? null,
      path: window.location.pathname,
    });
    navigator.sendBeacon?.(
      '/api/track/outbound',
      new Blob([payload], { type: 'application/json' })
    );
  } catch {
    /* never block the click-out */
  }
}

// Per-retailer routing visibility. Fires alongside affiliate_clickout (which is
// kept) so GA4 can name the retailer behind the pooled awin1.com/linksynergy
// redirects. NOTE: affiliate_clickout and retailer_click fire on the SAME click,
// so any "total clicks" metric must count ONE of them, never both.
//
// `value` is the amount attributable to THIS click only — the offer price on a
// product page, or a single retailer's subtotal within an optimised basket. It is
// deliberately NOT the whole-basket total: GA4 sums the reserved `value`, so a
// basket total would multiply across repeat clicks and inflate revenue reporting.
// `isBestValue` is emitted as the string 'true'/'false' (a JS boolean would be
// coerced unpredictably by GA4's custom-dimension layer).
export function trackRetailerClick(params: {
  retailerId?: number;
  retailerName: string;
  affiliateNetwork: AffiliateNetwork;
  itemId?: number;
  value?: number;
  basketItemCount?: number;
  isBestValue?: boolean;
  listPosition?: number;
  // The surface the click came from — product_page, optimiser_shop_button,
  // optimiser_open_all, optimiser_modal, routine_amazon_crosscheck,
  // routine_ebay_crosscheck, brand_hub_card, brand_hub_cta, brand_hub_offer.
  // Registered as a custom dimension so reporting can separate surfaces that fire
  // this event at deliberately different `value` granularities (a per-offer price
  // vs a retailer subtotal).
  clickSource?: string;
  // Brand-hub clicks only. A stable machine key for the brand (the hub slug), used
  // for partner reporting instead of retailer_name: display names re-case or carry
  // diacritics (e.g. iLĀPOTHECARY), and any normalisation would split the dimension
  // into unmergeable values. Slugs are already canonical (hub routes / asset paths).
  brandSlug?: string;
}): void {
  if (typeof window === 'undefined') return;
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== 'function') return;
  gtag('event', 'retailer_click', {
    ...(params.retailerId != null ? { retailer_id: params.retailerId } : {}),
    retailer_name: params.retailerName,
    affiliate_network: params.affiliateNetwork,
    ...(params.itemId != null ? { item_id: params.itemId } : {}),
    ...(params.value != null ? { value: params.value, currency: 'GBP' } : {}),
    ...(params.basketItemCount != null ? { basket_item_count: params.basketItemCount } : {}),
    ...(params.isBestValue != null ? { is_best_value: params.isBestValue ? 'true' : 'false' } : {}),
    ...(params.listPosition != null ? { list_position: params.listPosition } : {}),
    ...(params.clickSource != null ? { click_source: params.clickSource } : {}),
    ...(params.brandSlug != null ? { brand_slug: params.brandSlug } : {}),
  });
}

// The basket optimisation — the core value moment of the product. Fire ONCE per
// optimisation run (from finishRender, not from React render), never per re-render.
//
// The winning basket total is sent as the custom metric `winning_basket_total`, NOT
// the reserved `value`: GA4 sums `value`, so re-running the optimiser (or an auto-run
// on a shared /app?routine= link) would compound the basket total into a meaningless
// aggregate. As a count-style event, basket_optimised has no reserved monetary field.
// `resultType` reveals whether the answer was one basket or a split.
export function trackBasketOptimised(params: {
  basketItemCount: number;
  winningRetailerCount: number;
  resultType: 'single' | 'split';
  unpricedItemCount: number;
  winningBasketTotal: number;
  savingsValue: number;
  // Whether the UI suppressed the headline saving for this run (price anomaly or
  // near-zero). savings_value is still reported on suppressed runs, but this flag
  // lets the "~X% average saving" headline claim be computed EXCLUDING runs the
  // product itself flagged as unreliable. Emitted as the string 'true'/'false', to
  // match the is_best_value convention.
  savingsSuppressed: boolean;
  // How the run was triggered: 'user_action' (the Find-my-basket button) vs
  // 'auto_shared_link' (auto-run on a shared /app?routine= link). Keeps the growing
  // shared-link loop's automatic runs separable from deliberate optimisations.
  optimisationTrigger: 'user_action' | 'auto_shared_link';
}): void {
  if (typeof window === 'undefined') return;
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== 'function') return;
  gtag('event', 'basket_optimised', {
    basket_item_count: params.basketItemCount,
    winning_retailer_count: params.winningRetailerCount,
    result_type: params.resultType,
    unpriced_item_count: params.unpricedItemCount,
    winning_basket_total: params.winningBasketTotal,
    savings_value: params.savingsValue,
    savings_suppressed: params.savingsSuppressed ? 'true' : 'false',
    optimisation_trigger: params.optimisationTrigger,
  });
}

// A product added to the routine ("basket"). Standard GA4 add_to_cart, so it feeds
// the built-in cart/ecommerce reports. No source/device param: GA4's built-in device
// category already separates the desktop column button from the mobile buy-bar
// button. item_id is stringified to match the GA4 ecommerce items[] convention.
export function trackAddToCart(params: {
  itemId: number;
  itemBrand?: string;
  itemCategory?: string;
}): void {
  if (typeof window === 'undefined') return;
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== 'function') return;
  gtag('event', 'add_to_cart', {
    items: [
      {
        item_id: String(params.itemId),
        ...(params.itemBrand ? { item_brand: params.itemBrand } : {}),
        ...(params.itemCategory ? { item_category: params.itemCategory } : {}),
      },
    ],
  });
}

// A product/comparison page view. Standard GA4 view_item. `value` is the lowest
// in-stock price shown; num_retailers is the compared-offer depth (a registered
// custom metric). Fire ONCE per product view — see ProductViewTracker for the
// strict-mode double-invoke guard.
export function trackViewItem(params: {
  itemId: number;
  itemBrand?: string;
  itemCategory?: string;
  value?: number;
  numRetailers?: number;
}): void {
  if (typeof window === 'undefined') return;
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== 'function') return;
  gtag('event', 'view_item', {
    ...(params.value != null ? { value: params.value, currency: 'GBP' } : {}),
    ...(params.numRetailers != null ? { num_retailers: params.numRetailers } : {}),
    items: [
      {
        item_id: String(params.itemId),
        ...(params.itemBrand ? { item_brand: params.itemBrand } : {}),
        ...(params.itemCategory ? { item_category: params.itemCategory } : {}),
      },
    ],
  });
}

// A committed catalogue search (the /search results page — NOT the per-keystroke
// typeahead). Standard GA4 `search` with the reserved `search_term`, which powers
// the built-in Search Terms report. `result_count` is a custom metric (not a
// reserved GA4 param); `search_source` a custom dimension (search_page / finder).
export function trackSearch(params: {
  searchTerm: string;
  resultCount: number;
  searchSource?: string;
}): void {
  if (typeof window === 'undefined') return;
  const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof gtag !== 'function') return;
  gtag('event', 'search', {
    search_term: params.searchTerm,
    result_count: params.resultCount,
    ...(params.searchSource ? { search_source: params.searchSource } : {}),
  });
}
