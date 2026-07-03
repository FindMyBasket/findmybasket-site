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
import { IMPORTER_RETAILER_IDS, categoryToSlug } from '../../../lib/queries';
import { displayProductTitle } from '../../../lib/format/product-name';
import { ProductDescription } from '../../../components/ProductDescription';
import { ClickOutLink } from '../../../components/ClickOutLink';
import { AmazonLink } from '../../../components/AmazonLink';

export const revalidate = 3600;

const SITE_URL = 'https://www.findmybasket.co.uk';

const CATEGORY_DISPLAY: Record<string, string> = {
  skincare: 'Skincare',
  makeup: 'Makeup',
  hair: 'Hair',
  fragrance: 'Fragrance',
  bath_body: 'Bath & Body',
};

const AMAZON_TAG = 'findmybasket-21';
const EBAY_CAMPID = '7221119';

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

function buildEbaySearchUrl(productName: string, brand: string | null): string {
  const query = displayProductTitle(productName, brand);
  const encoded = encodeURIComponent(query.replace(/\s+/g, ' ').trim());
  return `https://www.ebay.co.uk/sch/i.html?_nkw=${encoded}&campid=${EBAY_CAMPID}`;
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
  // Importer-only products (Stylevana/YesStyle, see IMPORTER_RETAILER_IDS) get a
  // "Specialist import" badge to set delivery/customs expectations.
  const isSpecialistOnly = inStockOffers.length > 0 && inStockOffers.every(o => IMPORTER_RETAILER_IDS.has(o.retailer_id));
  // Offers are sorted in-stock-first then ascending by effective_price, so [0] is
  // the best price and [1] is the next-best. Anchor the saving to the next-best
  // price (not the most expensive) so one outlier high price cannot inflate it.
  const lowestPrice = inStockOffers.length > 0 ? inStockOffers[0].effective_price : null;
  const nextBestPrice = inStockOffers.length > 1 ? inStockOffers[1].effective_price : null;
  const savingPct = lowestPrice && nextBestPrice && nextBestPrice > lowestPrice
    ? Math.round(((nextBestPrice - lowestPrice) / nextBestPrice) * 100)
    : null;

  // Product JSON-LD. An AggregateOffer (price range + count) so Google can render
  // the "£X to £Y" shopping snippet, followed by one Offer per in-stock retailer
  // so the named multi-retailer panel still resolves. A single OutOfStock offer
  // when nothing is in stock (never an empty offers array, never Math.min on []).
  const jsonLdName = displayProductTitle(product.name, product.brand);
  const inStockPrices = inStockOffers.map(o => o.price);
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
      : [{
          '@type': 'Offer',
          priceCurrency: 'GBP',
          availability: 'https://schema.org/OutOfStock',
        }],
  };

  // BreadcrumbList JSON-LD
  const breadcrumbItems = [
    { name: 'Home', url: '/' },
  ];
  if (product.top_category) {
    breadcrumbItems.push({
      name: CATEGORY_DISPLAY[product.top_category] ?? product.top_category,
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
  const ebayUrl = buildEbaySearchUrl(product.name, product.brand);

  return (
  <SiteLayout>
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
                {CATEGORY_DISPLAY[product.top_category] ?? product.top_category}
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
              price and "Add to basket" stay in view while the comparison and
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
                <p className="text-xs uppercase tracking-widest text-ink-light mb-1.5">
                  Best price across {inStockOffers.length} retailer{inStockOffers.length === 1 ? '' : 's'}
                </p>
                <p className="font-serif text-4xl text-ink mb-1">
                  £{lowestPrice.toFixed(2)}
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

            {(product.product_type || product.canonical_size || product.shade) && (
              <div className="flex flex-wrap gap-2 mb-6">
                {product.product_type && (
                  <span className="bg-warm-white border border-border rounded-full px-4 py-1.5 text-xs text-ink-light">
                    {product.product_type}
                  </span>
                )}
                {product.canonical_size && (
                  <span className="bg-warm-white border border-border rounded-full px-4 py-1.5 text-xs text-ink-light">
                    {product.canonical_size}
                  </span>
                )}
                {product.shade && (
                  <span className="bg-warm-white border border-border rounded-full px-4 py-1.5 text-xs text-ink-light">
                    {product.shade}
                  </span>
                )}
              </div>
            )}

            {inStockOffers.length === 0 && offers.length > 0 && (
              <div className="bg-cream border border-border rounded-2xl p-6 mb-6">
                <p className="text-sm text-ink-light">
                  Currently out of stock at all retailers. Check back soon.
                </p>
              </div>
            )}
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
                    <RetailerRow key={`${offer.retailer_id}-${idx}`} offer={offer} isBestPrice={idx === 0} productId={product.id} />
                  ))}
                  {outOfStockOffers.length > 0 && (
                    <>
                      <div className="bg-cream px-6 py-3 border-y border-border text-xs uppercase tracking-widest text-ink-light">
                        Out of stock
                      </div>
                      {outOfStockOffers.map((offer, idx) => (
                        <RetailerRow key={`oos-${offer.retailer_id}-${idx}`} offer={offer} isBestPrice={false} productId={product.id} />
                      ))}
                    </>
                  )}
                </>
              )}
              {/* Amazon is an honest cross-check, not a compared price. */}
              <div className="flex items-center justify-between px-6 py-5 border-t border-border bg-cream/60">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-ink-light italic mb-1">Also check on Amazon</p>
                  <p className="text-xs text-ink-light">Live price varies, not compared</p>
                </div>
                <AmazonLink
                  href={amazonUrl}
                  productId={product.id}
                  source="amazon_crosscheck"
                  className="border border-border text-ink-light px-5 py-2.5 rounded-full text-sm font-medium hover:border-gold hover:text-ink transition-colors whitespace-nowrap"
                />
              </div>
            </div>

            {product.description && <ProductDescription description={product.description} />}
          </div>
        </div>
      </section>

      <section className="max-w-site mx-auto px-6 py-8">
        <h2 className="font-serif text-3xl text-ink mb-2">Also try</h2>
        <p className="text-ink-light mb-6">
          Search for this product on eBay. Prices not compared.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <ClickOutLink
            href={ebayUrl}
            retailer="ebay"
            productId={product.id}
            source="ebay_search"
            className="group bg-warm-white border border-border rounded-2xl p-6 hover:border-gold transition-colors flex items-center justify-between"
          >
            <div>
              <p className="font-medium text-ink mb-1">Search on eBay</p>
              <p className="text-sm text-ink-light">Open results in a new tab</p>
            </div>
            <span className="text-2xl text-ink-light group-hover:text-gold transition-colors">→</span>
          </ClickOutLink>
        </div>
      </section>

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
          action and "Added to basket" state as the in-column button via the
          shared routine store. Desktop keeps the sticky left column instead. */}
      {inStockOffers.length > 0 && (
        <>
          {/* Spacer so the fixed bar never hides the last of the page content. */}
          <div className="h-24 md:hidden" aria-hidden="true" />
          <div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-warm-white/95 backdrop-blur border-t border-border px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <div className="max-w-site mx-auto flex items-center gap-4">
              {lowestPrice !== null && (
                <div className="shrink-0 leading-none">
                  <p className="text-[10px] uppercase tracking-widest text-ink-light mb-1">
                    Best price
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
  productId,
}: {
  offer: import('../../../lib/product-queries').RetailerOffer;
  isBestPrice: boolean;
  productId: number;
}) {
  return (
    <div className={`flex items-center justify-between px-6 py-5 border-b border-border last:border-b-0 ${!offer.in_stock ? 'opacity-60' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-1">
          <span className="font-medium text-ink">{offer.retailer_name}</span>
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
      <div className="flex items-center gap-4 ml-4">
        <div className="text-right">
          <p className="font-medium text-ink text-lg">£{offer.price.toFixed(2)}</p>
          {offer.effective_price !== offer.price && (
            <p className="text-xs text-ink-light">
              £{offer.effective_price.toFixed(2)} with delivery
            </p>
          )}
        </div>
        {offer.in_stock ? (
          <ClickOutLink
            href={offer.url}
            retailer={offer.retailer_name}
            retailerId={offer.retailer_id}
            productId={productId}
            price={offer.price}
            source="product_page"
            className="bg-ink text-cream px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gold transition-colors whitespace-nowrap inline-block"
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
