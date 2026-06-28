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
  const canonical = `https://www.findmybasket.co.uk/fragrance/${sub}`;
  if (searchParams.type) {
    return {
      title: `${searchParams.type} - ${display} fragrance best prices | FindMyBasket`,
      description: `Compare ${searchParams.type.toLowerCase()} prices in ${sub} fragrance across UK retailers.`,
      alternates: { canonical },
    };
  }
  return {
    title: `${display} fragrance best prices | FindMyBasket`,
    description: `Compare ${sub} fragrance prices across UK retailers. Find the best deal on eau de parfum, eau de toilette, cologne and more.`,
    alternates: { canonical },
  };
}

export default async function FragranceSubPage({
  params,
  searchParams,
}: {
  params: { subcategory: string };
  searchParams: { page?: string; type?: string };
}) {
  const page = searchParams.page ? parseInt(searchParams.page, 10) : 1;
  return (
    <SubcategoryPage
      category="fragrance"
      categoryDisplay="Fragrance"
      subcategory={params.subcategory}
      page={page}
      productType={searchParams.type}
    />
  );
}
