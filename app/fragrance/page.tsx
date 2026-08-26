import { CategoryPage } from '../../components/CategoryPage';
import { socialTags } from '../../lib/format/social-tags';

export const revalidate = 3600;

// Social tags from the same title and description the search result uses. Before this,
// a category page shared to social produced no title, no description and no image at
// all -- verified by fetching, not by reading. Item 296.
const title = 'Fragrance prices across UK retailers | FindMyBasket';
const description =
  'Compare fragrance prices across multiple UK retailers, delivery included, to find the best value on eau de parfum, eau de toilette and cologne from the brands you love.';
const canonical = 'https://www.findmybasket.co.uk/fragrance';

// Paged and filtered variants canonicalise to the clean root, as on /hair.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: { type?: string; other?: string; page?: string; comparable?: string };
}) {
  if (searchParams.type) {
    const t = searchParams.type;
    const varTitle = `${t} - fragrance best prices | FindMyBasket`;
    const varDesc = `Compare ${t.toLowerCase()} prices in fragrance across multiple UK retailers, delivery included.`;
    return {
      title: varTitle, description: varDesc,
      alternates: { canonical },
      ...socialTags({ title: varTitle, description: varDesc, url: canonical }),
    };
  }
  return {
    title, description,
    alternates: { canonical },
    ...socialTags({ title, description, url: canonical }),
  };
}

export default async function FragrancePage({
  searchParams,
}: {
  searchParams: { type?: string; other?: string; page?: string; comparable?: string };
}) {
  const parsed = Number.parseInt(searchParams.page ?? '1', 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

  return (
    <CategoryPage
      category="fragrance"
      displayName="Fragrance"
      intro="Compare prices across multiple UK retailers on eau de parfum, eau de toilette, cologne and more, delivery included. From everyday scents to designer favourites."
      browse={{
        page,
        productType: searchParams.type,
        other: searchParams.other === '1',
        comparable: searchParams.comparable === '1',
      }}
    />
  );
}
