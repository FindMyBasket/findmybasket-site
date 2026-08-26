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
  // LABEL DERIVED FROM THE SLUG, AND THAT IS A TRAP RATHER THAN A BUG TODAY.
  // Capitalising the slug is correct for every subcategory in THIS category, because
  // none of them appears in SUBCATEGORY_DISPLAY in lib/queries.ts -- the derivation
  // agrees with the map by coincidence of the data, not by construction. THE MOMENT
  // YOU ADD A SUBCATEGORY WHOSE LABEL DIFFERS FROM ITS SLUG, this line ships a page
  // whose body copy reads the label and whose <title> reads the slug. That is not
  // hypothetical: it happened to bath_body/mouth ("Oral care") the day the shelf
  // shipped -- see item 406. Use displayFor()/subcategoryDisplay as the
  // bath-and-body and supplements routes do.
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
