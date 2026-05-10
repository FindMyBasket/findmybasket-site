import { SubcategoryPage } from '../../../components/SubcategoryPage';

export const revalidate = 3600;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: { subcategory: string };
  searchParams: { type?: string };
}) {
  const sub = params.subcategory;
  const display = sub.charAt(0).toUpperCase() + sub.slice(1);
  if (searchParams.type) {
    return {
      title: `${searchParams.type} - ${display} makeup best prices | FindMyBasket`,
      description: `Compare ${searchParams.type.toLowerCase()} prices in ${sub} makeup across UK retailers.`,
    };
  }
  return {
    title: `${display} makeup best prices | FindMyBasket`,
    description: `Compare ${sub} makeup prices across UK retailers. Find the best deal on ${sub} foundation, lipstick, mascara and more.`,
  };
}

export default async function MakeupSubPage({
  params,
  searchParams,
}: {
  params: { subcategory: string };
  searchParams: { page?: string; type?: string };
}) {
  const page = searchParams.page ? parseInt(searchParams.page, 10) : 1;
  return (
    <SubcategoryPage
      category="makeup"
      categoryDisplay="Makeup"
      subcategory={params.subcategory}
      page={page}
      productType={searchParams.type}
    />
  );
}