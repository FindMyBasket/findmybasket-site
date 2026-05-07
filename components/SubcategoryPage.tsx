import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteLayout } from './SiteLayout';
import { ProductCard } from './ProductCard';
import {
  getSubcategoryStats,
  getSubcategoryTopBrands,
  getSubcategoryProducts,
  getProductTypes,
  getValidSubcategories,
} from '../lib/subcategory-queries';
import type { TopCategory } from '../lib/queries';

interface Props {
  category: TopCategory;
  categoryDisplay: string;
  subcategory: string;
  page?: number;
}

const PAGE_SIZE = 48;

// Capitalise first letter of a subcategory string for display
function displaySub(sub: string): string {
  if (!sub) return '';
  return sub.charAt(0).toUpperCase() + sub.slice(1);
}

export async function SubcategoryPage({ category, categoryDisplay, subcategory, page = 1 }: Props) {
  // Validate subcategory exists for this category
  const validSubs = await getValidSubcategories(category);
  if (!validSubs.includes(subcategory)) {
    notFound();
  }

  const [stats, productTypes, brands, productResult] = await Promise.all([
    getSubcategoryStats(category, subcategory),
    getProductTypes(category, subcategory, 12),
    getSubcategoryTopBrands(category, subcategory, 16),
    getSubcategoryProducts(category, subcategory, page, PAGE_SIZE),
  ]);

  const totalPages = Math.ceil(productResult.totalCount / PAGE_SIZE);
  const subDisplay = displaySub(subcategory);

  return (
    <SiteLayout>
      <section className="max-w-site mx-auto px-6 py-16 md:py-24 text-center">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
          <Link href={`/${category}`} className="hover:text-ink transition-colors">
            {categoryDisplay}
          </Link>
        </p>
        <h1 className="font-serif text-5xl md:text-7xl text-ink mb-6 capitalize">
          {subDisplay} {categoryDisplay.toLowerCase()}
        </h1>
        <p className="text-base md:text-lg text-ink-light max-w-2xl mx-auto mb-10 leading-relaxed">
          Compare {subDisplay.toLowerCase()} {categoryDisplay.toLowerCase()} prices across UK retailers. {stats.total_products.toLocaleString()} products from {stats.total_brands.toLocaleString()} brands.
        </p>
        <div className="inline-flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-ink-light">
          <span>
            <strong className="text-ink font-semibold">
              {stats.total_products.toLocaleString()}
            </strong>{' '}
            products
          </span>
          <span className="text-ink-light/40">·</span>
          <span>
            <strong className="text-ink font-semibold">
              {stats.total_brands.toLocaleString()}
            </strong>{' '}
            brands
          </span>
          <span className="text-ink-light/40">·</span>
          <span>
            <strong className="text-ink font-semibold">
              {stats.total_retailers}
            </strong>{' '}
            retailers
          </span>
        </div>
      </section>

      {productTypes.length > 0 && (
        <section className="max-w-site mx-auto px-6 py-12">
          <h2 className="font-serif text-3xl text-ink mb-8">Browse by type</h2>
          <div className="flex flex-wrap gap-2">
            {productTypes.map(pt => (
              <span
                key={pt.product_type}
                className="bg-warm-white border border-border rounded-full px-5 py-2.5 text-sm text-ink"
              >
                {pt.product_type}
                <span className="text-ink-light ml-1.5 text-xs">{pt.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {brands.length > 0 && (
        <section className="max-w-site mx-auto px-6 py-12">
          <h2 className="font-serif text-3xl text-ink mb-2">Top brands</h2>
          <p className="text-ink-light mb-8">
            The most stocked brands in {subDisplay.toLowerCase()} {categoryDisplay.toLowerCase()}.
          </p>
          <div className="flex flex-wrap gap-2">
            {brands.map(brand => (
              <Link
                key={brand.slug}
                href={`/brands/${brand.slug}`}
                className="bg-warm-white border border-border rounded-full px-5 py-2.5 text-sm text-ink hover:border-gold hover:bg-cream transition-colors"
              >
                {brand.name}
                <span className="text-ink-light ml-1.5 text-xs">{brand.product_count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="max-w-site mx-auto px-6 py-12">
        <h2 className="font-serif text-3xl text-ink mb-2">Products</h2>
        <p className="text-ink-light mb-8">
          {page > 1 ? `Page ${page} of ${totalPages}. ` : ''}
          {productResult.totalCount.toLocaleString()} total products in this subcategory.
        </p>
        {productResult.products.length === 0 ? (
          <div className="bg-warm-white border border-border rounded-2xl p-12 text-center text-ink-light">
            No products available yet. Check back soon.
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
                    href={`/${category}/${subcategory}${page > 2 ? `?page=${page - 1}` : ''}`}
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
                    href={`/${category}/${subcategory}?page=${page + 1}`}
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
