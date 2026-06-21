import { supabase } from './supabase';

// Shared helpers for the product sitemaps. Sitemap files cap at 50,000 URLs,
// and the catalogue has ~82k products with images, so product URLs are split
// across numbered parts (/sitemap-products/1, /sitemap-products/2, ...).

export const SITE_URL = 'https://www.findmybasket.co.uk';
export const PRODUCTS_PER_SITEMAP = 45000;
const DB_PAGE_SIZE = 1000;

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Count of products eligible for the sitemap. Products without an image render
// thinly and aren't worth indexing, so they're excluded (matching the per-part
// query below). products_active already excludes merged products.
export async function countSitemapProducts(): Promise<number> {
  const { count } = await supabase
    .from('products_active')
    .select('id', { count: 'exact', head: true })
    .not('image_url', 'is', null)
    .neq('image_url', '');
  return count ?? 0;
}

export function sitemapPartCount(total: number): number {
  return Math.max(1, Math.ceil(total / PRODUCTS_PER_SITEMAP));
}

// Build the <urlset> XML for one product part (1-indexed). Returns a valid
// (possibly empty) urlset for out-of-range parts rather than throwing.
export async function buildProductSitemapXml(part: number): Promise<string> {
  const startOffset = (part - 1) * PRODUCTS_PER_SITEMAP;
  const rows: { id: number; updated: string | null }[] = [];
  let fetched = 0;

  while (fetched < PRODUCTS_PER_SITEMAP) {
    const remaining = PRODUCTS_PER_SITEMAP - fetched;
    const limit = Math.min(DB_PAGE_SIZE, remaining);
    const from = startOffset + fetched;

    const { data, error } = await supabase
      .from('products_active')
      .select('id, created_at')
      .not('image_url', 'is', null)
      .neq('image_url', '')
      .order('id', { ascending: true })
      .range(from, from + limit - 1);

    if (error || !data || data.length === 0) break;

    for (const r of data) rows.push({ id: r.id, updated: r.created_at });
    fetched += data.length;
    if (data.length < limit) break;
  }

  const urls = rows
    .map(p => {
      const loc = `${SITE_URL}/product/${p.id}`;
      const lastmod = p.updated ? p.updated.split('T')[0] : '';
      const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';
      return `  <url>
    <loc>${escapeXml(loc)}</loc>${lastmodTag}
    <changefreq>daily</changefreq>
    <priority>0.6</priority>
  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}
