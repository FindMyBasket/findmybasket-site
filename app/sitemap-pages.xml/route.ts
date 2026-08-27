import { NextResponse } from 'next/server';
import { supabase } from '../../lib/supabase';
// DB top_category values from the single source in lib/queries. Route slugs are
// derived via categoryToSlug (identity except bath_body -> bath-and-body);
// queries filter on the raw value.
import { brandSlug, categoryToSlug, ALL_CATEGORIES as CATEGORIES } from '../../lib/queries';
import { listEdits } from '../../lib/edits';
import { requireBrandNames } from '../../lib/sitemap-brands';

// Sitemap for non-product pages: static HTML, categories, subcategories,
// brand pages, edit pages. Should be ~1,500 URLs total.

export const revalidate = 3600;

const SITE_URL = 'https://www.findmybasket.co.uk';

interface UrlEntry {
  loc: string;
  lastmod?: string;
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

// Static HTML pages still served from /public
const STATIC_PAGES: UrlEntry[] = [
  { loc: '/', changefreq: 'daily', priority: 1.0 },
  { loc: '/finder', changefreq: 'weekly', priority: 0.7 },
  // The brand index. Its 2,451 destinations are already listed individually below;
  // this is the page a visitor browses them from. Item 419.
  { loc: '/brands/all', changefreq: 'weekly', priority: 0.7 },
  // ── THE /compare TYPE PAGES ARE LISTED BY HAND, AND A NEW ONE NEEDS A LINE HERE ──
  //
  // Enumerating them would mean a registry for three entries, so they are written out.
  // WHAT HAPPENS IF THIS IS FORGOTTEN: the new page is live, correct, linked from
  // /compare and /supplements, and invisible to search. Nothing fails, nothing 404s, no
  // check goes red -- the page simply never enters the index, and the absence is only
  // findable by someone comparing this array against app/compare/. That is exactly how
  // /compare/whey-protein and /compare/creatine spent two days orphaned in BOTH senses
  // at once, which the brand hubs never were: those had the sitemap, so Google could
  // reach them while a visitor could not. Item 445.
  { loc: '/compare', changefreq: 'weekly', priority: 0.7 },
  { loc: '/compare/whey-protein', changefreq: 'weekly', priority: 0.7 },
  { loc: '/compare/creatine', changefreq: 'weekly', priority: 0.7 },
  { loc: '/compare/plant-protein', changefreq: 'weekly', priority: 0.7 },
  { loc: '/savings-hub.html', changefreq: 'daily', priority: 0.9 },
  { loc: '/app.html', changefreq: 'weekly', priority: 0.9 },
  { loc: '/product-finder.html', changefreq: 'weekly', priority: 0.7 },
  { loc: '/partners.html', changefreq: 'monthly', priority: 0.4 },
  { loc: '/about.html', changefreq: 'monthly', priority: 0.4 },
  { loc: '/privacy-policy.html', changefreq: 'yearly', priority: 0.2 },
  { loc: '/terms.html', changefreq: 'yearly', priority: 0.2 },
  // Articles live under /articles/ (their canonical path). These entries
  // previously pointed at bare root paths that 404 for most articles; they
  // now match the real files and canonicals.
  { loc: '/articles/lowest-price-per-product-basket.html', changefreq: 'monthly', priority: 0.7 },
  { loc: '/articles/beauty-delivery-threshold-savings.html', changefreq: 'monthly', priority: 0.7 },
  { loc: '/articles/cerave-best-value-uk.html', changefreq: 'monthly', priority: 0.7 },
  { loc: '/articles/the-ordinary-best-value-uk.html', changefreq: 'monthly', priority: 0.7 },
  { loc: '/articles/clarins-best-price-uk.html', changefreq: 'monthly', priority: 0.7 },
  { loc: '/articles/cosrx-best-price-uk.html', changefreq: 'monthly', priority: 0.7 },
  { loc: '/articles/elemis-best-price-uk.html', changefreq: 'monthly', priority: 0.7 },
  { loc: '/articles/k-beauty-uk-best-prices.html', changefreq: 'monthly', priority: 0.7 },
  { loc: '/articles/lookfantastic-vs-boots.html', changefreq: 'monthly', priority: 0.6 },
  { loc: '/articles/overpaying-for-skincare.html', changefreq: 'monthly', priority: 0.6 },
  { loc: '/articles/skincare-routine-under-40.html', changefreq: 'monthly', priority: 0.6 },
  { loc: '/articles/skincare-routine-cost-uk.html', changefreq: 'monthly', priority: 0.7 },
  { loc: '/articles/volufiline-pdrn-topical-collagen-explained.html', changefreq: 'monthly', priority: 0.7 },
  // Supplements cluster, published together 16 Aug 2026. All four cross-link to
  // each other, so they are a must-publish-together set: removing one leaves dead
  // internal links in the other three.
  { loc: '/articles/how-to-read-supplement-label.html', changefreq: 'monthly', priority: 0.7 },
  { loc: '/articles/supplement-price-per-serving.html', changefreq: 'monthly', priority: 0.7 },
  { loc: '/articles/supplement-capsules-vs-powder.html', changefreq: 'monthly', priority: 0.7 },
  { loc: '/articles/supplement-dose-explained.html', changefreq: 'monthly', priority: 0.7 },
];

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlToXml(entry: UrlEntry): string {
  const loc = `${SITE_URL}${entry.loc.startsWith('/') ? entry.loc : '/' + entry.loc}`;
  const parts = [`    <loc>${escapeXml(loc)}</loc>`];
  if (entry.lastmod) parts.push(`    <lastmod>${entry.lastmod}</lastmod>`);
  if (entry.changefreq) parts.push(`    <changefreq>${entry.changefreq}</changefreq>`);
  if (entry.priority !== undefined) parts.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
  return `  <url>\n${parts.join('\n')}\n  </url>`;
}

export async function GET() {
  const entries: UrlEntry[] = [...STATIC_PAGES];

  // Categories: /skincare, /makeup, /hair, /fragrance, /bath-and-body
  for (const cat of CATEGORIES) {
    entries.push({
      loc: `/${categoryToSlug(cat)}`,
      changefreq: 'daily',
      priority: 0.95,
    });
  }

  // Subcategories: /skincare/face etc. Read the DISTINCT (top_category,
  // subcategory) pairs from the active_category_subcategories view — only a
  // handful of rows, so (unlike an un-paginated products_active query) PostgREST's
  // 1,000-row cap can never hide a subcategory.
  const liveCategories = new Set(CATEGORIES);
  const { data: catSubs } = await supabase
    .from('active_category_subcategories')
    .select('top_category, subcategory');

  for (const row of catSubs ?? []) {
    if (!row.top_category || !row.subcategory) continue;
    if (!liveCategories.has(row.top_category)) continue;
    entries.push({
      loc: `/${categoryToSlug(row.top_category)}/${row.subcategory}`,
      changefreq: 'daily',
      priority: 0.85,
    });
  }

  // Edits: /edit/k-beauty etc.
  for (const edit of listEdits()) {
    entries.push({
      loc: `/edit/${edit.slug}`,
      changefreq: 'daily',
      priority: 0.9,
    });
  }

  // Brand pages: /brands/cerave etc.
  //
  // ONE REQUEST, NOT NINETY-EIGHT. This used to page products_active a thousand rows
  // at a time — 97,645 rows and ~26 seconds of serial round-trips to derive 2,400
  // distinct brands, because PostgREST caps a response at 1,000 rows. Next kills a
  // static page at 60 seconds, so the page sat inside the cap only while the
  // catalogue was small enough, and the request count grew with it.
  //
  // fmb_active_brand_names() returns the distinct set as ONE ROW containing an
  // array, which sidesteps the row cap entirely rather than reducing the number of
  // pages. Measured 187ms. Slugification stays here, using the same brandSlug() that
  // builds the links, so the sitemap cannot drift from the routes it advertises —
  // and passing DISTINCT names rather than every row is exactly equivalent, because
  // these go into a Set.
  const { data: brandData, error: brandError } = await supabase.rpc('fmb_active_brand_names');
  // Throws rather than emitting a brandless sitemap. See lib/sitemap-brands.ts for
  // why a failed build is the intended outcome here.
  const brandSlugs = new Set<string>(requireBrandNames(brandData, brandError).map(brandSlug));

  for (const slug of brandSlugs) {
    entries.push({
      loc: `/brands/${slug}`,
      changefreq: 'weekly',
      priority: 0.7,
    });
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(urlToXml).join('\n')}
</urlset>`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
