import { CategoryPage } from '../../components/CategoryPage';

export const revalidate = 3600;

export const metadata = {
  title: 'Makeup prices across UK retailers | FindMyBasket',
  description:
    'Compare makeup prices across multiple UK retailers, delivery included, to find the best value on foundation, concealer, lipstick, mascara and eyeshadow. NYX, Maybelline, Revolution, Charlotte Tilbury and more.',
  alternates: { canonical: 'https://www.findmybasket.co.uk/makeup' },
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
