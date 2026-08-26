import { CategoryPage } from '../../components/CategoryPage';
import { socialTags } from '../../lib/format/social-tags';

export const revalidate = 3600;

// Social tags from the same title and description the search result uses. Before this,
// a category page shared to social produced no title, no description and no image at
// all -- verified by fetching, not by reading. Item 296.
const title = 'Skincare prices across UK retailers | FindMyBasket';
const description =
  'Compare skincare prices across multiple UK retailers, delivery included, to find the best value on cleansers, serums, moisturisers and SPF. From The Ordinary to La Roche-Posay, COSRX to CeraVe.';
const canonical = 'https://www.findmybasket.co.uk/skincare';

// Paged and filtered variants canonicalise to the clean root, as on /hair.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: { type?: string; other?: string; page?: string; comparable?: string };
}) {
  if (searchParams.type) {
    const t = searchParams.type;
    const varTitle = `${t} - skincare best prices | FindMyBasket`;
    const varDesc = `Compare ${t.toLowerCase()} prices in skincare across multiple UK retailers, delivery included.`;
    return {
      title: varTitle,
      description: varDesc,
      alternates: { canonical },
      ...socialTags({ title: varTitle, description: varDesc, url: canonical }),
    };
  }
  return {
    title,
    description,
    alternates: { canonical },
    ...socialTags({ title, description, url: canonical }),
  };
}

export default async function SkincarePage({
  searchParams,
}: {
  searchParams: { type?: string; other?: string; page?: string; comparable?: string };
}) {
  const parsed = Number.parseInt(searchParams.page ?? '1', 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

  return (
    <CategoryPage
      category="skincare"
      displayName="Skincare"
      intro="Compare prices across multiple UK retailers on cleansers, serums, moisturisers, SPF and more, delivery included. From The Ordinary to La Roche-Posay, COSRX to CeraVe."
      // The harder page, opted in second: 45,124 renderable products, ONE subcategory,
      // and a complement chip of 16,377 -- 36% of the category, the largest chip on the
      // site. Item 411.
      browse={{
        page,
        productType: searchParams.type,
        other: searchParams.other === '1',
        comparable: searchParams.comparable === '1',
      }}
    />
  );
}
