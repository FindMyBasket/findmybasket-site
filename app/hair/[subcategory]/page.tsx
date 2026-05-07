import { SubcategoryPage } from '../../../components/SubcategoryPage';
import { getValidSubcategories } from '../../../lib/subcategory-queries';

export const revalidate = 3600;

export async function generateStaticParams() {
  const subs = await getValidSubcategories('hair');
  return subs.map(sub => ({ subcategory: sub }));
}

export async function generateMetadata({ params }: { params: { subcategory: string } }) {
  const sub = params.subcategory;
  const display = sub.charAt(0).toUpperCase() + sub.slice(1);
  return {
    title: `${display} hair care best prices | FindMyBasket`,
    description: `Compare ${sub} hair care prices across UK retailers. Find the best deal on ${sub} shampoo, conditioner, treatments and styling products.`,
  };
}

export default async function HairSubPage({
  params,
  searchParams,
}: {
  params: { subcategory: string };
  searchParams: { page?: string };
}) {
  const page = searchParams.page ? parseInt(searchParams.page, 10) : 1;
  return (
    <SubcategoryPage
      category="hair"
      categoryDisplay="Hair"
      subcategory={params.subcategory}
      page={page}
    />
  );
}
