import { CategoryPage } from '../../components/CategoryPage';

export const revalidate = 3600;

export const metadata = {
  title: 'Skincare best prices | FindMyBasket',
  description:
    'Compare skincare prices across UK retailers including Boots, Superdrug, Escentual, Cult Beauty and more. Find the best deal on cleansers, serums, moisturisers, SPF and more.',
  alternates: { canonical: 'https://www.findmybasket.co.uk/skincare' },
};

export default async function SkincarePage() {
  return (
    <CategoryPage
      category="skincare"
      displayName="Skincare"
      intro="Compare prices across UK retailers on cleansers, serums, moisturisers, SPF and more. From The Ordinary to La Roche-Posay, COSRX to Cerave."
    />
  );
}
