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
  const canonical = `https://www.findmybasket.co.uk/bath-and-body/${sub}`;
  if (searchParams.type) {
    return {
      title: `${searchParams.type} - ${display} bath & body best prices | FindMyBasket`,
      description: `Compare ${searchParams.type.toLowerCase()} prices in ${sub} bath and body across multiple UK retailers.`,
      alternates: { canonical },
    };
  }
  return {
    title: `${display} bath & body best prices | FindMyBasket`,
    description: `Compare ${sub} bath and body prices across multiple UK retailers. Find the best value on body wash, body lotion, hand cream, deodorant and more.`,
    alternates: { canonical },
  };
}

export default async function BathBodySubPage({
  params,
  searchParams,
}: {
  params: { subcategory: string };
  searchParams: { page?: string; type?: string };
}) {
  const page = searchParams.page ? parseInt(searchParams.page, 10) : 1;
  return (
    <SubcategoryPage
      category="bath_body"
      categoryDisplay="Bath & Body"
      subcategory={params.subcategory}
      page={page}
      productType={searchParams.type}
    />
  );
}
