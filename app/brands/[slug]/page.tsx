import { BrandPage } from '../../../components/BrandPage';
import { BrandHub } from '../../../components/BrandHub';
import { findBrandBySlug, getBrandMetadataFacts } from '../../../lib/brand-queries';
import { getBrandHub } from '../../../lib/brand-hub-queries';
import { categoryDisplay } from '../../../lib/queries';
import { brandMetadataCopy } from '../../../lib/format/metadata-copy';
import { socialTags } from '../../../lib/format/social-tags';

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
    const hubTitle =
      hub.hub.seo_title ?? `${hub.hub.display_name} Brand Spotlight | FindMyBasket`;
    const hubDescription =
      hub.hub.meta_description ??
      hub.hub.lede ??
      `Discover the ${hub.hub.display_name} range on FindMyBasket.`;
    return {
      title: hubTitle,
      description: hubDescription,
      alternates: { canonical },
      ...socialTags({ title: hubTitle, description: hubDescription, url: canonical }),
    };
  }

  const brand = await findBrandBySlug(params.slug);
  if (!brand) {
    // No social tags here deliberately: this branch precedes a notFound(), so the tags
    // would never be served. Adding them would be code that cannot run.
    return { title: 'Brand not found | FindMyBasket' };
  }
  const filterLabel =
    searchParams.type ??
    (searchParams.category ? categoryDisplay(searchParams.category) : undefined);
  if (filterLabel) {
    const filterTitle = `${brand.display_name} ${filterLabel} prices across UK retailers | FindMyBasket`;
    const filterDescription = `Compare ${brand.display_name} ${filterLabel.toLowerCase()} prices across multiple UK retailers, delivery included, to find the best value.`;
    return {
      title: filterTitle,
      description: filterDescription,
      alternates: { canonical },
      ...socialTags({ title: filterTitle, description: filterDescription, url: canonical }),
    };
  }
  // THREE TEMPLATES, CHOSEN BY WHAT THE RANGE ACTUALLY HAS IN STOCK. The wording itself
  // lives in lib/format/metadata-copy.ts alongside the three product-page templates, so
  // both surfaces say the same things in the same words; what stays here is the reasoning
  // that depends on THIS FILE's revalidate setting.
  //
  // The single template these replace said "Compare {Brand} prices across multiple UK
  // retailers" on EVERY brand page. Measured 24 Aug 2026: 2,121 of 2,784 brand pages -- 76.2%,
  // covering 30,935 products -- have ZERO products carried by more than one stockist. The same
  // unsupportable-claim shape as the supplements articles (item 276), sitting on the
  // highest-intent queries in the corpus: seventeen searches of the form "where is the best
  // place to buy {brand} online in the uk", 572 impressions, ZERO clicks. Item 279.
  //
  // THE SINGLE-STOCKIST TEMPLATE NAMES A RETAILER, AND THE COMMENT IT REPLACED FORBADE
  // THAT: "no named retailers (a brand may not stock at any given shop)". THE RULE IS
  // SATISFIED, NOT OVERRIDDEN. Its concern is durable copy going stale against moving
  // stock; this name is resolved by fmb_brand_metadata_facts on the SAME call that picks
  // the branch, then regenerated with the page every hour (revalidate = 3600, no
  // generateStaticParams). Nothing is baked, and the retailer named is the retailer the
  // body lists. IF THIS ROUTE EVER GAINS generateStaticParams OR A LONGER WINDOW, THIS
  // CLAIM GOES STALE FIRST and must be reconsidered before that change lands.
  //
  // The third template exists because the second was covering two states: 167 hubs with
  // NOTHING in stock were being told "delivery included in every price" when there was no
  // price at all. Item 282.
  const facts = await getBrandMetadataFacts(brand.normalised_brand);

  const { title, fallbackDescription } = brandMetadataCopy({
    displayName: brand.display_name,
    stockists: facts.stockists,
    comparable: facts.comparable,
    soleRetailer: facts.sole_retailer,
  });
  // SAME TEXT, NOT A SEPARATE SOCIAL VARIANT. Measured across 2,820 hubs: titles average
  // 52 characters and max 84, so every one fits Facebook's ~88 cut and 2,783 of 2,820 fit
  // Twitter's ~70; descriptions average 124 and max 187, so every one fits the 200 a social
  // card shows while only 2,028 fit the 155 a search result shows. THE BINDING CAP IS
  // SEARCH'S, NOT SOCIAL'S -- so passing the same strings through gives the share card
  // strictly more of the claim than the search result gets, and a separate social variant
  // would be a second wording to keep in step for no gain. Item 296.
  return {
    title,
    description: fallbackDescription,
    alternates: { canonical },
    ...socialTags({ title, description: fallbackDescription, url: canonical }),
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
