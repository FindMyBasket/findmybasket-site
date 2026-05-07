import { SubcategoryPage } from '../../../components/SubcategoryPage';
import { getValidSubcategories } from '../../../lib/subcategory-queries';

export const revalidate = 3600;

export async function generateStaticParams() {
  const subs = await getValidSubcategories('skincare');
  return subs.map(sub => ({ subcategory: sub }));
}

export async function generateMetadata({ params }: { params: { subcategory: string } }) {
  const sub = params.subcategory;
  const display = sub.charAt(0).toUpperCase() + sub.slice(1);
  return {
    title: `${display} skincare best prices | FindMyBasket`,
    description: `Compare ${sub} skincare prices across UK retailers. Find the best deal on ${sub} cleansers, serums, moisturisers and more.`,
  };
}

export default async function SkincareSubPage({
  params,
  searchParams,
}: {
  params: { subcategory: string };
  searchParams: { page?: string };
}) {
  const page = searchParams.page ? parseInt(searchParams.page, 10) : 1;
  return (
    <SubcategoryPage
      category="skincare"
      categoryDisplay="Skincare"
      subcategory={params.subcategory}
      page={page}
    />
  );
}
