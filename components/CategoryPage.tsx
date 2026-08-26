import Link from 'next/link';
import { SiteLayout } from './SiteLayout';
import { ProductCard } from './ProductCard';
import { buildBreadcrumbJsonLd } from '../lib/breadcrumb';
import {
  getCategoryStats,
  getTopBrands,
  getFeaturedProducts,
  getSubcategories,
  getCrossCategoryBrands,
  categoryToSlug,
  categoryDisplay,
  subcategoryDisplay,
  type TopCategory,
} from '../lib/queries';
import { getProductTypes, getSubcategoryProducts } from '../lib/subcategory-queries';

const SITE_URL = 'https://www.findmybasket.co.uk';

/**
 * Browse state for the category ROOT grid. Absent means the old behaviour: 24
 * featured products, no paging, no filter (item 408 opts routes in one at a time
 * rather than switching six pages at once).
 */
export interface CategoryBrowse {
  page: number;
  productType?: string;
  /** Select the complement of the named type chips (the classifier's default). */
  other?: boolean;
  /** Show only products stocked by more than one retailer. OFF by default. */
  comparable: boolean;
}

interface Props {
  category: TopCategory;
  displayName: string;
  intro: string;
  browse?: CategoryBrowse;
}

const BROWSE_PAGE_SIZE = 48;

function browseUrl(
  slug: string,
  opts: { type?: string | null; other?: boolean; page?: number; comparable?: boolean }
): string {
  const params = new URLSearchParams();
  if (opts.type) params.set('type', opts.type);
  // A separate param, not `?type=other`: a category could legitimately have a product
  // type literally named "Other", and the two would be indistinguishable.
  if (opts.other) params.set('other', '1');
  if (opts.comparable) params.set('comparable', '1');
  if (opts.page && opts.page > 1) params.set('page', String(opts.page));
  const qs = params.toString();
  return `/${slug}${qs ? `?${qs}` : ''}`;
}

