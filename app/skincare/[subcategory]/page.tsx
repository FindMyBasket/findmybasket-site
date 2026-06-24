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
  // Consolidate ?type=/?page= variants to the clean subcategory URL.
  const canonical = `https://www.findmybasket.co.uk/skincare/${sub}`;
  if (searchParams.type) {
    return {
      title: `${searchParams.type} - ${display} skincare best prices | FindMyBasket`,
      description: `Compare ${searchParams.type.toLowerCase()} prices in ${sub} skincare across UK retailers.`,
      alternates: { canonical },
    };
  }
  return {
    title: `${display} skincare best prices | FindMyBasket`,
    description: `Compare ${sub} skincare prices across UK retailers. Find the best deal on ${sub} cleansers, serums, moisturisers and more.`,
    alternates: { canonical },
  };
}

export default async function SkincareSubPage({
  params,
  searchParams,
}: {
  params: { subcategory: string };
  searchParams: { page?: string; type?: string };
}) {
  const page = searchParams.page ? parseInt(searchParams.page, 10) : 1;
  return (
    <SubcategoryPage
      category="skincare"
      categoryDisplay="Skincare"
      subcategory={params.subcategory}
      page={page}
      productType={searchParams.type}
    />
  );
}
