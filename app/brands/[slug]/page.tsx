import { BrandPage } from '../../../components/BrandPage';
import { BrandHub } from '../../../components/BrandHub';
import { findBrandBySlug } from '../../../lib/brand-queries';
import { getBrandHub } from '../../../lib/brand-hub-queries';
import { categoryDisplay } from '../../../lib/queries';

export const revalidate = 3600;

const SITE_URL = 'https://www.findmybasket.co.uk';

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { type?: string; category?: string };
}) {
  // Self-referencing canonical pointing at the clean brand URL. The consolidation is done
  // by the 301 in BrandPage, not by this tag: an empty filter now redirects to the hub, so
  // ?type=, ?category= and ?page= variants either render with content and carry this
  // canonical, or never render at all.
  //
  // CORRECTED 24 Aug 2026. This comment previously claimed the canonical made filter
  // variants "consolidate to one indexed page". IT DID NOT AND COULD NOT: an empty filter
  // called notFound() three files away, and A CANONICAL ON A 404 CONSOLIDATES NOTHING --
  // the page never renders, so the tag is never served. The comment described an intent that
  // another file cancelled. It is true now because of the redirect; it says so rather than
  // assuming it. Item 271.
  const canonical = `${SITE_URL}/brands/${params.slug}`;

  // A Brand Spotlight hub takes precedence over the price-comparison page.
  const hub = await getBrandHub(params.slug);
  if (hub) {
    // A hub may carry its own title/description; otherwise derive them from
    // the brand name and lede as before.
    return {
      title:
        hub.hub.seo_title ??
        `${hub.hub.display_name} Brand Spotlight | FindMyBasket`,
      description:
        hub.hub.meta_description ??
        hub.hub.lede ??
        `Discover the ${hub.hub.display_name} range on FindMyBasket.`,
      alternates: { canonical },
    };
  }

  const brand = await findBrandBySlug(params.slug);
  if (!brand) {
    return { title: 'Brand not found | FindMyBasket' };
  }
  const filterLabel =
    searchParams.type ??
    (searchParams.category ? categoryDisplay(searchParams.category) : undefined);
  if (filterLabel) {
    return {
      title: `${brand.display_name} ${filterLabel} prices across UK retailers | FindMyBasket`,
      description: `Compare ${brand.display_name} ${filterLabel.toLowerCase()} prices across multiple UK retailers, delivery included, to find the best value.`,
      alternates: { canonical },
    };
  }
  // Title matches "{brand} prices" search intent and stays under ~60 chars for
  // most brand names. Description is durable and range-based: no point-in-time
  // prices, no named retailers (a brand may not stock at any given shop), and
  // "multiple UK retailers" per the copy standing rules.
  return {
    title: `${brand.display_name} prices across UK retailers | FindMyBasket`,
    description: `Compare ${brand.display_name} prices across multiple UK retailers, delivery included, to find the best value. Honest price comparison on FindMyBasket.`,
    alternates: { canonical },
  };
}

export default async function BrandSlugPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { page?: string; type?: string; category?: string };
}) {
  // Hub-first dispatch: if a brand_hubs row exists, render the data-driven
  // Brand Spotlight hub; otherwise fall back to the price-comparison page.
  const hub = await getBrandHub(params.slug);
  if (hub) {
    return <BrandHub data={hub} />;
  }

  const page = searchParams.page ? parseInt(searchParams.page, 10) : 1;
  return (
    <BrandPage
      slug={params.slug}
      page={page}
      productType={searchParams.type}
      category={searchParams.category}
    />
  );
}
