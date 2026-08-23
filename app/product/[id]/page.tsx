import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { SiteLayout } from '../../../components/SiteLayout';
import { ProductCard } from '../../../components/ProductCard';
import { SaveToRoutineButton } from '../../../components/SaveToRoutineButton';
import {
  getProductById,
  getRetailerOffers,
  getRelatedProducts,
  getMoreFromBrand,
  resolveCanonicalKeeper,
} from '../../../lib/product-queries';
import { buildBreadcrumbJsonLd } from '../../../lib/breadcrumb';
import { SPECIALIST_IMPORTER_RETAILER_IDS, categoryToSlug, categoryDisplay } from '../../../lib/queries';
import { displayProductTitle } from '../../../lib/format/product-name';
import { displaySizeChip } from '../../../lib/format/pack-size';
import { ProductDescription } from '../../../components/ProductDescription';
import { ClickOutLink } from '../../../components/ClickOutLink';
import { AmazonLink } from '../../../components/AmazonLink';
import { AmazonLiveRow } from '../../../components/AmazonLiveRow';
import { ProductViewTracker } from '../../../components/ProductViewTracker';

export const revalidate = 3600;

const SITE_URL = 'https://www.findmybasket.co.uk';

const AMAZON_TAG = 'findmybasket-21';

// Use displayProductTitle so the search query carries the brand exactly once
// (most catalogue names already start with the brand, see lib/format/product-name).
function buildAmazonSearchUrl(productName: string, brand: string | null): string {
  const query = displayProductTitle(productName, brand);
  const encoded = encodeURIComponent(query.replace(/\s+/g, ' ').trim());
  return `https://www.amazon.co.uk/s?k=${encoded}&tag=${AMAZON_TAG}`;
}

// Direct product hard-link for the products with a verified ASIN. The associate
// tag MUST be on every Amazon link (it is how we earn), so it is appended here too.
function buildAmazonProductUrl(asin: string): string {
  return `https://www.amazon.co.uk/dp/${encodeURIComponent(asin)}/?tag=${AMAZON_TAG}`;
}

/*
 * LAST-SEEN FORMATTING. Reads `retailer_prices.last_updated` -- the moment THIS row
 * was last re-confirmed by an import that actually contained the product.
 *
 * WHY PER ROW AND NOT PER PAGE. A successful import that no longer contains a
 * product leaves `retailer_import_config.last_import_status = 'ok'` while that row's
 * `last_updated` stops moving. A page-level stamp reads the import and would report
 * FRESH on all 12,398 out-of-stock-only pages, whose rows average 48.5 days since
 * anything last saw them. Only the per-row value can tell "the import ran" from
 * "this row was re-confirmed". Work-list item 247.
 */
function lastSeen(iso: string | null): { label: string; days: number } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  const label = new Date(t).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  return { label, days };
}

function displaySub(sub: string | null): string {
  if (!sub) return '';
  return sub.charAt(0).toUpperCase() + sub.slice(1);
}

function truncate(s: string, cap: number): string {
  if (s.length <= cap) return s;
  return s.slice(0, cap - 1).trimEnd() + '…';
}

// Build an SEO description from the real product description when available,
// falling back to the generated template. When the description is short there's
// room to append the brand + product name for keyword coverage.
function buildSeoDescription(
  description: string | null,
  title: string,
  fallback: string,
  cap: number,
): string {
  const base = description?.trim();
  if (!base) return truncate(fallback, cap);
  const suffix = ` ${title}`;
  if (base.length + suffix.length <= cap && !base.toLowerCase().includes(title.toLowerCase())) {
    return base + suffix;
  }
  return truncate(base, cap);
}

