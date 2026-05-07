import { BrandPage } from '../../../components/BrandPage';
import { findBrandBySlug } from '../../../lib/brand-queries';

export const revalidate = 3600;

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const brand = await findBrandBySlug(params.slug);
  if (!brand) {
    return { title: 'Brand not found | FindMyBasket' };
  }
  return {
    title: `${brand.display_name} best prices UK | FindMyBasket`,
    description: `Compare ${brand.display_name} prices across UK retailers including Boots, Superdrug, Escentual, Cult Beauty and more. Find the best deal.`,
  };
}

export default async function BrandSlugPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { page?: string };
}) {
  const page = searchParams.page ? parseInt(searchParams.page, 10) : 1;
  return <BrandPage slug={params.slug} page={page} />;
}
