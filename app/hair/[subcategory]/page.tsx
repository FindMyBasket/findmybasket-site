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
  const canonical = `https://www.findmybasket.co.uk/hair/${sub}`;
  if (searchParams.type) {
    return {
      title: `${searchParams.type} - ${display} hair care best prices | FindMyBasket`,
      description: `Compare ${searchParams.type.toLowerCase()} prices in ${sub} hair care across UK retailers.`,
      alternates: { canonical },
    };
  }
  return {
    title: `${display} hair care best prices | FindMyBasket`,
    description: `Compare ${sub} hair care prices across UK retailers. Find the best deal on ${sub} shampoo, conditioner, treatments and styling products.`,
    alternates: { canonical },
  };
}

export default async function HairSubPage({
  params,
  searchParams,
}: {
  params: { subcategory: string };
  searchParams: { page?: string; type?: string };
}) {
  const page = searchParams.page ? parseInt(searchParams.page, 10) : 1;
  return (
    <SubcategoryPage
      category="hair"
      categoryDisplay="Hair"
      subcategory={params.subcategory}
      page={page}
      productType={searchParams.type}
    />
  );
}
