import { CategoryPage } from '../../components/CategoryPage';
import { socialTags } from '../../lib/format/social-tags';

export const revalidate = 3600;

// Social tags from the same title and description the search result uses. Before this,
// a category page shared to social produced no title, no description and no image at
// all -- verified by fetching, not by reading. Item 296.
const title = 'Skincare prices across UK retailers | FindMyBasket';
const description =
  'Compare skincare prices across multiple UK retailers, delivery included, to find the best value on cleansers, serums, moisturisers and SPF. From The Ordinary to La Roche-Posay, COSRX to CeraVe.';
const canonical = 'https://www.findmybasket.co.uk/skincare';

export const metadata = {
  title,
  description,
  alternates: { canonical },
  ...socialTags({ title, description, url: canonical }),
};

export default async function SkincarePage() {
  return (
    <CategoryPage
      category="skincare"
      displayName="Skincare"
      intro="Compare prices across multiple UK retailers on cleansers, serums, moisturisers, SPF and more, delivery included. From The Ordinary to La Roche-Posay, COSRX to CeraVe."
    />
  );
}
