import { CategoryPage } from '../../components/CategoryPage';
import { socialTags } from '../../lib/format/social-tags';

export const revalidate = 3600;

// Social tags from the same title and description the search result uses. Before this,
// a category page shared to social produced no title, no description and no image at
// all -- verified by fetching, not by reading. Item 296.
const title = 'Beauty supplement prices across UK retailers | FindMyBasket';
const description =
  'Compare beauty supplement prices across multiple UK retailers, delivery included. Collagen, hair-skin-nails complexes and biotin from Vida Glow, Solgar, Hair Gain, Ancient + Brave and more.';
const canonical = 'https://www.findmybasket.co.uk/supplements';

// Paged and filtered variants canonicalise to the clean root, as on /hair.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: { type?: string; other?: string; page?: string; comparable?: string };
}) {
  if (searchParams.type) {
    const t = searchParams.type;
    const varTitle = `${t} - supplement best prices | FindMyBasket`;
    const varDesc = `Compare ${t.toLowerCase()} prices in supplement across multiple UK retailers, delivery included.`;
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

export default async function SupplementsPage({
  searchParams,
}: {
  searchParams: { type?: string; other?: string; page?: string; comparable?: string };
}) {
  const parsed = Number.parseInt(searchParams.page ?? '1', 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

  return (
    <CategoryPage
      category="supplements"
      displayName="Supplements"
      // Deliberately describes what the category IS rather than how large it is.
      // Copy that quotes a count is copy that goes stale the next time the
      // classifier runs; see docs/standing-rule-frozen-catalogue-state.md.
      intro="Compare prices across multiple UK retailers on ingestible beauty supplements, delivery included. Collagen, hair-skin-nails complexes and biotin, from the same brands you already buy skincare from."
      callouts={[
        {
          href: '/compare/whey-protein',
          label: 'Whey protein by price per 100g',
          note: 'Tubs vary from 250g to 2.5kg, so the shelf price says little. 67 products ranked by unit price.',
        },
        {
          href: '/compare/creatine',
          label: 'Creatine by price per 100g',
          note: 'Monohydrate is the same substance whoever sells it. 35 products ranked by unit price.',
        },
      ]}
      browse={{
        page,
        productType: searchParams.type,
        other: searchParams.other === '1',
        comparable: searchParams.comparable === '1',
      }}
    />
  );
}
