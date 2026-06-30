import { CategoryPage } from '../../components/CategoryPage';

export const revalidate = 3600;

export const metadata = {
  title: 'Skincare prices across UK retailers | FindMyBasket',
  description:
    'Compare skincare prices across multiple UK retailers, delivery included, to find the best value on cleansers, serums, moisturisers and SPF. From The Ordinary to La Roche-Posay, COSRX to CeraVe.',
  alternates: { canonical: 'https://www.findmybasket.co.uk/skincare' },
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
