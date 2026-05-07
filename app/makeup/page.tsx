import { CategoryPage } from '../../components/CategoryPage';

export const revalidate = 3600;

export const metadata = {
  title: 'Makeup best prices | FindMyBasket',
  description:
    'Compare makeup prices across UK retailers. From foundation and concealer to lipstick, mascara and eyeshadow. NYX, Maybelline, Revolution, Charlotte Tilbury and more.',
};

export default async function MakeupPage() {
  return (
    <CategoryPage
      category="makeup"
      displayName="Makeup"
      intro="Compare prices on lipsticks, foundation, mascara, eyeshadow and more. From Maybelline to Charlotte Tilbury, Revolution to Estee Lauder."
    />
  );
}
