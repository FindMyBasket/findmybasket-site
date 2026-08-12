import { SubcategoryPage } from '../../../components/SubcategoryPage';
import { subcategoryDisplay } from '../../../lib/queries';

export const revalidate = 3600;

// Labels come from lib/queries' SUBCATEGORY_DISPLAY, NOT from a local copy — the
// category page's browse chips read the same map, so the chip and the page it
// links to cannot drift apart. An unknown slug falls back to the capitalised
// form rather than 404ing, matching the other category routes.
function displayFor(sub: string): string {
  const mapped = subcategoryDisplay(sub);
  return mapped === sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : mapped;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { subcategory: string };
  searchParams: { type?: string };
}) {
  const sub = params.subcategory;
  const display = displayFor(sub);
  const canonical = `https://www.findmybasket.co.uk/supplements/${sub}`;
  if (searchParams.type) {
    return {
      title: `${searchParams.type} - ${display} best prices | FindMyBasket`,
      description: `Compare ${searchParams.type.toLowerCase()} prices in ${display.toLowerCase()} across UK retailers.`,
      alternates: { canonical },
    };
  }
  return {
    title: `${display} best prices | FindMyBasket`,
    description: `Compare ${display.toLowerCase()} prices across UK retailers, delivery included.`,
    alternates: { canonical },
  };
}

export default async function SupplementsSubPage({
  params,
  searchParams,
}: {
  params: { subcategory: string };
  searchParams: { page?: string; type?: string };
}) {
  const page = searchParams.page ? parseInt(searchParams.page, 10) : 1;
  return (
    <SubcategoryPage
      category="supplements"
      categoryDisplay="Supplements"
      subcategory={params.subcategory}
      page={page}
      productType={searchParams.type}
    />
  );
}
