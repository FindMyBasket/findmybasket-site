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

export const metadata = {
  title,
  description,
  alternates: { canonical },
  ...socialTags({ title, description, url: canonical }),
};

export default async function FragrancePage() {
  return (
    <CategoryPage
      category="fragrance"
      displayName="Fragrance"
      intro="Compare prices across multiple UK retailers on eau de parfum, eau de toilette, cologne and more, delivery included. From everyday scents to designer favourites."
    />
  );
}
