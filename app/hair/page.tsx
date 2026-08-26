import { CategoryPage } from '../../components/CategoryPage';
import { socialTags } from '../../lib/format/social-tags';

export const revalidate = 3600;

// Social tags from the same title and description the search result uses. Before this,
// a category page shared to social produced no title, no description and no image at
// all -- verified by fetching, not by reading. Item 296.
const title = 'Hair care prices across UK retailers | FindMyBasket';
const description =
  'Compare hair care prices across multiple UK retailers, delivery included, to find the best value on shampoo, conditioner, treatments and styling. Olaplex, Living Proof, Christophe Robin, Aveda and more.';
const canonical = 'https://www.findmybasket.co.uk/hair';

// PAGED/FILTERED VARIANTS CANONICALISE TO THE CLEAN ROOT, matching what the
// subcategory routes already do for ?type= and ?page=. The grid is a browse surface,
// not 200 indexable URLs.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: { type?: string; other?: string; page?: string; comparable?: string };
}) {
  if (searchParams.type) {
    const t = searchParams.type;
    const varTitle = `${t} - hair care best prices | FindMyBasket`;
    const varDesc = `Compare ${t.toLowerCase()} prices in hair care across multiple UK retailers, delivery included.`;
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

export default async function HairPage({
  searchParams,
}: {
  searchParams: { type?: string; other?: string; page?: string; comparable?: string };
}) {
  const parsed = Number.parseInt(searchParams.page ?? '1', 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

  return (
    <CategoryPage
      category="hair"
      displayName="Hair"
      intro="Compare prices across multiple UK retailers on shampoo, conditioner, treatments and styling, delivery included. From Olaplex to Living Proof, Aveda to The Ordinary."
      // Hair opts in first: 11,025 products across five subcategories and the deepest
      // comparable share of any category at 21.4%. Item 408.
      browse={{
        page,
        productType: searchParams.type,
        other: searchParams.other === '1',
        comparable: searchParams.comparable === '1',
      }}
    />
  );
}
