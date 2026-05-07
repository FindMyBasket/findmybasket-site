import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SiteLayout } from '../../../components/SiteLayout';
import { ProductCard } from '../../../components/ProductCard';
import { getEdit, listEdits } from '../../../lib/edits';
import {
  getEditStats,
  getEditTopBrands,
  getEditFeaturedProducts,
} from '../../../lib/edit-queries';

export const revalidate = 3600;

// Pre-render edit pages at build time for SEO + performance
export async function generateStaticParams() {
  return listEdits().map(edit => ({ slug: edit.slug }));
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const edit = getEdit(params.slug);
  if (!edit) return {};
  return {
    title: edit.meta_title,
    description: edit.meta_description,
  };
}

export default async function EditPage({ params }: { params: { slug: string } }) {
  const edit = getEdit(params.slug);
  if (!edit) notFound();

  const [stats, brands, products] = await Promise.all([
    getEditStats(edit),
    getEditTopBrands(edit, 16),
    getEditFeaturedProducts(edit, 24),
  ]);

  return (
    <SiteLayout>
      <section className="max-w-site mx-auto px-6 py-16 md:py-24 text-center">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
          The Edit
        </p>
        <h1 className="font-serif text-5xl md:text-7xl text-ink mb-6">
          {edit.display_name}
        </h1>
        <p className="text-base md:text-lg text-ink-light max-w-2xl mx-auto mb-10 leading-relaxed">
          {edit.hero_intro}
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

      {brands.length > 0 && (
        <section className="max-w-site mx-auto px-6 py-12">
          <h2 className="font-serif text-3xl text-ink mb-2">Top brands</h2>
          <p className="text-ink-light mb-8">
            The most stocked brands in this edit.
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
          Hand-picked from the {edit.display_name.toLowerCase()} catalogue.
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
