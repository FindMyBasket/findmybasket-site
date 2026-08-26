import { CategoryPage } from '../../components/CategoryPage';
import { socialTags } from '../../lib/format/social-tags';

export const revalidate = 3600;

// Social tags from the same title and description the search result uses. Before this,
// a category page shared to social produced no title, no description and no image at
// all -- verified by fetching, not by reading. Item 296.
const title = 'Bath & Body prices across UK retailers | FindMyBasket';
const description =
  'Compare bath and body prices across multiple UK retailers, delivery included, to find the best value on body wash, body lotion, hand cream, deodorant, shower and bath and more.';
const canonical = 'https://www.findmybasket.co.uk/bath-and-body';

// Paged and filtered variants canonicalise to the clean root, as on the other five.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: { type?: string; other?: string; page?: string; comparable?: string };
}) {
  if (searchParams.type) {
    const t = searchParams.type;
    const varTitle = `${t} - bath & body best prices | FindMyBasket`;
    const varDesc = `Compare ${t.toLowerCase()} prices in bath and body across multiple UK retailers, delivery included.`;
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

export default async function BathBodyPage({
  searchParams,
}: {
  searchParams: { type?: string; other?: string; page?: string; comparable?: string };
}) {
  const parsed = Number.parseInt(searchParams.page ?? '1', 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

  return (
    <CategoryPage
      category="bath_body"
      displayName="Bath & Body"
      intro="Compare prices across multiple UK retailers on body wash, body lotion, hand cream, deodorant, shower and bath and more, delivery included. Everyday essentials at their best value."
      // The sixth and last root to opt in. Four subcategories, so "Browse by area"
      // keeps its indexed destinations per item 411. Item 432.
      browse={{
        page,
        productType: searchParams.type,
        other: searchParams.other === '1',
        comparable: searchParams.comparable === '1',
      }}
    />
  );
}
