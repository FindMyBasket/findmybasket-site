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
import { buildBreadcrumbJsonLd } from '../lib/breadcrumb';
import { categoryToSlug, subcategoryDisplay, type TopCategory } from '../lib/queries';

interface Props {
  category: TopCategory;
  categoryDisplay: string;
  subcategory: string;
  page?: number;
  productType?: string;
}

const PAGE_SIZE = 48;

// THE LABEL COMES FROM lib/queries, NOT FROM CAPITALISING THE SLUG.
//
// This function used to capitalise the slug, which made it the THIRD copy of the
// same derivation and left the drift that SUBCATEGORY_DISPLAY's own comment claims
// to have fixed still live: /supplements offered "Browse by area > Beauty
// supplements" and the destination page was headed "Supplements". The chip and the
// page it links to HAVE been named two ways one click apart this whole time --
// CategoryPage reads the map, this component did not.
//
// Found on 26 August while checking a DIFFERENT claim: item 406 asserted that the
// page body rendered the label correctly and only the metadata was wrong. It did
// not. /bath-and-body/mouth shipped with <h1>Mouth</h1>, and the 125 "Oral Care"
// strings that made the body look right were the product_type on the CARDS, not the
// heading. Item 407.
//
// The h1 no longer carries `capitalize`: labels arrive correctly cased from the map
// ("Sports nutrition", not "Sports Nutrition"), and the fallback capitalises here.
function displaySub(sub: string): string {
  if (!sub) return '';
  const mapped = subcategoryDisplay(sub);
  return mapped === sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : mapped;
}

function buildUrl(
  categorySlug: string,
  subcategory: string,
  options: { type?: string | null; page?: number } = {}
): string {
  const params = new URLSearchParams();
  if (options.type) params.set('type', options.type);
  if (options.page && options.page > 1) params.set('page', String(options.page));
  const qs = params.toString();
  return `/${categorySlug}/${subcategory}${qs ? `?${qs}` : ''}`;
}

export async function SubcategoryPage({ category, categoryDisplay, subcategory, page = 1, productType }: Props) {
  const validSubs = await getValidSubcategories(category);
  if (!validSubs.includes(subcategory)) {
    notFound();
  }

  const [stats, productFacets, brands, productResult] = await Promise.all([
    getSubcategoryStats(category, subcategory),
    getProductTypes(category, subcategory, 12),
    getSubcategoryTopBrands(category, subcategory, 16, productType),
    getSubcategoryProducts(category, subcategory, page, PAGE_SIZE, productType),
  ]);

  if (stats.total_products === 0) {
    notFound();
  }

  if (productType && productResult.totalCount === 0) {
    notFound();
  }

  const totalPages = Math.ceil(productResult.totalCount / PAGE_SIZE);
  const subDisplay = displaySub(subcategory);

  // "supplements supplements". The template interpolates subcategory then category, which
  // reads correctly whenever the two words differ and duplicates when they do not --
  // /supplements/supplements is the case where a category's only real subdivision is
  // itself. "sports supplements" on the sibling page composes correctly by luck, from
  // the same template.
  //
  // COLLAPSED GENERALLY, NOT SPECIAL-CASED FOR SUPPLEMENTS. A rule naming this category
  // would be wrong again the next time a subcategory is named after its parent, and
  // nothing prevents that -- `supplements` became a subcategory value of `supplements`
  // without anyone deciding it should be. Same family as this morning's ${sub}
  // duplication in the article template. Work-list item 152.
  // TWO CALL SITES, AND THE FIRST FIX ONLY CAUGHT ONE. The hero sentence was corrected and
  // deployed while "The most stocked brands in supplements supplements." was still rendering
  // forty lines below it. Both interpolate the same pair in the same order; only the hero was
  // reported, so only the hero was looked at. USE scopePhrase FOR ANY NEW ONE. Item 153.
  const scopePhrase =
    subDisplay.toLowerCase() === categoryDisplay.toLowerCase()
      ? categoryDisplay.toLowerCase()
      : `${subDisplay.toLowerCase()} ${categoryDisplay.toLowerCase()}`;
  // Route slug (identity except bath_body -> bath-and-body). Queries above use the
  // raw `category` DB value; every link/canonical below uses `slug`.
  const slug = categoryToSlug(category);

  // BreadcrumbList structured data
  const breadcrumbItems = [
    { name: 'Home', url: '/' },
    { name: categoryDisplay, url: `/${slug}` },
    { name: subDisplay, url: `/${slug}/${subcategory}` },
  ];
  if (productType) {
    breadcrumbItems.push({
      name: productType,
      url: `/${slug}/${subcategory}?type=${encodeURIComponent(productType)}`,
    });
  }
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(breadcrumbItems);

  return (
    <SiteLayout>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <section className="max-w-site mx-auto px-6 py-16 md:py-24 text-center">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
          <Link href={`/${slug}`} className="hover:text-ink transition-colors">
            {categoryDisplay}
          </Link>
        </p>
        <h1 className="font-serif text-5xl md:text-7xl text-ink mb-6">
          {productType ? `${productType} - ${subDisplay}` : subDisplay}
        </h1>
        <p className="text-base md:text-lg text-ink-light max-w-2xl mx-auto mb-10 leading-relaxed">
          {productType ? (
            <>
              Compare {productType.toLowerCase()} prices in {scopePhrase} across UK retailers. {productResult.totalCount.toLocaleString()} products.
            </>
          ) : (
            <>
              Compare {scopePhrase} prices across UK retailers. {stats.total_products.toLocaleString()} products from {stats.total_brands.toLocaleString()} brands.
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
            </>
          )}
        </div>
      </section>

      {productFacets.types.length > 0 && (
        <section className="max-w-site mx-auto px-6 py-12">
          <div className="flex items-baseline justify-between mb-8 flex-wrap gap-4">
            <h2 className="font-serif text-3xl text-ink">Browse by type</h2>
            {productType && (
              <Link
                href={buildUrl(slug, subcategory)}
                className="text-sm text-ink-light hover:text-ink transition-colors"
              >
                ✕ Clear filter
              </Link>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {productFacets.types.map(pt => {
              const isActive = pt.product_type === productType;
              return (
                <Link
                  key={pt.product_type}
                  href={buildUrl(slug, subcategory, {
                    type: isActive ? null : pt.product_type,
                  })}
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

      {brands.length > 0 && (
        <section className="max-w-site mx-auto px-6 py-12">
          <h2 className="font-serif text-3xl text-ink mb-2">Top brands</h2>
          <p className="text-ink-light mb-8">
            {productType
              ? `The most stocked brands in ${productType.toLowerCase()}.`
              : `The most stocked brands in ${scopePhrase}.`}
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
                    href={buildUrl(slug, subcategory, { type: productType, page: page - 1 })}
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
                    href={buildUrl(slug, subcategory, { type: productType, page: page + 1 })}
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
