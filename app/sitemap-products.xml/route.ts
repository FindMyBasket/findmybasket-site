import { NextResponse } from 'next/server';
import { supabase } from '../../lib/supabase';

// Sitemap for product pages. Up to 50,000 URLs allowed per sitemap file.
// Currently we have ~55,000 products. We pull paginated and emit the
// first 50,000 - if the catalogue grows past that we'll need to add
// /sitemap-products-2.xml.

export const revalidate = 3600;

const SITE_URL = 'https://www.findmybasket.co.uk';
const MAX_URLS = 50000;
const PAGE_SIZE = 1000;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET() {
  // Pull product IDs paginated. Only include products with images (those
  // that don't have images render thinly and aren't worth indexing).
  const productIds: { id: number; updated: string | null }[] = [];
  let offset = 0;

  while (productIds.length < MAX_URLS) {
    const remaining = MAX_URLS - productIds.length;
    const limit = Math.min(PAGE_SIZE, remaining);

    const { data, error } = await supabase
      .from('products_active')
      .select('id, created_at')
      .not('image_url', 'is', null)
      .neq('image_url', '')
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error || !data || data.length === 0) break;

    for (const row of data) {
      productIds.push({ id: row.id, updated: row.created_at });
    }

    if (data.length < limit) break;
    offset += limit;
  }

  const urls = productIds.map(p => {
    const loc = `${SITE_URL}/product/${p.id}`;
    const lastmod = p.updated ? p.updated.split('T')[0] : '';
    const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';
    return `  <url>
    <loc>${escapeXml(loc)}</loc>${lastmodTag}
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
