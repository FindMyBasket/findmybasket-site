import { SubcategoryPage } from '../../../components/SubcategoryPage';
import { socialTags } from '../../../lib/format/social-tags';
import { subcategoryDisplay } from '../../../lib/queries';

export const revalidate = 3600;

// LABELS COME FROM lib/queries, NOT FROM CAPITALISING THE SLUG. This route used to
// derive its own display name as `sub[0].toUpperCase() + sub.slice(1)`, which is
// correct for every shelf whose slug IS its label -- body, hand, foot -- and silently
// wrong for the first one where they differ. `mouth` shipped and the page body read
// "Oral care" (SubcategoryPage reads the map) while the <title> read "Mouth bath &
// body best prices". Exactly the drift lib/__tests__/category-labels.test.ts exists to
// prevent, in the one place it could not see: a label DERIVED rather than duplicated.
// Item 406.
function displayFor(sub: string): string {
  const mapped = subcategoryDisplay(sub);
  return mapped === sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : mapped;
}

// Example products named in the meta description. The default is the bath & body set
// this route has always used; a shelf whose contents it does not describe overrides it.
// Keyed by slug, so existing shelves are byte-identical to before.
const EXAMPLES: Record<string, string> = {
  mouth: 'toothpaste, whitening strips, mouthwash, floss and more',
};
const DEFAULT_EXAMPLES = 'body wash, body lotion, hand cream, deodorant and more';

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { subcategory: string };
  searchParams: { type?: string };
}) {
  const sub = params.subcategory;
  const display = displayFor(sub);
  // Consolidate ?type=/?page= variants to the clean subcategory URL.
  const canonical = `https://www.findmybasket.co.uk/bath-and-body/${sub}`;
  if (searchParams.type) {
    const title = `${searchParams.type} - ${display} bath & body best prices | FindMyBasket`;
    const description = `Compare ${searchParams.type.toLowerCase()} prices in ${display.toLowerCase()} bath and body across multiple UK retailers.`;
    return {
      title,
      description,
      alternates: { canonical },
      ...socialTags({ title, description, url: canonical }),
    };
  }

  const title = `${display} bath & body best prices | FindMyBasket`;
  const description = `Compare ${display.toLowerCase()} bath and body prices across multiple UK retailers. Find the best value on ${EXAMPLES[sub] ?? DEFAULT_EXAMPLES}.`;
  return {
    title,
    description,
    alternates: { canonical },
    ...socialTags({ title, description, url: canonical }),
  };
}

export default async function BathBodySubPage({
  params,
  searchParams,
}: {
  params: { subcategory: string };
  searchParams: { page?: string; type?: string };
}) {
  const page = searchParams.page ? parseInt(searchParams.page, 10) : 1;
  return (
    <SubcategoryPage
      category="bath_body"
      categoryDisplay="Bath & Body"
      subcategory={params.subcategory}
      page={page}
      productType={searchParams.type}
    />
  );
}
