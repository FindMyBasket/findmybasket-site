import { NextResponse } from 'next/server';
import { SITE_URL, countSitemapProducts, sitemapPartCount } from '../../lib/sitemap';

// Sitemap index. Lists the sub-sitemaps Google should crawl.
// We split by content type so each file stays under the 50,000 URL limit.
// Product URLs span several numbered parts; the count below decides how many.

export const revalidate = 3600;

export async function GET() {
  const now = new Date().toISOString();

  const total = await countSitemapProducts();
  const parts = sitemapPartCount(total);

  const childLocs = [`${SITE_URL}/sitemap-pages.xml`];
  for (let p = 1; p <= parts; p++) {
    childLocs.push(`${SITE_URL}/sitemap-products/${p}`);
  }

  const entries = childLocs
    .map(
      loc => `  <sitemap>
    <loc>${loc}</loc>
    <lastmod>${now}</lastmod>
  </sitemap>`
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
