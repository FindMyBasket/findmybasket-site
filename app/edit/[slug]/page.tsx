import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SiteLayout } from '../../../components/SiteLayout';
import { ProductCard } from '../../../components/ProductCard';
import { getEdit, listEdits } from '../../../lib/edits';
import {
  getEditStats,
  getEditTopBrands,
  getEditProductTypes,
  getEditProducts,
} from '../../../lib/edit-queries';

export const revalidate = 3600;

const PAGE_SIZE = 48;

function buildUrl(slug: string, options: { type?: string | null; page?: number } = {}): string {
  const params = new URLSearchParams();
  if (options.type) params.set('type', options.type);
  if (options.page && options.page > 1) params.set('page', String(options.page));
  const qs = params.toString();
  return `/edit/${slug}${qs ? `?${qs}` : ''}`;
}

// Pre-render edit pages at build time for SEO + performance
export async function generateStaticParams() {
  return listEdits().map(edit => ({ slug: edit.slug }));
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { type?: string };
}) {
  const edit = getEdit(params.slug);
  if (!edit) return {};
  // Consolidate ?type=/?page= variants to the clean edit URL.
  const canonical = `https://www.findmybasket.co.uk/edit/${params.slug}`;
  if (searchParams.type) {
    return {
      title: `${edit.display_name} ${searchParams.type} best prices UK | FindMyBasket`,
      description: `Compare ${edit.display_name} ${searchParams.type.toLowerCase()} prices across UK retailers. Find the best deal.`,
      alternates: { canonical },
    };
  }
  return {
    title: edit.meta_title,
    description: edit.meta_description,
    alternates: { canonical },
  };
}

export default async function EditPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { page?: string; type?: string };
}) {
  const edit = getEdit(params.slug);
  if (!edit) notFound();

  const page = searchParams.page ? parseInt(searchParams.page, 10) : 1;
  const productType = searchParams.type;

  const [stats, brands, productTypes, productResult] = await Promise.all([
    getEditStats(edit),
    getEditTopBrands(edit, 16),
    getEditProductTypes(edit),
    getEditProducts(edit, page, PAGE_SIZE, productType),
  ]);

  if (productType && productResult.totalCount === 0) {
    notFound();
  }

  const totalPages = Math.ceil(productResult.totalCount / PAGE_SIZE);

  return (
    <SiteLayout>
      <section className="relative overflow-hidden">
        {edit.hero_photo && (
          <>
            {/* Hero photo — desktop crop */}
            <div
              className="absolute inset-0 z-0 hidden md:block bg-cover bg-[center_bottom]"
              style={{
                backgroundImage: `url('/images/category-hero/${edit.slug}-desktop.jpg')`,
              }}
            />
            {/* Hero photo — mobile (portrait) crop */}
            <div
              className="absolute inset-0 z-0 md:hidden bg-cover bg-[center_bottom]"
              style={{
                backgroundImage: `url('/images/category-hero/${edit.slug}-mobile.jpg')`,
              }}
            />
            {/* Cream-fade overlay painted on top of the photo — matches category heroes */}
            <div
              className="absolute inset-0 z-0"
              style={{
                backgroundImage:
                  'linear-gradient(to bottom, rgb(250,248,244) 0%, rgba(250,248,244,0.85) 30%, rgba(250,248,244,0.4) 70%, rgba(250,248,244,0.2) 100%)',
              }}
            />
          </>
        )}
        <div className="relative z-10 max-w-site mx-auto px-6 py-16 md:py-24 text-center">
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

      {productTypes.length > 0 && (
        <section className="max-w-site mx-auto px-6 py-12">
          <div className="flex items-baseline justify-between mb-8 flex-wrap gap-4">
            <h2 className="font-serif text-3xl text-ink">Browse by type</h2>
            {productType && (
              <Link
                href={buildUrl(edit.slug)}
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
                  href={buildUrl(edit.slug, { type: isActive ? null : pt.product_type })}
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
          {productResult.totalCount.toLocaleString()} {productType ? `${productType.toLowerCase()} ` : ''}product{productResult.totalCount === 1 ? '' : 's'}.
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
                    href={buildUrl(edit.slug, { type: productType, page: page - 1 })}
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
                    href={buildUrl(edit.slug, { type: productType, page: page + 1 })}
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
