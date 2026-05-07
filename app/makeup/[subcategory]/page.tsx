import { SubcategoryPage } from '../../../components/SubcategoryPage';
import { getValidSubcategories } from '../../../lib/subcategory-queries';

export const revalidate = 3600;

export async function generateStaticParams() {
  const subs = await getValidSubcategories('makeup');
  return subs.map(sub => ({ subcategory: sub }));
}

export async function generateMetadata({ params }: { params: { subcategory: string } }) {
  const sub = params.subcategory;
  const display = sub.charAt(0).toUpperCase() + sub.slice(1);
  return {
    title: `${display} makeup best prices | FindMyBasket`,
    description: `Compare ${sub} makeup prices across UK retailers. Find the best deal on ${sub} products from your favourite brands.`,
  };
}

export default async function MakeupSubPage({
  params,
  searchParams,
}: {
  params: { subcategory: string };
  searchParams: { page?: string };
}) {
  const page = searchParams.page ? parseInt(searchParams.page, 10) : 1;
  return (
    <SubcategoryPage
      category="makeup"
      categoryDisplay="Makeup"
      subcategory={params.subcategory}
      page={page}
    />
  );
}
