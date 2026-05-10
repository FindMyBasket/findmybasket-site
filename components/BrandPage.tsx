import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteLayout } from './SiteLayout';
import { ProductCard } from './ProductCard';
import {
  findBrandBySlug,
  getBrandStats,
  getBrandProductTypes,
  getBrandProducts,
} from '../lib/brand-queries';

interface Props {
  slug: string;
  page?: number;
  productType?: string;
}

const PAGE_SIZE = 48;

const CATEGORY_DISPLAY: Record<string, string> = {
  skincare: 'Skincare',
  makeup: 'Makeup',
  hair: 'Hair',
};

function buildUrl(slug: string, options: { type?: string | null; page?: number } = {}): string {
  const params = new URLSearchParams();
  if (options.type) params.set('type', options.type);
  if (options.page && options.page > 1) params.set('page', String(options.page));
  const qs = params.toString();
  return `/brands/${slug}${qs ? `?${qs}` : ''}`;
}

export async function BrandPage({ slug, page = 1, productType }: Props) {
  const brand = await findBrandBySlug(slug);
  if (!brand) notFound();

  const [stats, productTypes, productResult] = await Promise.all([
    getBrandStats(brand.normalised_brand),
    getBrandProductTypes(brand.normalised_brand, 12),
    getBrandProducts(brand.normalised_brand, page, PAGE_SIZE, productType),
  ]);

  // If a filter is active but no products match, treat as 404
  if (productType && productResult.totalCount === 0) {
    notFound();
  }

  const totalPages = Math.ceil(productResult.totalCount / PAGE_SIZE);

  const catSummary = stats.category_breakdown
    .map(({ category, count }) => `${CATEGORY_DISPLAY[category] ?? category} (${count})`)
    .join(', ');

  return (
    <SiteLayout>
      <section className="max-w-site mx-auto px-6 py-16 md:py-24 text-center">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
          Brand
        </p>
        <h1 className="font-serif text-5xl md:text-7xl text-ink mb-6">
          {productType ? `${brand.display_name} - ${productType}` : brand.display_name}
        </h1>
        <p className="text-base md:text-lg text-ink-light max-w-2xl mx-auto mb-10 leading-relaxed">
          {productType ? (
            <>
              Compare {brand.display_name} {productType.toLowerCase()} prices across UK retailers. {productResult.totalCount.toLocaleString()} {productType.toLowerCase()} products.
            </>
          ) : (
            <>
              Compare {brand.display_name} prices across UK retailers.
              {stats.total_products > 0 && (
                <> {stats.total_products.toLocaleString()} products{catSummary ? ` across ${catSummary.toLowerCase()}` : ''}.</>
              )}
            </>
          )}
        </p>
        <div className="inline-flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-ink-light">
          <span>
            <strong className="text-ink font-semibold">
              {(productType ? productResult.totalCount : stats.total_products).toLocaleString()}
            </strong>{' '}
            products
          </span>
          {!productType && (
            <>
              <span className="text-ink-light/40">·</span>
              <span>
                <strong className="text-ink font-semibold">
                  {stats.total_retailers}
                </strong>{' '}
                retailers
              </span>
            </>
          )}
        </div>
      </section>

      {!productType && stats.category_breakdown.length > 1 && (
        <section className="max-w-site mx-auto px-6 py-12">
          <h2 className="font-serif text-3xl text-ink mb-8">Browse by category</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {stats.category_breakdown.map(({ category, count }) => (
              <Link
                key={category}
                href={`/${category}`}
                className="group bg-warm-white border border-border rounded-2xl p-6 hover:border-gold transition-colors"
              >
                <div className="font-serif text-2xl text-ink capitalize mb-1 group-hover:text-gold transition-colors">
                  {CATEGORY_DISPLAY[category] ?? category}
                </div>
                <div className="text-sm text-ink-light">
                  {count.toLocaleString()} products
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {productTypes.length > 0 && (
        <section className="max-w-site mx-auto px-6 py-12">
          <div className="flex items-baseline justify-between mb-8 flex-wrap gap-4">
            <h2 className="font-serif text-3xl text-ink">Product types</h2>
            {productType && (
              <Link
                href={buildUrl(slug)}
                className="text-sm text-ink-light hover:text-ink transition-colors"
              >
                ✕ Clear filter
              </Link>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {productTypes.map(pt => {
              const isActive = pt.product_type === productType;
              return (
                <Link
                  key={pt.product_type}
                  href={buildUrl(slug, { type: isActive ? null : pt.product_type })}
                  className={`rounded-full px-5 py-2.5 text-sm transition-colors border ${
                    isActive
                      ? 'bg-ink text-cream border-ink hover:bg-gold hover:border-gold'
                      : 'bg-warm-white text-ink border-border hover:border-gold hover:bg-cream'
                  }`}
                >
                  {pt.product_type}
                  <span className={`ml-1.5 text-xs ${isActive ? 'text-cream/70' : 'text-ink-light'}`}>
                    {pt.count}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="max-w-site mx-auto px-6 py-12">
        <h2 className="font-serif text-3xl text-ink mb-2">Products</h2>
        <p className="text-ink-light mb-8">
          {page > 1 ? `Page ${page} of ${totalPages}. ` : ''}
          {productResult.totalCount.toLocaleString()} {productType ? `${productType.toLowerCase()} ` : ''}{brand.display_name} product{productResult.totalCount === 1 ? '' : 's'}.
        </p>
        {productResult.products.length === 0 ? (
          <div className="bg-warm-white border border-border rounded-2xl p-12 text-center text-ink-light">
            No products available yet.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {productResult.products.map(product => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2 mt-12">
                {page > 1 && (
                  <Link
                    href={buildUrl(slug, { type: productType, page: page - 1 })}
                    className="px-5 py-2.5 bg-warm-white border border-border rounded-full text-sm text-ink hover:border-gold transition-colors"
                  >
                    ← Previous
                  </Link>
                )}
                <span className="text-sm text-ink-light px-4">
                  Page {page} of {totalPages}
                </span>
                {page < totalPages && (
                  <Link
                    href={buildUrl(slug, { type: productType, page: page + 1 })}
                    className="px-5 py-2.5 bg-warm-white border border-border rounded-full text-sm text-ink hover:border-gold transition-colors"
                  >
                    Next →
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </SiteLayout>
  );
}
