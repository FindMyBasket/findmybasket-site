import { CategoryPage } from '../../components/CategoryPage';

export const revalidate = 3600;

export const metadata = {
  title: 'Bath & Body prices across UK retailers | FindMyBasket',
  description:
    'Compare bath and body prices across multiple UK retailers, delivery included, to find the best value on body wash, body lotion, hand cream, deodorant, shower and bath and more.',
  alternates: { canonical: 'https://www.findmybasket.co.uk/bath-and-body' },
};

export default async function BathBodyPage() {
  return (
    <CategoryPage
      category="bath_body"
      displayName="Bath & Body"
      intro="Compare prices across multiple UK retailers on body wash, body lotion, hand cream, deodorant, shower and bath and more, delivery included. Everyday essentials at their best value."
    />
  );
}
