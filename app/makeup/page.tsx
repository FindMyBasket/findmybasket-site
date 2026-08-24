import { CategoryPage } from '../../components/CategoryPage';
import { socialTags } from '../../lib/format/social-tags';

export const revalidate = 3600;

// Social tags from the same title and description the search result uses. Before this,
// a category page shared to social produced no title, no description and no image at
// all -- verified by fetching, not by reading. Item 296.
const title = 'Makeup prices across UK retailers | FindMyBasket';
const description =
  'Compare makeup prices across multiple UK retailers, delivery included, to find the best value on foundation, concealer, lipstick, mascara and eyeshadow. NYX, Maybelline, Revolution, Charlotte Tilbury and more.';
const canonical = 'https://www.findmybasket.co.uk/makeup';

export const metadata = {
  title,
  description,
  alternates: { canonical },
  ...socialTags({ title, description, url: canonical }),
};

export default async function MakeupPage() {
  return (
    <CategoryPage
      category="makeup"
      displayName="Makeup"
      intro="Compare prices across multiple UK retailers on lipstick, foundation, mascara, eyeshadow and more, delivery included. From Maybelline to Charlotte Tilbury, Revolution to Estee Lauder."
    />
  );
}
