import { CategoryPage } from '../../components/CategoryPage';

export const revalidate = 3600;

export const metadata = {
  title: 'Hair care best prices | FindMyBasket',
  description:
    'Compare hair care prices across UK retailers. Shampoo, conditioner, treatments and styling. Olaplex, Living Proof, Christophe Robin, Aveda and more.',
};

export default async function HairPage() {
  return (
    <CategoryPage
      category="hair"
      displayName="Hair"
      intro="Compare prices on shampoo, conditioner, treatments and styling. From Olaplex to Living Proof, Aveda to The Ordinary."
    />
  );
}
