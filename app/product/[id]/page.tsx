import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteLayout } from '../../../components/SiteLayout';
import { ProductCard } from '../../../components/ProductCard';
import { SaveToRoutineButton } from '../../../components/SaveToRoutineButton';
import {
  getProductById,
  getRetailerOffers,
  getRelatedProducts,
} from '../../../lib/product-queries';
import { buildBreadcrumbJsonLd } from '../../../lib/breadcrumb';

export const revalidate = 3600;

const CATEGORY_DISPLAY: Record<string, string> = {
  skincare: 'Skincare',
  makeup: 'Makeup',
  hair: 'Hair',
};

const AMAZON_TAG = 'findmybasket-21';
const EBAY_CAMPID = '7221119';

function buildAmazonSearchUrl(productName: string, brand: string | null): string {
  const query = brand ? `${brand} ${productName}` : productName;
  const encoded = encodeURIComponent(query.replace(/\s+/g, ' ').trim());
  return `https://www.amazon.co.uk/s?k=${encoded}&tag=${AMAZON_TAG}`;
}

function buildEbaySearchUrl(productName: string, brand: string | null): string {
  const query = brand ? `${brand} ${productName}` : productName;
  const encoded = encodeURIComponent(query.replace(/\s+/g, ' ').trim());
  return `https://www.ebay.co.uk/sch/i.html?_nkw=${encoded}&campid=${EBAY_CAMPID}`;
}

function displaySub(sub: string | null): string {
  if (!sub) return '';
  return sub.charAt(0).toUpperCase() + sub.slice(1);
}

export async function generateMetadata({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) return { title: 'Product not found | FindMyBasket' };

  const product = await getProductById(id);
  if (!product) return { title: 'Product not found | FindMyBasket' };

  const offers = await getRetailerOffers(id);
  const lowestPrice = offers.length > 0 ? offers[0].effective_price : null;

  const titleBits = [];
  if (product.brand) titleBits.push(product.brand);
  titleBits.push(product.name);
  const baseTitle = titleBits.join(' ');
  const priceTag = lowestPrice ? ` from £${lowestPrice.toFixed(2)}` : '';

  return {
    title: `${baseTitle}${priceTag} | FindMyBasket`,
    description: `Compare ${baseTitle} prices across ${offers.length} UK retailers. ${
      lowestPrice ? `Best price £${lowestPrice.toFixed(2)}.` : ''
    } Free price comparison.`,
  };
}

