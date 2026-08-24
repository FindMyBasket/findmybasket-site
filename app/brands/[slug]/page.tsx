import { BrandPage } from '../../../components/BrandPage';
import { BrandHub } from '../../../components/BrandHub';
import { findBrandBySlug, getBrandMetadataFacts } from '../../../lib/brand-queries';
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
  // TWO TEMPLATES, CHOSEN BY WHETHER THERE IS ANYTHING TO COMPARE.
  //
  // The single template this replaces said "Compare {Brand} prices across multiple UK
  // retailers" on EVERY brand page. Measured 24 Aug 2026: 2,121 of 2,784 brand pages -- 76.2%,
  // covering 30,935 products -- have ZERO products carried by more than one stockist. The same
  // unsupportable-claim shape as the supplements articles (item 276), sitting on the
  // highest-intent queries in the corpus: seventeen searches of the form "where is the best
  // place to buy {brand} online in the uk", 572 impressions, ZERO clicks. Item 279.
  const facts = await getBrandMetadataFacts(brand.normalised_brand);

  if (facts.comparable > 0) {
    // GROUP 1: the comparison is real, so the count is stated rather than implied.
    return {
      title: `${brand.display_name} prices compared across ${facts.stockists} UK retailers | FindMyBasket`,
      description:
        `Compare ${brand.display_name} prices across ${facts.stockists} UK retailers with delivery ` +
        `included, so you see what each option costs to get to your door. ` +
        `${facts.comparable} product${facts.comparable === 1 ? '' : 's'} with more than one stockist.`,
      alternates: { canonical },
    };
  }

  // GROUP 2: one stockist, or none comparable. The query asks WHERE TO BUY, and for a
  // single-stockist brand the honest answer is "one place, and here it is with delivery" --
  // which answers the search rather than dodging it.
  //
  // THIS NAMES A RETAILER, AND THE COMMENT THIS REPLACES FORBADE THAT: "no named retailers
  // (a brand may not stock at any given shop)". THE RULE IS SATISFIED, NOT OVERRIDDEN. Its
  // concern is durable copy going stale against moving stock; this name is resolved by
  // fmb_brand_metadata_facts on the SAME call that picks this branch, then regenerated with
  // the page every hour (revalidate = 3600, no generateStaticParams). Nothing is baked, and
  // the retailer named is the retailer the body lists. IF THIS ROUTE EVER GAINS
  // generateStaticParams OR A LONGER WINDOW, THIS CLAIM GOES STALE FIRST and must be
  // reconsidered before that change lands.
  return {
    title: `Where to buy ${brand.display_name} in the UK | FindMyBasket`,
    description: facts.sole_retailer
      ? `${brand.display_name} is stocked at ${facts.sole_retailer} from our UK retailers. ` +
        `See the price with delivery included before you buy.`
      : `See where to buy ${brand.display_name} in the UK, with delivery included in every price.`,
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
