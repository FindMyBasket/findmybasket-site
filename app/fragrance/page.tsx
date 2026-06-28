import { CategoryPage } from '../../components/CategoryPage';

export const revalidate = 3600;

export const metadata = {
  title: 'Fragrance best prices | FindMyBasket',
  description:
    'Compare fragrance prices across UK retailers. Eau de parfum, eau de toilette, cologne and more from the brands you love. Find the best deal on your next scent.',
  alternates: { canonical: 'https://www.findmybasket.co.uk/fragrance' },
};

export default async function FragrancePage() {
  return (
    <CategoryPage
      category="fragrance"
      displayName="Fragrance"
      intro="Compare prices across UK retailers on eau de parfum, eau de toilette, cologne and more. From everyday scents to designer favourites."
    />
  );
}