export default async function ProductPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (Number.isNaN(id)) notFound();

  const product = await getProductById(id);
  if (!product) notFound();

  const [offers, related] = await Promise.all([
    getRetailerOffers(id),
    getRelatedProducts(product, 6),
  ]);

  const inStockOffers = offers.filter(o => o.in_stock);
  const outOfStockOffers = offers.filter(o => !o.in_stock);
  // Stylevana-only products get a "Specialist import" badge to set expectations
  const STYLEVANA_ID = 11;
  const isSpecialistOnly = inStockOffers.length > 0 && inStockOffers.every(o => o.retailer_id === STYLEVANA_ID);
  const lowestPrice = inStockOffers.length > 0 ? inStockOffers[0].effective_price : null;
  const highestPrice = inStockOffers.length > 0
    ? Math.max(...inStockOffers.map(o => o.effective_price))
    : null;
  const savingPct = lowestPrice && highestPrice && highestPrice > lowestPrice
    ? Math.round(((highestPrice - lowestPrice) / highestPrice) * 100)
    : 0;

  // Product JSON-LD
  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    image: product.image_url ?? undefined,
    brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
    sku: product.ean ?? `fmb-${product.id}`,
    offers: inStockOffers.length > 0
      ? {
          '@type': 'AggregateOffer',
          priceCurrency: 'GBP',
          lowPrice: lowestPrice?.toFixed(2),
          highPrice: highestPrice?.toFixed(2),
          offerCount: inStockOffers.length,
          availability: 'https://schema.org/InStock',
        }
      : undefined,
  };

  // BreadcrumbList JSON-LD
  const breadcrumbItems = [
    { name: 'Home', url: '/' },
  ];
  if (product.top_category) {
    breadcrumbItems.push({
      name: CATEGORY_DISPLAY[product.top_category] ?? product.top_category,
      url: `/${product.top_category}`,
    });
  }
  if (product.subcategory && product.top_category) {
    breadcrumbItems.push({
      name: displaySub(product.subcategory),
      url: `/${product.top_category}/${product.subcategory}`,
    });
  }
  breadcrumbItems.push({
    name: product.brand ? `${product.brand} ${product.name}` : product.name,
    url: `/product/${product.id}`,
  });
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(breadcrumbItems);

  const routineItem = {
    id: product.id,
    name: product.name,
    brand: product.brand ?? '',
    category: product.product_type ?? '',
  };

  const amazonUrl = buildAmazonSearchUrl(product.name, product.brand);
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

      <section className="max-w-site mx-auto px-6 py-12">
        <nav className="text-sm text-ink-light mb-8 flex flex-wrap gap-1.5 items-center">
          {product.top_category && (
            <>
              <Link href={`/${product.top_category}`} className="hover:text-ink transition-colors">
                {CATEGORY_DISPLAY[product.top_category] ?? product.top_category}
              </Link>
              <span>›</span>
            </>
          )}
          {product.subcategory && product.top_category && (
            <>
              <Link
                href={`/${product.top_category}/${product.subcategory}`}
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

        <div className="grid md:grid-cols-2 gap-12 mb-12">
          <div className="bg-warm-white border border-border rounded-2xl aspect-square flex items-center justify-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.image_url || '/placeholder-product.svg'}
              alt={product.name}
              className="max-w-full max-h-full object-contain p-8"
              onError={(e) => {
             e.currentTarget.src = '/placeholder-product.svg';
             e.currentTarget.onerror = null;
             }}
            />
            )}
          </div>

          <div>
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
            <h1 className="font-serif text-4xl md:text-5xl text-ink mb-6 leading-tight">
              {product.name}
            </h1>
            {isSpecialistOnly && (
              <div className="inline-flex items-center gap-2 bg-cream border border-border rounded-full px-4 py-1.5 mb-6 text-xs text-ink-light">
                <span>✦ Specialist import · longer delivery times may apply</span>
              </div>
            )}

            {(product.product_type || product.canonical_size || product.shade) && (
              <div className="flex flex-wrap gap-2 mb-8">
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

            {lowestPrice !== null && (
              <div className="bg-cream border border-border rounded-2xl p-6 mb-4">
                <p className="text-xs uppercase tracking-widest text-ink-light mb-1.5">
                  Best price across {inStockOffers.length} retailer{inStockOffers.length === 1 ? '' : 's'}
                </p>
                <p className="font-serif text-4xl text-ink mb-1">
                  £{lowestPrice.toFixed(2)}
                </p>
                {savingPct >= 5 && highestPrice && (
                  <p className="text-sm text-sage">
                    Save {savingPct}% vs highest price (£{highestPrice.toFixed(2)})
                  </p>
                )}
              </div>
            )}

            {inStockOffers.length > 0 && (
              <SaveToRoutineButton product={routineItem} />
            )}

            {inStockOffers.length === 0 && offers.length > 0 && (
              <div className="bg-cream border border-border rounded-2xl p-6 mb-6">
                <p className="text-sm text-ink-light">
                  Currently out of stock at all retailers. Check back soon.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="max-w-site mx-auto px-6 py-12">
        <h2 className="font-serif text-3xl text-ink mb-2">Compare prices</h2>
        <p className="text-ink-light mb-8">
          Live prices from UK retailers. Click through to buy.
        </p>

        {offers.length === 0 ? (
          <div className="bg-warm-white border border-border rounded-2xl p-12 text-center text-ink-light">
            No retailer prices available for this product yet.
          </div>
        ) : (
          <div className="bg-warm-white border border-border rounded-2xl overflow-hidden">
            {inStockOffers.map((offer, idx) => (
              <RetailerRow key={`${offer.retailer_id}-${idx}`} offer={offer} isBestPrice={idx === 0} />
            ))}
            {outOfStockOffers.length > 0 && (
              <>
                <div className="bg-cream px-6 py-3 border-y border-border text-xs uppercase tracking-widest text-ink-light">
                  Out of stock
                </div>
                {outOfStockOffers.map((offer, idx) => (
                  <RetailerRow key={`oos-${offer.retailer_id}-${idx}`} offer={offer} isBestPrice={false} />
                ))}
              </>
            )}
          </div>
        )}
      </section>

      <section className="max-w-site mx-auto px-6 py-12">
        <h2 className="font-serif text-3xl text-ink mb-2">Also try</h2>
        <p className="text-ink-light mb-8">
          Search for this product on Amazon and eBay. Prices not compared.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <a
            href={amazonUrl}
            target="_blank"
            rel="nofollow sponsored noopener"
            className="group bg-warm-white border border-border rounded-2xl p-6 hover:border-gold transition-colors flex items-center justify-between"
          >
            <div>
              <p className="font-medium text-ink mb-1">Search on Amazon</p>
              <p className="text-sm text-ink-light">Open results in a new tab</p>
            </div>
            <span className="text-2xl text-ink-light group-hover:text-gold transition-colors">→</span>
          </a>
          <a
            href={ebayUrl}
            target="_blank"
            rel="nofollow sponsored noopener"
            className="group bg-warm-white border border-border rounded-2xl p-6 hover:border-gold transition-colors flex items-center justify-between"
          >
            <div>
              <p className="font-medium text-ink mb-1">Search on eBay</p>
              <p className="text-sm text-ink-light">Open results in a new tab</p>
            </div>
            <span className="text-2xl text-ink-light group-hover:text-gold transition-colors">→</span>
          </a>
        </div>
      </section>

      {related.length > 0 && (
        <section className="max-w-site mx-auto px-6 py-12">
          <h2 className="font-serif text-3xl text-ink mb-2">Related products</h2>
          <p className="text-ink-light mb-8">
            More from {product.brand ?? 'this category'}.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {related.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </SiteLayout>
  );
}

function RetailerRow({
  offer,
  isBestPrice,
}: {
  offer: import('../../../lib/product-queries').RetailerOffer;
  isBestPrice: boolean;
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
        </div>
        {offer.delivery_cost !== null && offer.delivery_threshold !== null && (
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
          <a
            href={offer.url}
            target="_blank"
            rel="nofollow sponsored noopener"
            className="bg-ink text-cream px-5 py-2.5 rounded-full text-sm font-medium hover:bg-gold transition-colors whitespace-nowrap"
          >
            Buy at {offer.retailer_name}
          </a>
        ) : (
          <span className="text-sm text-ink-light px-5 py-2.5 whitespace-nowrap">
            Out of stock
          </span>
        )}
      </div>
    </div>
  );
}
