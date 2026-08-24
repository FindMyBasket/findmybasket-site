import { SubcategoryPage } from '../../../components/SubcategoryPage';
import { socialTags } from '../../../lib/format/social-tags';

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
    const title = `${searchParams.type} - ${display} fragrance best prices | FindMyBasket`;
    const description = `Compare ${searchParams.type.toLowerCase()} prices in ${sub} fragrance across UK retailers.`;
    return {
      title,
      description,
      alternates: { canonical },
      ...socialTags({ title, description, url: canonical }),
    };
  }

  const title = `${display} fragrance best prices | FindMyBasket`;
  const description = `Compare ${sub} fragrance prices across UK retailers. Find the best value on eau de parfum, eau de toilette, cologne and more.`;
  return {
    title,
    description,
    alternates: { canonical },
    ...socialTags({ title, description, url: canonical }),
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
