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
  const canonical = `https://www.findmybasket.co.uk/personal-care/${sub}`;
  if (searchParams.type) {
    return {
      title: `${searchParams.type} - ${display} personal care best prices | FindMyBasket`,
      description: `Compare ${searchParams.type.toLowerCase()} prices in ${sub} personal care across UK retailers.`,
      alternates: { canonical },
    };
  }
  return {
    title: `${display} personal care best prices | FindMyBasket`,
    description: `Compare ${sub} personal care prices across UK retailers. Find the best deal on body wash, body lotion, hand cream, deodorant and more.`,
    alternates: { canonical },
  };
}

export default async function PersonalCareSubPage({
  params,
  searchParams,
}: {
  params: { subcategory: string };
  searchParams: { page?: string; type?: string };
}) {
  const page = searchParams.page ? parseInt(searchParams.page, 10) : 1;
  return (
    <SubcategoryPage
      category="personal_care"
      categoryDisplay="Personal Care"
      subcategory={params.subcategory}
      page={page}
      productType={searchParams.type}
    />
  );
}
