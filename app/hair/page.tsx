import { CategoryPage } from '../../components/CategoryPage';

export const revalidate = 3600;

export const metadata = {
  title: 'Hair care prices across UK retailers | FindMyBasket',
  description:
    'Compare hair care prices across multiple UK retailers, delivery included, to find the best value on shampoo, conditioner, treatments and styling. Olaplex, Living Proof, Christophe Robin, Aveda and more.',
  alternates: { canonical: 'https://www.findmybasket.co.uk/hair' },
};

export default async function HairPage() {
  return (
    <CategoryPage
      category="hair"
      displayName="Hair"
      intro="Compare prices across multiple UK retailers on shampoo, conditioner, treatments and styling, delivery included. From Olaplex to Living Proof, Aveda to The Ordinary."
    />
  );
}
