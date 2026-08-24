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

export const metadata = {
  title,
  description,
  alternates: { canonical },
  ...socialTags({ title, description, url: canonical }),
};

export default async function BathBodyPage() {
  return (
    <CategoryPage
      category="bath_body"
      displayName="Bath & Body"
      intro="Compare prices across multiple UK retailers on body wash, body lotion, hand cream, deodorant, shower and bath and more, delivery included. Everyday essentials at their best value."
    />
  );
}
