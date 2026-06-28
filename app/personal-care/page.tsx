import { CategoryPage } from '../../components/CategoryPage';

export const revalidate = 3600;

export const metadata = {
  title: 'Personal care best prices | FindMyBasket',
  description:
    'Compare personal care prices across UK retailers. Body wash, body lotion, hand cream, deodorant, bath and shower and more. Find the best deal on your essentials.',
  alternates: { canonical: 'https://www.findmybasket.co.uk/personal-care' },
};

export default async function PersonalCarePage() {
  return (
    <CategoryPage
      category="personal_care"
      displayName="Personal Care"
      intro="Compare prices across UK retailers on body wash, body lotion, hand cream, deodorant, bath and shower and more. Everyday essentials at their best value."
    />
  );
}
