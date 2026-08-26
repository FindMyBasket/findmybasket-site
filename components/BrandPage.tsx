import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { SiteLayout } from './SiteLayout';
import { ProductCard } from './ProductCard';
import {
  findBrandBySlug,
  resolveBrandAliasSlug,
  getBrandStats,
  getBrandProductTypes,
  getBrandProducts,
  getBrandMetadataFacts,
} from '../lib/brand-queries';
import { buildBreadcrumbJsonLd } from '../lib/breadcrumb';
import { categoryToSlug, categoryDisplay } from '../lib/queries';

interface Props {
  slug: string;
  page?: number;
  productType?: string;
  category?: string;
}

const PAGE_SIZE = 48;

function buildUrl(
  slug: string,
  options: { type?: string | null; category?: string | null; page?: number } = {}
): string {
  const params = new URLSearchParams();
  if (options.type) params.set('type', options.type);
  if (options.category) params.set('category', options.category);
  if (options.page && options.page > 1) params.set('page', String(options.page));
  const qs = params.toString();
  return `/brands/${slug}${qs ? `?${qs}` : ''}`;
}

export async function BrandPage({ slug, page = 1, productType, category }: Props) {
  const brand = await findBrandBySlug(slug);
  if (!brand) {
    // FIX 1: a slug nobody serves may be a RENAMED brand whose fold is already recorded in
    // brand_aliases. 301 to the canonical rather than render there: brand_aliases is a FOLD,
    // not a synonym set -- loreal-paris, loreal, loreal-men, lor-al and
    // lor-al-paris-dermo-expertise all fold to one brand, so rendering would put five URLs on
    // identical content. With 54,056 pages already crawled-and-declined, adding duplicate
    // surfaces is the wrong direction. A redirect makes it one fact instead of five claims.
    //
    // resolveBrandAliasSlug returns null on a dead target, a cycle, or an exhausted hop cap,
    // and this path then serves the correct 404. Item 271.
    const canonical = await resolveBrandAliasSlug(slug);
    if (canonical) permanentRedirect(`/brands/${canonical}`);
    notFound();
  }

  const [stats, productTypes, productResult, facts] = await Promise.all([
    getBrandStats(brand.normalised_brand),
    getBrandProductTypes(brand.normalised_brand),
    getBrandProducts(brand.normalised_brand, page, PAGE_SIZE, productType, category),
    // Same facts the search-result title branches on. Fetched here so the PAGE can
    // branch on them too -- see the intro copy below. Item 357.
    getBrandMetadataFacts(brand.normalised_brand),
  ]);

  // A filter is either a fine-grained product_type or a coarse top_category.
  // `filterLabel` is what the page shows in headings/breadcrumbs; `hasFilter`
  // toggles the filtered-vs-unfiltered layout.
  const filterLabel =
    productType ?? (category ? categoryDisplay(category) : undefined);
  const hasFilter = Boolean(filterLabel);

  // FIX 2B: AN EMPTY FILTER REDIRECTS TO THE HUB, IT DOES NOT 404.
  //
  // We generate these URLs ourselves -- buildUrl() below emits ?type= links from the types
  // that currently have products. A type empties, the link we already published becomes a
  // 404, and Google keeps returning to it. Measured 24 Aug: /brands/clean-clear?type=Cleanser
  // 404 while /brands/clean-clear serves 200; ?page=2 on a brand that shrank does the same.
  //
  // 301 rather than render-empty: a permanently crawlable thin-page surface is the wrong
  // answer when 54,056 pages are already crawled-and-declined. And the hub genuinely answers
  // a brand query, so this is a redirect INTO the right answer rather than a wrong one --
  // the distinction item 264 turned on. Item 271.
  if (hasFilter && productResult.totalCount === 0) {
    permanentRedirect(`/brands/${slug}`);
  }

  const totalPages = Math.ceil(productResult.totalCount / PAGE_SIZE);

  const catSummary = stats.category_breakdown
    .map(({ category, count }) => `${categoryDisplay(category)} (${count})`)
    .join(', ');

  // "Available in" categories. Apply the same >= 5 threshold as the cross-category
  // chip selection (PR #74 Change 1) so the same brand-category signal is surfaced
  // consistently and thin presence (e.g. The Ordinary's 3 makeup products) is
  // suppressed. category_breakdown is pre-sorted by count desc. Fallback: a niche
  // brand whose every category is below the threshold still shows its top 1-2, so
  // the line is never empty when the brand has any products.
  const AVAILABILITY_MIN = 5;
  const availableCategories =
    stats.category_breakdown.filter(c => c.count >= AVAILABILITY_MIN).length > 0
      ? stats.category_breakdown.filter(c => c.count >= AVAILABILITY_MIN)
      : stats.category_breakdown.slice(0, 2);

  // BreadcrumbList structured data
  const breadcrumbItems = [
    { name: 'Home', url: '/' },
    { name: 'Brands', url: '/brands' },
    { name: brand.display_name, url: `/brands/${slug}` },
  ];
  if (hasFilter) {
    breadcrumbItems.push({
      name: filterLabel!,
      url: buildUrl(slug, productType ? { type: productType } : { category }),
    });
  }
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(breadcrumbItems);

  // ── WHAT THE PAGE SAYS IT HAS, RATHER THAN WHAT THE SEARCH RESULT PROMISED ──────────
  //
  // Until 26 Aug 2026 this was ONE unconditional sentence -- "Compare {Brand} prices
  // across UK retailers" -- on every hub. The metadata had already been split into
  // branches precisely because asserting an absent comparison was judged wrong, so a
  // visitor clicking "Where to buy Habi in the UK" landed on "Compare Habi prices across
  // UK retailers", directly above a stat line reading "40 products · 1 retailers".
  // Measured: 107 of 198 impression-earning hubs have a single stockist and could not
  // compare anything. ITEM 346's SHAPE -- the distinction drawn in one place and never
  // carried to the other. Item 357.
  //
  // FOUR STATES ON THE PAGE AGAINST THREE IN THE METADATA, AND THAT IS CORRECT RATHER
  // THAN A MISMATCH. The search result knows only that `stockists` is 0; the page also
  // knows whether any PRODUCTS exist, because it has them in front of it. So it can tell
  // "we carry the range, nothing is in stock today" (C) from "we have no pricing for this
  // brand at all" (D), which are different facts and deserve different sentences. A
  // surface that can see more should say more.
  //
  // AND THE TEMPLATES ARE NOT REUSED HERE ON PURPOSE. brandMetadataCopy writes for a
  // ~200-character search result and has to spend its budget on the claim. The page has
  // room to give the reason as well, which is what turns "no comparison" from an apology
  // into information.
  // CHIP CAP. Uncapped, a broad brand renders 27 chips in one wrap -- Tonymoly does --
  // and the tail is types with one or two products each. The first TYPE_CHIP_CAP by count
  // carry the demand; the rest stay reachable behind a <details>, because CAPPING MUST NOT
  // REMOVE A ROUTE. Every chip is a URL we already publish and Google already crawls;
  // dropping one would turn a live filter into an orphan, which is item 271's defect in
  // reverse. Item 358.
  const TYPE_CHIP_CAP = 12;
  const visibleTypes = productTypes.slice(0, TYPE_CHIP_CAP);
  const overflowTypes = productTypes.slice(TYPE_CHIP_CAP);

  const soleRetailer = facts.sole_retailer;
  const introCopy =
    facts.comparable > 0 ? (
      <>
        Compare {brand.display_name} prices across {facts.stockists} UK retailer
        {facts.stockists === 1 ? '' : 's'}, delivery included.{' '}
        {facts.comparable.toLocaleString()} of {stats.total_products.toLocaleString()} products{' '}
        {facts.comparable === 1 ? 'is' : 'are'} stocked by more than one retailer, so you can see
        which works out cheapest delivered.
      </>
    ) : facts.stockists > 0 ? (
      <>
        {brand.display_name} is stocked by {soleRetailer ?? 'one retailer'} from the UK retailers we
        compare. There&rsquo;s nothing to compare on price yet, so here&rsquo;s the range with{' '}
        {soleRetailer ?? 'their'} delivery included in every total. We&rsquo;ll show a comparison as
        soon as a second retailer lists it.
      </>
    ) : stats.total_products > 0 ? (
      <>
        We track {brand.display_name} across the UK retailers we compare. Nothing from the range is
        in stock right now. The products below are the ones we watch, and prices return here with
        delivery included when they do.
      </>
    ) : (
      <>
        We track {brand.display_name} across the UK retailers we compare. We don&rsquo;t have current
        pricing for the range, so there&rsquo;s nothing to compare yet.
      </>
    );

  return (
    <SiteLayout>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <section className="max-w-site mx-auto px-6 py-16 md:py-24 text-center">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
          Brand
        </p>
        <h1 className="font-serif text-5xl md:text-7xl text-ink mb-6">
          {hasFilter ? `${brand.display_name} - ${filterLabel}` : brand.display_name}
        </h1>
        <p className="text-base md:text-lg text-ink-light max-w-2xl mx-auto mb-10 leading-relaxed">
          {hasFilter ? (
            <>
              Compare {brand.display_name} {filterLabel!.toLowerCase()} prices across UK retailers. {productResult.totalCount.toLocaleString()} {filterLabel!.toLowerCase()} products.
            </>
          ) : (
            introCopy
          )}
        </p>
        <div className="inline-flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-ink-light">
          <span>
            <strong className="text-ink font-semibold">
              {(hasFilter ? productResult.totalCount : stats.total_products).toLocaleString()}
            </strong>{' '}
            product{(hasFilter ? productResult.totalCount : stats.total_products) === 1 ? '' : 's'}
          </span>
          {!hasFilter && (
            <>
              <span className="text-ink-light/40">·</span>
              <span>
                <strong className="text-ink font-semibold">
                  {stats.total_retailers}
                </strong>{' '}
                retailer{stats.total_retailers === 1 ? '' : 's'}
              </span>
            </>
          )}
        </div>

        {/* Cross-category signal: which top categories this brand sits in, each
            linking to that category landing (strengthens category <-> brand
            internal linking). Only on the unfiltered brand page. */}
        {!hasFilter && availableCategories.length > 0 && (
          <p className="mt-6 text-sm text-ink-light">
            Available in{' '}
            {availableCategories.map(({ category: cat }, idx) => (
              <span key={cat}>
                {idx > 0 && ', '}
                <Link
                  href={`/${categoryToSlug(cat)}`}
                  className="text-ink underline decoration-border underline-offset-4 hover:decoration-gold transition-colors"
                >
                  {categoryDisplay(cat)}
                </Link>
              </span>
            ))}
          </p>
        )}
      </section>

      {productTypes.length > 0 && (
        <section className="max-w-site mx-auto px-6 py-12">
          <div className="flex items-baseline justify-between mb-8 flex-wrap gap-4">
            <h2 className="font-serif text-3xl text-ink">Product types</h2>
            {hasFilter && (
              <Link
                href={buildUrl(slug)}
                className="text-sm text-ink-light hover:text-ink transition-colors"
              >
                ✕ Clear filter
              </Link>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {visibleTypes.map(pt => {
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
          {overflowTypes.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-ink-light hover:text-ink transition-colors">
                {overflowTypes.length} more type{overflowTypes.length === 1 ? '' : 's'}
              </summary>
              <div className="flex flex-wrap gap-2 mt-3">
                {overflowTypes.map(pt => (
                  <Link
                    key={pt.product_type}
                    href={buildUrl(slug, { type: pt.product_type })}
                    className="rounded-full px-5 py-2.5 text-sm transition-colors border bg-warm-white text-ink border-border hover:border-gold hover:bg-cream"
                  >
                    {pt.product_type}
                    <span className="ml-1.5 text-xs text-ink-light">{pt.count}</span>
                  </Link>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {!hasFilter && stats.category_breakdown.length > 1 && (
        <section className="max-w-site mx-auto px-6 py-12">
          <h2 className="font-serif text-3xl text-ink mb-8">Browse by category</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {stats.category_breakdown.map(({ category: cat, count }) => (
              <Link
                key={cat}
                href={buildUrl(slug, { category: cat })}
                className="group bg-warm-white border border-border rounded-2xl p-6 hover:border-gold transition-colors"
              >
                <div className="font-serif text-2xl text-ink capitalize mb-1 group-hover:text-gold transition-colors">
                  {categoryDisplay(cat)}
                </div>
                <div className="text-sm text-ink-light">
                  {count.toLocaleString()} products
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="max-w-site mx-auto px-6 py-12">
        <h2 className="font-serif text-3xl text-ink mb-2">Products</h2>
        <p className="text-ink-light mb-8">
          {page > 1 ? `Page ${page} of ${totalPages}. ` : ''}
          {productResult.totalCount.toLocaleString()} {hasFilter ? `${filterLabel!.toLowerCase()} ` : ''}{brand.display_name} product{productResult.totalCount === 1 ? '' : 's'}.
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
