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

export const metadata = {
  title,
  description,
  alternates: { canonical },
  ...socialTags({ title, description, url: canonical }),
};

export default async function SupplementsPage() {
  return (
    <CategoryPage
      category="supplements"
      displayName="Supplements"
      // Deliberately describes what the category IS rather than how large it is.
      // Copy that quotes a count is copy that goes stale the next time the
      // classifier runs; see docs/standing-rule-frozen-catalogue-state.md.
      intro="Compare prices across multiple UK retailers on ingestible beauty supplements, delivery included. Collagen, hair-skin-nails complexes and biotin, from the same brands you already buy skincare from."
    />
  );
}
