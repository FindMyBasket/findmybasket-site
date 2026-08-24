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

export const metadata = {
  title,
  description,
  alternates: { canonical },
  ...socialTags({ title, description, url: canonical }),
};

export default async function HairPage() {
  return (
    <CategoryPage
      category="hair"
      displayName="Hair"
      intro="Compare prices across multiple UK retailers on shampoo, conditioner, treatments and styling, delivery included. From Olaplex to Living Proof, Aveda to The Ordinary."
    />
  );
}