export async function CategoryPage({ category, displayName, intro, browse }: Props) {
  // Route slug (identity except bath_body -> bath-and-body). Queries use the raw
  // `category` DB value; links/canonicals use `slug`. The hero-image filenames are
  // keyed by the raw `category` value (e.g. bath_body-desktop.jpg), so the hero
  // <div> below deliberately keeps `${category}`, not `${slug}`.
  const slug = categoryToSlug(category);
  // Facets are fetched BEFORE the grid because the complement query needs the named
  // type list to negate.
  const browseTypes = browse ? await getProductTypes(category, null, 24) : null;
  const complementNames =
    browse?.other && browseTypes?.complement
      ? browseTypes.types.map(t => t.product_type)
      : undefined;

  const [stats, brands, products, subcategories, crossBrands, browseResult] =
    await Promise.all([
      getCategoryStats(category),
      getTopBrands(category, 16),
      // Skipped entirely when browsing: the grid replaces this block, so the RPC would
      // be a second full-category aggregation whose result is never rendered.
      browse ? Promise.resolve([]) : getFeaturedProducts(category, 24),
      getSubcategories(category),
      getCrossCategoryBrands(category, 13),
      browse
        ? getSubcategoryProducts(
            category,
            null,
            browse.page,
            BROWSE_PAGE_SIZE,
            browse.productType,
            browse.comparable,
            complementNames
          )
        : Promise.resolve(null),
    ]);

  // A category that has collapsed to a single subcategory (skincare -> 'face'
  // after the face-only programme) can't browse by area, so surface product_type
  // as the browse facet instead. Reads product_type, NOT subcategory (which is now
  // uniform for skincare). Links into the single subcategory with ?type=, which the
  // subcategory page already handles. Extra query runs only for single-sub categories.
  const singleSub = subcategories.length === 1 ? subcategories[0].name : null;
  const singleSubFacets = singleSub ? await getProductTypes(category, singleSub, 13) : null;
  const productTypes = singleSubFacets?.types ?? [];

  // Structured data. BreadcrumbList (Home > Category) matches SubcategoryPage;
  // CollectionPage marks this as a category listing for the catalogue.
  const totalBrowsePages = browseResult
    ? Math.ceil(browseResult.totalCount / BROWSE_PAGE_SIZE)
    : 0;

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: 'Home', url: '/' },
    { name: displayName, url: `/${slug}` },
  ]);
  const collectionJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${displayName} | FindMyBasket`,
    description: intro,
    url: `${SITE_URL}/${slug}`,
    isPartOf: {
      '@type': 'WebSite',
      name: 'FindMyBasket',
      url: SITE_URL,
    },
  };

  const LinkBlocks = () => (
    <>
      {crossBrands.length > 0 && (
        <section className="max-w-site mx-auto px-6 py-12">
          <h2 className="font-serif text-3xl text-ink mb-2">Brands also in other categories</h2>
          <p className="text-ink-light mb-8">
            Stocked in {displayName.toLowerCase()} and beyond. Explore their full range.
          </p>
          <div className="flex flex-wrap gap-2">
            {crossBrands.map(brand => (
              <Link
                key={brand.slug}
                href={`/brands/${brand.slug}`}
                className="group bg-warm-white border border-border rounded-full pl-5 pr-4 py-2.5 text-sm text-ink hover:border-gold hover:bg-cream transition-colors"
              >
                <span className="font-medium">{brand.name}</span>
                {brand.other_categories.length > 0 && (
                  <span className="text-ink-light ml-2 text-xs">
                    also in {brand.other_categories.map(categoryDisplay).join(', ')}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {subcategories.length > 1 && (
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
                  {subcategoryDisplay(sub.name)}
                </div>
                <div className="text-sm text-ink-light">
                  {sub.count.toLocaleString()} products
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {singleSub && productTypes.length > 0 && (
        <section className="max-w-site mx-auto px-6 py-12">
          <h2 className="font-serif text-3xl text-ink mb-8">Browse by type</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {productTypes.map(pt => (
              <Link
                key={pt.product_type}
                href={`/${slug}/${singleSub}?type=${encodeURIComponent(pt.product_type)}`}
                className="group bg-warm-white border border-border rounded-2xl p-6 hover:border-gold transition-colors"
              >
                <div className="font-serif text-2xl text-ink capitalize mb-1 group-hover:text-gold transition-colors">
                  {pt.product_type}
                </div>
                <div className="text-sm text-ink-light">
                  {pt.count.toLocaleString()} products
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
    </>
  );

  const GridBlock = () => (
    <>
      {browse && browseResult ? (
        <section className="max-w-site mx-auto px-6 py-12">
          <h2 className="font-serif text-3xl text-ink mb-2">
            {browse.productType
              ? `${browse.productType} in ${displayName.toLowerCase()}`
              : browse.other
                ? `Everything else in ${displayName.toLowerCase()}`
                : `All ${displayName.toLowerCase()}`}
          </h2>
          <p className="text-ink-light mb-8">
            {browseResult.totalCount.toLocaleString()} products
            {browse.comparable ? ' stocked by more than one retailer' : ''}.
          </p>

          {/* FILTER BAR. Brand is deliberately NOT here: the brand hubs already answer
              that query, they rank, and they carry four-branch metadata and OpenGraph.
              A ?brand= param would be a second URL answering the same question while
              competing with the page that already answers it. The grid links OUT to the
              hub from each card instead. Item 408. */}
          {/* NO TYPES, NO BAR. supplements has product_type null on all 2,448 rows, so
              the bar is ABSENT rather than rendered empty. Not a special case for that
              category -- the same rule everywhere. Item 408. */}
          {browseTypes && browseTypes.types.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8">
            <Link
              href={browseUrl(slug, { comparable: browse.comparable })}
              className={`px-4 py-2 rounded-full text-sm border transition-colors ${
                browse.productType || browse.other
                  ? 'border-border text-ink-light hover:border-gold hover:text-ink'
                  : 'border-gold bg-gold text-white'
              }`}
            >
              All types
            </Link>
            {(browseTypes?.types ?? []).map(t => (
              <Link
                key={t.product_type}
                href={browseUrl(slug, { type: t.product_type, comparable: browse.comparable })}
                className={`px-4 py-2 rounded-full text-sm border transition-colors ${
                  browse.productType === t.product_type
                    ? 'border-gold bg-gold text-white'
                    : 'border-border text-ink-light hover:border-gold hover:text-ink'
                }`}
              >
                {t.product_type} <span className="opacity-60">{t.count.toLocaleString()}</span>
              </Link>
            ))}
            {/* THE COMPLEMENT CHIP. Present only when every real type is already a chip,
                so "Everything else" can only mean the classifier's default. When a real
                type did not fit, getProductTypes returns complement: null and this
                disappears -- suppressed rather than mislabelled. Item 408. */}
            {browseTypes.complement && (
              <Link
                href={browseUrl(slug, { other: true, comparable: browse.comparable })}
                className={`px-4 py-2 rounded-full text-sm border transition-colors ${
                  browse.other
                    ? 'border-gold bg-gold text-white'
                    : 'border-border text-ink-light hover:border-gold hover:text-ink'
                }`}
              >
                Everything else{' '}
                <span className="opacity-60">{browseTypes.complement.count.toLocaleString()}</span>
              </Link>
            )}
          </div>
          )}

          {/* NAMED FOR WHAT IT DOES, NOT AS A FILTER. "Comparable" is a claim about the
              CATALOGUE -- how many shops we found it in -- not a property of the product,
              so the label says so. Off by default: on, it hides 79% of hair. Item 408. */}
          <div className="mb-8">
            <Link
              href={browseUrl(slug, { type: browse.productType, other: browse.other, comparable: !browse.comparable })}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm border transition-colors ${
                browse.comparable
                  ? 'border-gold bg-gold text-white'
                  : 'border-border text-ink-light hover:border-gold hover:text-ink'
              }`}
            >
              <span aria-hidden="true">{browse.comparable ? '\u2713' : '\u2715'}</span>
              Only show products stocked by more than one retailer
            </Link>
          </div>

          {browseResult.products.length === 0 ? (
            <div className="bg-warm-white border border-border rounded-2xl p-12 text-center text-ink-light">
              {browse.comparable ? (
                <>
                  Nothing in {displayName.toLowerCase()}
                  {browse.productType ? ` under ${browse.productType.toLowerCase()}` : ''} is
                  stocked by more than one retailer yet.{' '}
                  <Link href={browseUrl(slug, { type: browse.productType, other: browse.other })} className="text-gold underline">
                    Show everything
                  </Link>
                  .
                </>
              ) : (
                <>Nothing to show here right now.</>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {browseResult.products.map(product => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>

              {totalBrowsePages > 1 && (
                <nav className="flex items-center justify-center gap-4 mt-12" aria-label="Pagination">
                  {browse.page > 1 && (
                    <Link
                      href={browseUrl(slug, { type: browse.productType, other: browse.other, comparable: browse.comparable, page: browse.page - 1 })}
                      className="px-5 py-2 rounded-full border border-border text-ink-light hover:border-gold hover:text-ink transition-colors"
                    >
                      Previous
                    </Link>
                  )}
                  <span className="text-ink-light text-sm">
                    Page {browse.page.toLocaleString()} of {totalBrowsePages.toLocaleString()}
                  </span>
                  {browse.page < totalBrowsePages && (
                    <Link
                      href={browseUrl(slug, { type: browse.productType, other: browse.other, comparable: browse.comparable, page: browse.page + 1 })}
                      className="px-5 py-2 rounded-full border border-border text-ink-light hover:border-gold hover:text-ink transition-colors"
                    >
                      Next
                    </Link>
                  )}
                </nav>
              )}
            </>
          )}
        </section>
      ) : (
      <section className="max-w-site mx-auto px-6 py-12">
        <h2 className="font-serif text-3xl text-ink mb-2">Featured products</h2>
        <p className="text-ink-light mb-8">
          Stocked at multiple retailers. Compare prices and save.
        </p>
        {products.length === 0 ? (
          // WHY THIS IS NOT "no products". getFeaturedProducts requires
          // retailerCount >= 2, so this branch means "the category has products,
          // none of them comparable yet" — not an empty category. The old copy
          // ("No featured products available yet. Check back soon.") read as a
          // broken page on a live category, which is exactly the state a small
          // category launches in. Say what is actually true instead, using the
          // count the page already loaded — no extra query.
          <div className="bg-warm-white border border-border rounded-2xl p-12 text-center text-ink-light">
            {stats.total_products > 0 ? (
              <>
                All {stats.total_products.toLocaleString()} products in{' '}
                {displayName.toLowerCase()} are currently stocked at a single retailer, so
                there is nothing to compare yet. We add retailers regularly.
              </>
            ) : (
              <>This category is not stocked at any of our retailers right now.</>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map(product => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>
      )}
    </>
  );

  return (
    <SiteLayout>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
      />
      <section className="relative overflow-hidden">
        {/* Hero photo — desktop crop */}
        <div
          className="absolute inset-0 z-0 hidden md:block bg-cover bg-[center_bottom]"
          style={{
            backgroundImage: `url('/images/category-hero/${category}-desktop.jpg')`,
          }}
        />
        {/* Hero photo — mobile (portrait) crop */}
        <div
          className="absolute inset-0 z-0 md:hidden bg-cover bg-[center_bottom]"
          style={{
            backgroundImage: `url('/images/category-hero/${category}-mobile.jpg')`,
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

      {/* ORDER IS BROWSE-DEPENDENT (item 409).
          Without `browse` the link blocks come first, exactly as they always have --
          the five categories that have not opted in are untouched.
          With `browse`, THE GRID GOES DIRECTLY UNDER THE HERO and the link blocks move
          below it. Measured at 390px before the move: 3,103px and 3.68 screens to the
          first product card, filter chips at 2,815px -- 2,560px of furniture in front of
          the thing the page is for. THE HERO IS NOT THE COST: its photo is a background
          on an absolutely-positioned div and occupies NO layout height at all. */}
      {browse ? (
        <>
          <GridBlock />
          <LinkBlocks />
        </>
      ) : (
        <>
          <LinkBlocks />
          <GridBlock />
        </>
      )}
    </SiteLayout>
  );
}
