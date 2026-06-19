import { NextResponse } from 'next/server';
import { buildProductSitemapXml } from '../../../lib/sitemap';

// Paginated product sitemap parts: /sitemap-products/1, /sitemap-products/2, ...
// Each part holds up to PRODUCTS_PER_SITEMAP product URLs. The sitemap index
// (/sitemap.xml) decides how many parts exist from the live product count.

export const revalidate = 3600;

export async function GET(
  _req: Request,
  { params }: { params: { part: string } }
) {
  const part = parseInt(params.part, 10);
  if (Number.isNaN(part) || part < 1) {
    return new NextResponse('Not found', { status: 404 });
  }

  const xml = await buildProductSitemapXml(part);

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
