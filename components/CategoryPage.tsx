import Link from 'next/link';
import { SiteLayout } from './SiteLayout';
import { ProductCard } from './ProductCard';
import {
  getCategoryStats,
  getTopBrands,
  getFeaturedProducts,
  getSubcategories,
  categoryToSlug,
  type TopCategory,
} from '../lib/queries';

interface Props {
  category: TopCategory;
  displayName: string;
  intro: string;
}

export async function CategoryPage({ category, displayName, intro }: Props) {
  const slug = categoryToSlug(category);
  const [stats, brands, products, subcategories] = await Promise.all([
    getCategoryStats(category),
    getTopBrands(category, 16),
    getFeaturedProducts(category, 24),
    getSubcategories(category),
  ]);

  return (
    <SiteLayout>
      <section className="relative overflow-hidden">
        {/* Hero photo — desktop crop */}
        <div
          className="absolute inset-0 z-0 hidden md:block bg-cover bg-[center_bottom]"
          style={{
            backgroundImage: `url('/images/category-hero/${slug}-desktop.jpg')`,
          }}
        />
        {/* Hero photo — mobile (portrait) crop */}
        <div
          className="absolute inset-0 z-0 md:hidden bg-cover bg-[center_bottom]"
          style={{
            backgroundImage: `url('/images/category-hero/${slug}-mobile.jpg')`,
          }}
        />
        {/* Cream-fade overlay painted on top of the photo — matches homepage hero */}
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage:
              'linear-gradient(to bottom, rgb(250,248,244) 0%, rgba(250,248,244,0.85) 30%, rgba(250,248,244,0.4) 70%, rgba(250,248,244,0.2) 100%)',
          }}
        />
        <div className="relative z-10 max-w-site mx-auto px-6 py-16 md:py-24 text-center">
          <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
            Category
          </p>
          <h1 className="font-serif text-5xl md:text-7xl text-ink mb-6">
            {displayName}
          </h1>
          <p className="text-base md:text-lg text-ink-light max-w-2xl mx-auto mb-10 leading-relaxed">
            {intro}
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
        </div>
      </section>

      {subcategories.length > 0 && (
        <section className="max-w-site mx-auto px-6 py-12">
          <h2 className="font-serif text-3xl text-ink mb-8">Browse by area</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {subcategories.map(sub => (
              <Link
                key={sub.name}
                href={`/${slug}/${sub.name}`}
                className="group bg-warm-white border border-border rounded-2xl p-6 hover:border-gold transition-colors"
              >
                <div className="font-serif text-2xl text-ink capitalize mb-1 group-hover:text-gold transition-colors">
                  {sub.name}
                </div>
                <div className="text-sm text-ink-light">
                  {sub.count.toLocaleString()} products
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {brands.length > 0 && (
        <section className="max-w-site mx-auto px-6 py-12">
          <h2 className="font-serif text-3xl text-ink mb-2">Top brands</h2>
          <p className="text-ink-light mb-8">
            {stats.total_brands.toLocaleString()} brands in {displayName.toLowerCase()}. Here are the most stocked.
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
        <h2 className="font-serif text-3xl text-ink mb-2">Featured products</h2>
        <p className="text-ink-light mb-8">
          Stocked at multiple retailers. Compare prices and save.
        </p>
        {products.length === 0 ? (
          <div className="bg-warm-white border border-border rounded-2xl p-12 text-center text-ink-light">
            No featured products available yet. Check back soon.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>
    </SiteLayout>
  );
}
