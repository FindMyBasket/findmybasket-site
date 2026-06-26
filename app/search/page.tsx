import type { Metadata } from 'next';
import { SiteLayout } from '../../components/SiteLayout';
import { runSearch, SEARCH_MIN_QUERY_LEN } from '../../lib/search';

// A search-results page should not be indexed; it is a utility surface, not a
// canonical landing page. The homepage JSON-LD SearchAction still targets it.
export const metadata: Metadata = {
  title: 'Search | FindMyBasket',
  description: 'Search products and brands and compare prices across UK retailers.',
  robots: { index: false, follow: true },
};

// Results depend on the q param and live data; never statically cached.
export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const query = (searchParams.q ?? '').trim();
  const { brands, products } = await runSearch(query);

  const hasResults = brands.length > 0 || products.length > 0;
  const tooShort = query.length > 0 && query.length < SEARCH_MIN_QUERY_LEN;
  const noMatches = query.length >= SEARCH_MIN_QUERY_LEN && !hasResults;

  return (
    <SiteLayout>
      <div className="max-w-[860px] mx-auto px-5 py-10 md:py-14">
        <form action="/search" method="get" role="search" className="flex gap-3 mb-8">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search products and brands..."
            aria-label="Search products and brands"
            minLength={SEARCH_MIN_QUERY_LEN}
            className="flex-1 min-w-0 rounded-full border border-border bg-warm-white px-5 py-3 text-sm text-ink placeholder:text-ink-light outline-none focus:border-gold"
          />
          <button
            type="submit"
            className="rounded-full bg-ink px-6 py-3 text-sm font-medium text-cream hover:bg-gold transition-colors whitespace-nowrap"
          >
            Search
          </button>
        </form>

        {!query && (
          <p className="text-sm text-ink-light">
            Type a product or brand name to compare prices across UK retailers.
          </p>
        )}

        {tooShort && (
          <p className="text-sm text-ink-light">
            Type at least {SEARCH_MIN_QUERY_LEN} characters to search.
          </p>
        )}

        {noMatches && (
          <p className="text-sm text-ink-light">
            No matches for &ldquo;{query}&rdquo;. Try a different product or brand.
          </p>
        )}

        {hasResults && (
          <>
            <h1 className="font-serif text-2xl text-ink mb-6">
              Results for &ldquo;{query}&rdquo;
            </h1>

            {brands.length > 0 && (
              <section className="mb-10">
                <h2 className="text-xs uppercase tracking-widest text-ink-light font-medium mb-3">
                  Brands
                </h2>
                <div className="flex flex-col divide-y divide-border border border-border rounded-2xl overflow-hidden bg-warm-white">
                  {brands.map(brand => (
                    <a
                      key={brand.slug}
                      href={`/brands/${brand.slug}`}
                      className="flex items-center justify-between px-5 py-3 hover:bg-cream transition-colors"
                    >
                      <span className="text-sm text-ink">{brand.display_name}</span>
                      <span className="text-xs text-ink-light">{brand.product_count} products</span>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {products.length > 0 && (
              <section>
                <h2 className="text-xs uppercase tracking-widest text-ink-light font-medium mb-3">
                  Products
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {products.map(product => (
                    <a
                      key={product.id}
                      href={`/product/${product.id}`}
                      className="flex items-center gap-3 px-4 py-3 border border-border rounded-2xl bg-warm-white hover:bg-cream transition-colors"
                    >
                      <div className="w-12 h-12 bg-cream rounded-lg flex-shrink-0 flex items-center justify-center overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={product.image_url || '/placeholder-product.svg'}
                          alt=""
                          className="w-full h-full object-contain"
                          loading="lazy"
                        />
                      </div>
                      <div className="min-w-0">
                        {product.brand && (
                          <p className="text-xs uppercase tracking-wider text-ink-light truncate">
                            {product.brand}
                          </p>
                        )}
                        <p className="text-sm text-ink truncate">{product.name}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </SiteLayout>
  );
}
