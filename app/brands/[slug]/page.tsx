import { BrandPage } from '../../../components/BrandPage';
import { BrandHub } from '../../../components/BrandHub';
import { findBrandBySlug } from '../../../lib/brand-queries';
import { getBrandHub } from '../../../lib/brand-hub-queries';

export const revalidate = 3600;

const SITE_URL = 'https://www.findmybasket.co.uk';

// Coarse top_category labels for titles/headings (mirrors CATEGORY_DISPLAY in
// components/BrandPage.tsx).
const CATEGORY_LABEL: Record<string, string> = {
  skincare: 'Skincare',
  makeup: 'Makeup',
  hair: 'Hair',
  fragrance: 'Fragrance',
};

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { type?: string; category?: string };
}) {
  // Self-referencing canonical pointing at the clean brand URL, so ?type=,
  // ?category= and ?page= filter variants consolidate to one indexed page.
  const canonical = `${SITE_URL}/brands/${params.slug}`;

  // A Brand Spotlight hub takes precedence over the price-comparison page.
  const hub = await getBrandHub(params.slug);
  if (hub) {
    return {
      title: `${hub.hub.display_name} Brand Spotlight | FindMyBasket`,
      description:
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
    (searchParams.category ? CATEGORY_LABEL[searchParams.category] ?? searchParams.category : undefined);
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
