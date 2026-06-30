import { CategoryPage } from '../../components/CategoryPage';

export const revalidate = 3600;

export const metadata = {
  title: 'Fragrance prices across UK retailers | FindMyBasket',
  description:
    'Compare fragrance prices across multiple UK retailers, delivery included, to find the best value on eau de parfum, eau de toilette and cologne from the brands you love.',
  alternates: { canonical: 'https://www.findmybasket.co.uk/fragrance' },
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