export async function generateMetadata({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) return { title: 'Product not found | FindMyBasket' };

  const product = await getProductById(id);
  if (!product) return { title: 'Product not found | FindMyBasket' };

  // The catalogue name usually already starts with the brand, so combine them
  // without doubling it (see lib/format/product-name).
  const baseTitle = displayProductTitle(product.name, product.brand);
  const canonical = `${SITE_URL}/product/${id}`;

  // Durable language only: no point-in-time prices or retailer counts baked into
  // ISR-cached metadata, which would serve stale to crawlers. Range-based value
  // language per the copy standing rules (no "cheapest", no specific prices).
  const fallbackDescription =
    `Compare ${baseTitle} prices across multiple UK retailers, with delivery factored in. Find the best value for your routine on FindMyBasket.`;
  const metaDescription = buildSeoDescription(product.description, baseTitle, fallbackDescription, 155);
  const socialDescription = buildSeoDescription(product.description, baseTitle, fallbackDescription, 200);
  const title = `${baseTitle} | Compare prices | FindMyBasket`;

  return {
    title,
    description: metaDescription,
    alternates: { canonical },
    openGraph: {
      title,
      description: socialDescription,
      url: canonical,
      images: product.image_url ? [product.image_url] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      description: socialDescription,
      images: product.image_url ? [product.image_url] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) notFound();

  const product = await getProductById(id);
  if (!product) {
    // The requested product is hidden from products_active — either soft-merged
    // (send its equity to the surviving keeper) or a shade-variant child (send it
    // to the parent, which is now the canonical page). Redirect to the live target
    // so indexed links, bookmarks and ranking signal consolidate there instead of
    // 404ing. permanentRedirect emits a 308, which Google treats like a 301.
    // Genuinely-thin rows (no image / no live price) resolve to null and keep their
    // correct 404.
    const keeper = await resolveCanonicalKeeper(id);
    if (keeper !== null) permanentRedirect(`/product/${keeper}`);
    notFound();
  }

  const [offers, related, moreFromBrandRaw] = await Promise.all([
    getRetailerOffers(id),
    getRelatedProducts(product, 6),
    product.normalised_brand
      ? getMoreFromBrand(product.normalised_brand, product.id, product.top_category, 12)
      : Promise.resolve([]),
  ]);

  // Dedupe the brand block against "Related products" (which can overlap on
  // same-brand same-type items) so a product never shows twice, then cap at 8.
  const relatedIds = new Set(related.map(p => p.id));
  const moreFromBrand = moreFromBrandRaw.filter(p => !relatedIds.has(p.id)).slice(0, 8);

  const inStockOffers = offers.filter(o => o.in_stock);
  const outOfStockOffers = offers.filter(o => !o.in_stock);
  // Products stocked only by specialist importers (Stylevana/YesStyle/Atelier De
  // Glow, see SPECIALIST_IMPORTER_RETAILER_IDS) get a "Specialist import" badge to
  // set delivery/customs expectations. Presentational only — these retailers are
  // shown and ranked on price alongside every other retailer.
  const isSpecialistOnly = inStockOffers.length > 0 && inStockOffers.every(o => SPECIALIST_IMPORTER_RETAILER_IDS.has(o.retailer_id));
  // Offers are sorted in-stock-first then ascending by effective_price, so [0] is
  // the best price and [1] is the next-best. Anchor the saving to the next-best
  // price (not the most expensive) so one outlier high price cannot inflate it.
  const lowestPrice = inStockOffers.length > 0 ? inStockOffers[0].effective_price : null;
  // The SAME offer's goods price, for the labelled secondary line. Read from
  // inStockOffers[0] rather than min(price): the cheapest delivered offer is not
  // always the cheapest item, and taking the minimum of each independently would
  // print two figures that never belonged to one retailer.
  const bestItemPrice = inStockOffers.length > 0 ? inStockOffers[0].price : null;
  const nextBestPrice = inStockOffers.length > 1 ? inStockOffers[1].effective_price : null;
  const savingPct = lowestPrice && nextBestPrice && nextBestPrice > lowestPrice
    ? Math.round(((nextBestPrice - lowestPrice) / nextBestPrice) * 100)
    : null;

  // Product JSON-LD, in TWO SHAPES.
  //
  //   in stock      AggregateOffer (price range + count) so Google can render the
  //                 "£X to £Y" snippet, then one Offer per in-stock retailer so the
  //                 named multi-retailer panel resolves.
  //   nothing in    one Offer per OUT-OF-STOCK retailer, availability OutOfStock,
  //   stock         real prices, and NO AggregateOffer.
  //
  // WHY NO AGGREGATE ON THE SECOND SHAPE. lowPrice over rows nobody can buy feeds a
  // shopping snippet advertising an unbuyable price. That is worse than emitting no
  // offer at all: the current behaviour is silent, and a wrong price is not.
  //
  // THIS BLOCK USED TO OMIT `offers` ENTIRELY when nothing was in stock, reasoning:
  // "an Offer requires price/priceSpecification; a priceless OutOfStock offer is
  // invalid and Google flags it. Product schema permits a Product with no offers."
  //
  // THAT REASONING IS RIGHT ABOUT SCHEMA.ORG AND WRONG ABOUT GOOGLE, and the
  // distinction is worth keeping because it is the obvious thought to have. schema.org
  // does permit a Product with no offers. GOOGLE'S PRODUCT GUIDANCE REQUIRES ONE OF
  // offers / review / aggregateRating for rich-result eligibility, and Search Console
  // reports the absence — "Either offers, review, or aggregateRating should be
  // specified". The code was reasoned against the standard rather than against the
  // consumer of the standard, and they are different specifications.
  //
  // AND THE RISK IT AVOIDED IS EMPTY IN THIS DATA. Measured 14 August 2026: of 13,335
  // products with no in-stock offer, 13,335 have an out-of-stock row at an active
  // retailer AND a price above zero. Zero have neither; zero have a row without a
  // price. The priceless OutOfStock offer does not occur here. If that ever changes,
  // the guard belongs on the individual Offer, not on the whole block — hence the
  // per-offer price filter below rather than a branch around the whole thing.
  //
  // The page already renders these retailers and prices under an "Out of stock"
  // heading. Before this change the markup told Google there were none.
  const jsonLdName = displayProductTitle(product.name, product.brand);
  // Guarded size chip — null where canonical_size is a multipack's unit size.
  const sizeChip = displaySizeChip(product.name, product.canonical_size);
  const inStockPrices = inStockOffers.map(o => o.price);
  // Per-offer guard rather than a branch around the whole block: a single priceless
  // row must drop that Offer, not silence the markup for the product. Measured zero
  // today; this is what keeps that true if it ever stops being.
  const outOfStockPricedOffers = outOfStockOffers.filter(
    o => typeof o.price === 'number' && o.price > 0,
  );
  const productJsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: jsonLdName,
    brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
    image: product.image_url || undefined,
    sku: product.ean ?? `fmb-${product.id}`,
    description: product.description?.trim() || `Compare ${jsonLdName} prices across multiple UK retailers.`,
    offers: inStockOffers.length > 0
      ? [
          {
            '@type': 'AggregateOffer',
            priceCurrency: 'GBP',
            lowPrice: Math.min(...inStockPrices).toFixed(2),
            highPrice: Math.max(...inStockPrices).toFixed(2),
            offerCount: inStockOffers.length,
            availability: 'https://schema.org/InStock',
          },
          ...inStockOffers.map(o => ({
            '@type': 'Offer',
            url: `${SITE_URL}/product/${product.id}`,
            priceCurrency: 'GBP',
            price: o.price.toFixed(2),
            availability: 'https://schema.org/InStock',
            seller: { '@type': 'Organization', name: o.retailer_name },
          })),
        ]
      : outOfStockPricedOffers.length > 0
        ? outOfStockPricedOffers.map(o => ({
            '@type': 'Offer',
            url: `${SITE_URL}/product/${product.id}`,
            priceCurrency: 'GBP',
            price: o.price.toFixed(2),
            availability: 'https://schema.org/OutOfStock',
            seller: { '@type': 'Organization', name: o.retailer_name },
          }))
        : undefined,
  };

  // BreadcrumbList JSON-LD
  const breadcrumbItems = [
    { name: 'Home', url: '/' },
  ];
  if (product.top_category) {
    breadcrumbItems.push({
      name: categoryDisplay(product.top_category),
      url: `/${categoryToSlug(product.top_category)}`,
    });
  }
  if (product.subcategory && product.top_category) {
    breadcrumbItems.push({
      name: displaySub(product.subcategory),
      url: `/${categoryToSlug(product.top_category)}/${product.subcategory}`,
    });
  }
  breadcrumbItems.push({
    name: displayProductTitle(product.name, product.brand),
    url: `/product/${product.id}`,
  });
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(breadcrumbItems);

  const routineItem = {
    id: product.id,
    name: product.name,
    brand: product.brand ?? '',
    category: product.product_type ?? '',
  };

  // Verified ASIN -> direct product link; otherwise fall back to the tagged search.
  const amazonUrl = product.amazon_asin
    ? buildAmazonProductUrl(product.amazon_asin)
    : buildAmazonSearchUrl(product.name, product.brand);

  return (
  <SiteLayout>
      <ProductViewTracker
        itemId={product.id}
        itemBrand={product.brand ?? undefined}
        itemCategory={product.product_type ?? undefined}
        // value deliberately EXCLUDES delivery: it is the best offer's goods price,
        // whereas the visible "Best price" chip / mobile buy bar show effective_price
        // (incl delivery). Excluding delivery matches the affiliate commission basis
        // (paid on goods value, not postage) and keeps view_item.value equal to
        // retailer_click.value. The gap vs the on-screen figure is intentional.
        price={inStockOffers[0]?.price}
        numRetailers={inStockOffers.length}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <section className="max-w-site mx-auto px-6 py-8">
        <nav className="text-sm text-ink-light mb-6 flex flex-wrap gap-1.5 items-center">
          {product.top_category && (
            <>
              <Link href={`/${categoryToSlug(product.top_category)}`} className="hover:text-ink transition-colors">
                {categoryDisplay(product.top_category)}
              </Link>
              <span>›</span>
            </>
          )}
          {product.subcategory && product.top_category && (
            <>
              <Link
                href={`/${categoryToSlug(product.top_category)}/${product.subcategory}`}
                className="hover:text-ink transition-colors capitalize"
              >
                {product.subcategory}
              </Link>
              <span>›</span>
            </>
          )}
          {product.brand && product.brand_slug && (
            <Link
              href={`/brands/${product.brand_slug}`}
              className="hover:text-ink transition-colors"
            >
              {product.brand}
            </Link>
          )}
        </nav>

        <div className="grid md:grid-cols-2 gap-8 mb-8 items-start">
          {/* Left column: pinned on desktop (md:sticky) so the product image,
              price and "Add to my routine" stay in view while the comparison and
              description scroll on the right. Static normal flow on mobile. */}
          <div className="md:sticky md:top-24 md:self-start">
          <div className="bg-warm-white border border-border rounded-2xl h-56 md:h-[20vh] flex items-center justify-center overflow-hidden mb-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.image_url || '/placeholder-product.svg'}
              alt={product.name}
              className="max-w-full max-h-full object-contain p-8"
            />
          </div>

          {product.brand && (
              <p className="text-xs uppercase tracking-widest text-gold font-medium mb-3">
                {product.brand_slug ? (
                  <Link href={`/brands/${product.brand_slug}`} className="hover:text-ink transition-colors">
                    {product.brand}
                  </Link>
                ) : (
                  product.brand
                )}
              </p>
            )}
            <h1 className="font-serif text-2xl md:text-3xl text-ink mb-4 leading-tight">
              {product.name}
            </h1>
            {/* Price and the primary action sit directly under the title so they
                clear the fold on a laptop without scrolling. Secondary metadata
                (specialist note, product chips) follows below the button. */}
            {lowestPrice !== null && (
              <div className="bg-cream border border-border rounded-2xl p-6 mb-4">
                {/* ONE AUTHORITATIVE FIGURE: the DELIVERED price. Both this and the
                    top table row now lead with the same quantity and both say so.
                    Before this change the headline rendered effective_price and the
                    row's large figure rendered price, unlabelled -- the same
                    quantity large in one place and small in the other, 400px apart,
                    on 76.5% of pages with an in-stock offer (66,398 of 86,835).
                    Work-list item 245. */}
                <p className="text-xs uppercase tracking-widest text-ink-light mb-1.5">
                  Best delivered price across {inStockOffers.length} retailer{inStockOffers.length === 1 ? '' : 's'}
                </p>
                <p className="font-serif text-4xl text-ink mb-1">
                  £{lowestPrice.toFixed(2)}
                </p>
                {/* Item price secondary and LABELLED. Rendered only when it differs,
                    so a free-delivery offer does not show the same number twice. */}
                {bestItemPrice !== null && bestItemPrice !== lowestPrice && (
                  <p className="text-sm text-ink-light mb-1">
                    £{bestItemPrice.toFixed(2)} item + £{(lowestPrice - bestItemPrice).toFixed(2)} delivery
                  </p>
                )}
                {/* Stated openly rather than assumed. A delivered price is only this
                    number for an order containing this item alone; adding anything
                    else from the same retailer can cross a threshold and change it. */}
                <p className="text-xs text-ink-light">
                  Delivered prices assume an order containing this item only.
                </p>
                {savingPct !== null && savingPct >= 5 && (
                  <p className="text-sm text-sage">
                    Save {savingPct}% vs the next-best retailer
                  </p>
                )}
              </div>
            )}

            {/* Desktop uses this in-column button, which is above the fold in
                the sticky column. Mobile uses the pinned bottom bar instead, so
                this one is hidden below md to avoid a duplicate beside the bar. */}
            {inStockOffers.length > 0 && (
              <div className="hidden md:block">
                <SaveToRoutineButton product={routineItem} />
              </div>
            )}

            {isSpecialistOnly && (
              <div className="inline-flex items-center gap-2 bg-cream border border-border rounded-full px-4 py-1.5 mb-4 text-xs text-ink-light">
                <span>✦ Specialist import · longer delivery times may apply</span>
              </div>
            )}

            {/* SIZE CHIP IS GUARDED. `canonical_size` holds the UNIT size for
                "N x M<unit>" multipack names, not the pack total, so an
                unguarded chip understated 446 live products — worst case 90x
                ("90 x 3g Sachets" rendering "3g" for a 270g pack). The guard
                suppresses the chip only where the stored value equals the unit
                size of a pack pattern in the name.

                Suppression is honest here because the <h1> above renders
                product.name RAW: for exactly these rows the pack is already
                stated in full four lines up, so this removes a contradiction
                rather than a fact. If that title ever stops showing the raw
                name, revisit lib/format/pack-size.ts — the justification lapses
                with it. The column itself is still wrong; see
                docs/supplements-brand-comparison-proposition.md item B2. */}
            {(product.product_type || sizeChip || product.shade) && (
              <div className="flex flex-wrap gap-2 mb-6">
                {product.product_type && (
                  <span className="bg-warm-white border border-border rounded-full px-4 py-1.5 text-xs text-ink-light">
                    {product.product_type}
                  </span>
                )}
                {sizeChip && (
                  <span className="bg-warm-white border border-border rounded-full px-4 py-1.5 text-xs text-ink-light">
                    {sizeChip}
                  </span>
                )}
                {product.shade && (
                  <span className="bg-warm-white border border-border rounded-full px-4 py-1.5 text-xs text-ink-light">
                    {product.shade}
                  </span>
                )}
              </div>
            )}

            {/* THESE ARE NOT OUT-OF-STOCK PRODUCTS. THEY ARE ROWS THE IMPORTER
                STOPPED SEEING.

                Each retailer's `absence_threshold_days` flips `in_stock` to false
                when a product stops appearing in its feed. Measured 23 Aug 2026 over
                the 12,398 pages in this state: ZERO refreshed in the last seven days,
                median 48.5 days since anything last saw them, 89% over thirty days,
                oldest 4 May. Boots is 7,936 of them averaging 67 days against a
                SEVEN-day threshold.

                The previous copy read "Currently out of stock at all retailers. Check
                back soon." BOTH CLAIMS WERE FALSE. "Currently" asserts a present-tense
                fact about a row last confirmed a median of 48.5 days ago, and "check
                back soon" invites a return to a page with no mechanism that would
                change it -- nothing re-checks a product that has left the feed.

                What is true is the date. Work-list item 247. */}
            {inStockOffers.length === 0 && offers.length > 0 && (() => {
              const seen = outOfStockOffers
                .map(o => lastSeen(o.last_updated))
                .filter((x): x is { label: string; days: number } => x !== null)
                .sort((a, b) => a.days - b.days)[0];
              return (
                <div className="bg-cream border border-border rounded-2xl p-6 mb-6">
                  {/* AN ABSENCE IN OUR DATA IS EVIDENCE ABOUT OUR DATA.
                      "No longer listed at Boots" -- the first wording here -- claims
                      a fact about a RETAILER'S RANGE inferred from OUR OWN INGESTION.
                      We know the row left our feed. We do not know the product left
                      their catalogue: a feed can drop a line for a category change, a
                      temporary supplier gap, a schema fault at either end, or a
                      freeze we have not detected. Item 248. */}
                  <p className="text-sm text-ink">
                    {outOfStockOffers.length === 1
                      ? `Not in our latest feed from ${outOfStockOffers[0].retailer_name}.`
                      : `Not in our latest feed from any of the ${outOfStockOffers.length} retailers we track for it.`}
                  </p>
                  {seen && (
                    <p className="text-sm text-ink-light mt-1">
                      Last seen {seen.label}
                      {seen.days >= 1 && ` — ${seen.days} day${seen.days === 1 ? '' : 's'} ago`}.
                    </p>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Right column: scrolls past the pinned left column. Comparison and
              description. Logic, prices and savings are unchanged. */}
          <div>
            <h2 className="font-serif text-2xl text-ink mb-3">Compare prices</h2>
            <p className="text-sm text-ink-light mb-4">
              Best basket across UK retailers. Also check Amazon for its current price. Click through to buy.
            </p>
            <div className="bg-warm-white border border-border rounded-2xl overflow-hidden">
              {offers.length === 0 ? (
                <div className="p-8 text-center text-ink-light">
                  No retailer prices available for this product yet.
                </div>
              ) : (
                <>
                  {inStockOffers.map((offer, idx) => (
                    <RetailerRow key={`${offer.retailer_id}-${idx}`} offer={offer} isBestPrice={idx === 0} position={idx} productId={product.id} />
                  ))}
                  {/* COLLAPSE ONLY WHERE THERE IS SOMETHING TO COLLAPSE, AND
                      SOMETHING LEFT AFTER COLLAPSING IT.

                      Two conditions, both load-bearing:

                        more than ONE out-of-stock row -- 12,294 of the 12,398
                          out-of-stock-only pages have exactly one, and hiding a
                          single row behind a line that says there is one row is
                          not a summary, it is an extra click for no information.

                        at least one IN-STOCK row -- otherwise the collapse empties
                          the table entirely on 12.4% of pages, leaving a comparison
                          page with nothing visible to compare.

                      Where both hold the rows fold into a native <details>, which
                      needs no client JS in a server component. Where either fails
                      they render inline as before. Work-list item 247. */}
                  {outOfStockOffers.length > 0 && (
                    outOfStockOffers.length > 1 && inStockOffers.length > 0 ? (
                      <details className="border-t border-border">
                        <summary className="bg-cream px-6 py-3 text-xs uppercase tracking-widest text-ink-light cursor-pointer select-none">
                          {outOfStockOffers.length} retailers not in our latest feeds
                        </summary>
                        {outOfStockOffers.map((offer, idx) => (
                          <RetailerRow key={`oos-${offer.retailer_id}-${idx}`} offer={offer} isBestPrice={false} position={inStockOffers.length + idx} productId={product.id} />
                        ))}
                      </details>
                    ) : (
                      <>
                        <div className="bg-cream px-6 py-3 border-y border-border text-xs uppercase tracking-widest text-ink-light">
                          Not in our latest feed
                        </div>
                        {outOfStockOffers.map((offer, idx) => (
                          <RetailerRow key={`oos-${offer.retailer_id}-${idx}`} offer={offer} isBestPrice={false} position={inStockOffers.length + idx} productId={product.id} />
                        ))}
                      </>
                    )
                  )}
                </>
              )}
              {/* Amazon is an honest cross-check, not a compared price.
                  WITH A VERIFIED ASIN the row fetches a live price after hydration and
                  names the seller. WITHOUT ONE it stays a tagged search link and keeps the
                  old caveat, which is accurate for a link and stops being accurate the
                  moment a number is rendered — hence the two branches rather than one. */}
              {product.amazon_asin ? (
                <AmazonLiveRow
                  asin={product.amazon_asin}
                  productId={product.id}
                  fallbackHref={amazonUrl}
                />
              ) : (
                <div className="flex items-center justify-between px-6 py-5 border-t border-border bg-cream/60">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink-light italic mb-1">Also check on Amazon</p>
                    <p className="text-xs text-ink-light">Live price varies, not compared</p>
                  </div>
                  <AmazonLink
                    href={amazonUrl}
                    productId={product.id}
                    source="amazon_crosscheck"
                    clickSource="product_page"
                    className="border border-border text-ink-light px-5 py-2.5 rounded-full text-sm font-medium hover:border-gold hover:text-ink transition-colors whitespace-nowrap"
                  />
                </div>
              )}
            </div>

            {product.description && <ProductDescription description={product.description} />}
          </div>
        </div>
      </section>

      {/* THE "ALSO TRY" eBAY SECTION IS REMOVED. It was a whole page section --
          heading, caption and card -- offering a SEARCH on a marketplace whose prices
          are not compared, sitting directly below the comparison table that is the
          point of the page. It carried its own caveat ("Prices not compared"), which
          is honest and is also an admission that it was not doing the page's job.

          eBay is now absent site-wide. Amazon stays, above, because it is a priced
          cross-check with a verified ASIN path rather than a search link.

          Revision 1 of the programme recorded this as already fixed. It was not --
          it was live at page.tsx:512 until 23 August. Work-list item 245, phase 0.3. */}

      {related.length > 0 && (
        <section className="max-w-site mx-auto px-6 py-8">
          <h2 className="font-serif text-3xl text-ink mb-2">Related products</h2>
          <p className="text-ink-light mb-6">
            More from {product.brand ?? 'this category'}.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {related.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {product.brand && product.brand_slug && moreFromBrand.length > 0 && (
        <section className="max-w-site mx-auto px-6 py-8">
          <div className="flex items-baseline justify-between mb-2 flex-wrap gap-x-4">
            <h2 className="font-serif text-3xl text-ink">More from {product.brand}</h2>
            <Link
              href={`/brands/${product.brand_slug}`}
              className="text-sm text-ink-light hover:text-ink transition-colors"
            >
              View all {product.brand} →
            </Link>
          </div>
          <p className="text-ink-light mb-6">
            Explore the rest of the {product.brand} range across categories.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {moreFromBrand.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {/* Mobile only: a persistent buy bar pinned to the bottom of the viewport
          so the core action stays on screen while the visitor scrolls the
          comparison. Reuses SaveToRoutineButton, so it mirrors the same add
          action and "Added to my routine" state as the in-column button via the
          shared routine store. Desktop keeps the sticky left column instead. */}
      {inStockOffers.length > 0 && (
        <>
          {/* Spacer so the fixed bar never hides the last of the page content. */}
          <div className="h-24 md:hidden" aria-hidden="true" />
          <div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-warm-white/95 backdrop-blur border-t border-border px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <div className="max-w-site mx-auto flex items-center gap-4">
              {/* shrink-0 keeps the price intact and lets the button flex. The price
                  is now the DELIVERED figure, which is longer than the item price it
                  replaced, so the button is the side that must give. */}
              {lowestPrice !== null && (
                <div className="shrink-0 leading-none">
                  <p className="text-[10px] uppercase tracking-widest text-ink-light mb-1">
                    Best delivered
                  </p>
                  <p className="font-serif text-xl text-ink">£{lowestPrice.toFixed(2)}</p>
                </div>
              )}
              <div className="flex-1">
                <SaveToRoutineButton product={routineItem} compact />
              </div>
            </div>
          </div>
        </>
      )}
    </SiteLayout>
  );
}

function RetailerRow({
  offer,
  isBestPrice,
  position,
  productId,
}: {
  offer: import('../../../lib/product-queries').RetailerOffer;
  isBestPrice: boolean;
  position: number;
  productId: number;
}) {
  return (
    <div className={`flex items-center justify-between px-6 py-5 border-b border-border last:border-b-0 ${!offer.in_stock ? 'opacity-60' : ''}`}>
      <div className="flex-1 min-w-0">
        {/* min-w-0 alone does not truncate -- it only PERMITS shrinking. The retailer
            name needs `truncate` for the permission to have an effect, and the chip
            row needs `flex-wrap` so two badges plus a long name do not force the row
            wider than the viewport at 390px. */}
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <span className="font-medium text-ink truncate">{offer.retailer_name}</span>
          {isBestPrice && offer.in_stock && (
            <span className="bg-gold text-white text-xs font-medium px-2 py-0.5 rounded-full">
              Best price
            </span>
          )}
          {isBestPrice && offer.in_stock && offer.delivery_cost !== null && offer.delivery_threshold !== null && (offer.delivery_cost === 0 || offer.price >= offer.delivery_threshold) && (
            <span className="bg-sage-light text-ink border border-sage text-xs font-medium px-2 py-0.5 rounded-full">
              Free delivery
            </span>
          )}
        </div>
        {/* PER-ROW FRESHNESS. Only on rows that are NOT in stock, where the age is
            the whole point: an in-stock row was re-confirmed by this morning's
            import, and stamping every one of those adds noise to say "today".
            Item 247. */}
        {!offer.in_stock && (() => {
          const seen = lastSeen(offer.last_updated);
          if (!seen) return null;
          return (
            <p className="text-xs text-ink-light">
              Not in our latest feed · last seen {seen.label}
              {seen.days >= 1 && ` (${seen.days} day${seen.days === 1 ? '' : 's'} ago)`}
            </p>
          );
        })()}
        {/* A FLAT RETAILER HAS NO THRESHOLD, AND THE OLD GUARD READ THAT AS
            NOTHING TO SAY.

            The condition was `delivery_cost !== null && delivery_threshold !== null`.
            Debenhams is `delivery_model = 'flat'`, £3.99, threshold NULL -- so the
            guard failed and NO DELIVERY LINE RENDERED, on all 15,047 of its in-stock
            offers.

            THE ASYMMETRY WAS WORSE THAN THE SILENCE. Beside a tiered retailer every
            other row carried a delivery line and this one carried none, so a reader
            comparing rows saw "+£2.95 delivery" against a blank. A blank where every
            neighbour states a charge reads as NO CHARGE. Debenhams charges £3.99 on
            every order at every basket size.

            THIS IS THE INVERSE OF THE FABRICATED £25 DEFAULT, ON THE SAME RETAILER.
            There a value nobody measured was invented and it "made Debenhams look
            free". Here nothing was invented and the absence produced the same
            impression. Same wrong conclusion, opposite mechanism, same retailer --
            which is why removing a bad default was necessary and not sufficient.
            Work-list item 249.

            The flat branch names the charge and NOTHING ELSE: no threshold, because
            none exists, and no implication that a larger basket would change it. */}
        {/* THE DELIVERY BRIDGE. Fires only where BOTH conditions hold:
              gap <= 1.0 x item price   -- bridgeable by roughly one more item like
                                           this one. The MEDIAN gap across the
                                           catalogue is 1.50x, so this deliberately
                                           stays silent on more than half of eligible
                                           offers. A £30 gap on a £9 item is 3.3x and
                                           says nothing.
              gap > delivery_cost       -- otherwise the honest advice is to pay the
                                           delivery. 3,834 offers have a gap SMALLER
                                           than the charge, where prompting would ask
                                           someone to spend more to save less.

            Reach: 19,608 in-stock offers. NOT 23,482 -- that figure was quoted at
            approval and predated its own second condition.

            BEST ROW ONLY, correcting the original acceptance criterion, which said
            every qualifying row. Two bridges on one page compete: the prompt is an
            ARGUMENT, not a data field, so it belongs where the decision is being made
            and nowhere else.

            WORDING STATES OUR ARITHMETIC, NOT THEIR POLICY (item 248). The gap is
            ours -- threshold minus price, a subtraction we perform. The threshold is
            theirs. The line leads with the number we computed and attributes the
            term. It does not say what will happen at their checkout.

            THE THRESHOLD THIS RENDERS IS UNDATED. `retailers.delivery_terms_source`
            is unrecorded for 10 of the 11 active retailers -- only Niche Beauty has
            it, as 'checkout'. Item 248 permits "terms read from their site on this
            date"; WE CANNOT SAY IT, because nobody wrote the date down. The figures
            are almost certainly right and this does not block the prompt, but a term
            nobody dated is a term nobody can re-check, and this line is the most
            prominent place one is rendered. That gap is upstream and is a data task.
            Item 250. */}
        {isBestPrice && offer.in_stock && offer.delivery_model === 'tiered'
          && offer.delivery_threshold !== null && offer.delivery_cost !== null
          && offer.price < offer.delivery_threshold
          && (offer.delivery_threshold - offer.price) <= offer.price
          && (offer.delivery_threshold - offer.price) > offer.delivery_cost && (
          <p className="text-xs text-ink mt-1">
            £{(offer.delivery_threshold - offer.price).toFixed(2)} below {offer.retailer_name}&rsquo;s £{offer.delivery_threshold.toFixed(0)} free-delivery threshold
          </p>
        )}
        {offer.delivery_cost !== null && offer.delivery_model === 'flat' && (
          <p className="text-xs text-ink-light">
            £{offer.delivery_cost.toFixed(2)} delivery on every order
          </p>
        )}
        {offer.delivery_cost !== null && offer.delivery_threshold !== null && !(isBestPrice && offer.in_stock && (offer.delivery_cost === 0 || offer.price >= offer.delivery_threshold)) && (
          <p className="text-xs text-ink-light">
            {offer.delivery_cost === 0
              ? 'Free delivery'
              : offer.price >= offer.delivery_threshold
                ? `Free delivery (over £${offer.delivery_threshold.toFixed(0)})`
                : `+£${offer.delivery_cost.toFixed(2)} delivery (free over £${offer.delivery_threshold.toFixed(0)})`}
          </p>
        )}
      </div>
      {/* shrink-0 ON THE RIGHT BLOCK. Was `flex items-center gap-4 ml-4` with no
          shrink control. The left side is `flex-1 min-w-0` so it yields first, but
          once it has yielded all it can -- a long retailer name plus a long delivery
          string at 390px -- flex begins shrinking THIS block instead. The two price
          lines are the only shrinkable thing in it, because the action carries
          `whitespace-nowrap`, so they were driven underneath the button.
          Two price figures overlapping a tap target. Item 245, phase 0.4. */}
      <div className="flex items-center gap-4 ml-4 shrink-0">
        {/* LEADS WITH THE DELIVERED PRICE so the row and the headline are the same
            quantity. The item price stays, secondary and LABELLED -- it is what the
            retailer charges for the goods and it is what the affiliate commission
            and the JSON-LD offer are based on, so removing it would hide the figure
            those are computed from. Item 245. */}
        <div className="text-right">
          <p className="font-medium text-ink text-lg">£{offer.effective_price.toFixed(2)}</p>
          {offer.effective_price !== offer.price && (
            <p className="text-xs text-ink-light">
              £{offer.price.toFixed(2)} item
            </p>
          )}
        </div>
        {offer.in_stock ? (
          <ClickOutLink
            href={offer.url}
            retailer={offer.retailer_name}
            retailerId={offer.retailer_id}
            productId={productId}
            // price → GA4 value: goods price EXCLUDING delivery (the affiliate
            // commission basis), even though this row's "Best price" chip shows
            // effective_price incl delivery. Kept equal to view_item.value on purpose.
            price={offer.price}
            isBestValue={isBestPrice}
            listPosition={position}
            source="product_page"
            /*
             * NO whitespace-nowrap. THIS BUTTON WAS THE WHOLE-PAGE OVERFLOW.
             *
             * "Buy at {retailer_name}" is unbreakable under nowrap, so its min-content
             * was the full string -- 169px for "Buy at Beauty Flash". This row sits in
             * `grid md:grid-cols-2`, and a grid item's min-width defaults to `auto`, so
             * the track cannot shrink below its content's minimum. At a 390px viewport
             * the 342px column became 403px and the ENTIRE PAGE scrolled horizontally.
             *
             * Measured: 403 with nowrap, 320 without. 10 of 12 live retailers overflowed;
             * only YesStyle and Boots fit. Item 251.
             *
             * The label keeps the retailer name deliberately -- it is what makes the
             * button honest about where the click goes (item 248's attribution rule).
             * Wrapping to two lines is the cost of saying it.
             */
            className="bg-ink text-cream px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gold transition-colors inline-block text-center"
          >
            Buy at {offer.retailer_name}
          </ClickOutLink>
        ) : (
          <span className="text-sm text-ink-light px-5 py-2.5 whitespace-nowrap">
            Out of stock
          </span>
        )}
      </div>
    </div>
  );
}
