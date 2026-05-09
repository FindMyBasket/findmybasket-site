import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';
import { brandSlug } from '../../../lib/queries';

// Site-wide search API. Returns matching brands and products for a query.
// Used by the nav search component (client-side fetch).

export const dynamic = 'force-dynamic';

interface BrandMatch {
  display_name: string;
  slug: string;
  product_count: number;
}

interface ProductMatch {
  id: number;
  name: string;
  brand: string | null;
  product_type: string | null;
  image_url: string | null;
}

const PRODUCT_LIMIT = 10;
const BRAND_LIMIT = 5;
const MIN_QUERY_LEN = 2;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') ?? '').trim();

  if (query.length < MIN_QUERY_LEN) {
    return NextResponse.json({ brands: [], products: [], query });
  }

  const [brandsResult, productsResult] = await Promise.all([
    searchBrands(query),
    searchProducts(query),
  ]);

  return NextResponse.json({
    brands: brandsResult,
    products: productsResult,
    query,
  });
}

async function searchBrands(query: string): Promise<BrandMatch[]> {
  // Pull distinct brands matching the query
  const { data } = await supabase
    .from('products')
    .select('normalised_brand, brand')
    .ilike('brand', `%${query}%`)
    .not('normalised_brand', 'is', null)
    .limit(200);

  if (!data) return [];

  const brandMap = new Map<string, { display: string; count: number }>();
  for (const row of data) {
    if (!row.normalised_brand) continue;
    const existing = brandMap.get(row.normalised_brand);
    if (existing) {
      existing.count++;
    } else {
      brandMap.set(row.normalised_brand, {
        display: row.brand ?? row.normalised_brand,
        count: 1,
      });
    }
  }

  // Build matches with prefix-bonus sorting
  const qLower = query.toLowerCase();
  const matches = Array.from(brandMap.entries()).map(([normalised, { display, count }]) => ({
    display_name: display,
    slug: brandSlug(normalised),
    product_count: count,
  }));

  matches.sort((a, b) => {
    const aPrefix = a.display_name.toLowerCase().startsWith(qLower) ? 0 : 1;
    const bPrefix = b.display_name.toLowerCase().startsWith(qLower) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    if (b.product_count !== a.product_count) return b.product_count - a.product_count;
    return a.display_name.localeCompare(b.display_name);
  });

  return matches.slice(0, BRAND_LIMIT);
}

async function searchProducts(query: string): Promise<ProductMatch[]> {
  // Match on name OR brand
  const { data } = await supabase
    .from('products')
    .select('id, name, brand, product_type, image_url')
    .or(`name.ilike.%${query}%,brand.ilike.%${query}%`)
    .not('image_url', 'is', null)
    .neq('image_url', '')
    .limit(40);

  if (!data || data.length === 0) {
    // Fallback: per-word OR matching for multi-word queries
    const words = query.split(/\s+/).filter(w => w.length >= 2);
    if (words.length > 1) {
      let fallbackQuery = supabase
        .from('products')
        .select('id, name, brand, product_type, image_url');
      for (const w of words) {
        fallbackQuery = fallbackQuery.or(`name.ilike.%${w}%,brand.ilike.%${w}%`);
      }
      const { data: fallback } = await fallbackQuery
        .not('image_url', 'is', null)
        .neq('image_url', '')
        .limit(40);
      if (fallback) return rankProducts(fallback, query).slice(0, PRODUCT_LIMIT);
    }
    return [];
  }

  return rankProducts(data, query).slice(0, PRODUCT_LIMIT);
}

function rankProducts(rows: ProductMatch[], query: string): ProductMatch[] {
  const qLower = query.toLowerCase();
  return [...rows].sort((a, b) => {
    const aBrand = (a.brand ?? '').toLowerCase();
    const bBrand = (b.brand ?? '').toLowerCase();
    const aName = (a.name ?? '').toLowerCase();
    const bName = (b.name ?? '').toLowerCase();
    const aBrandStarts = aBrand.startsWith(qLower) ? 0 : 1;
    const bBrandStarts = bBrand.startsWith(qLower) ? 0 : 1;
    if (aBrandStarts !== bBrandStarts) return aBrandStarts - bBrandStarts;
    const aNameStarts = aName.startsWith(qLower) ? 0 : 1;
    const bNameStarts = bName.startsWith(qLower) ? 0 : 1;
    if (aNameStarts !== bNameStarts) return aNameStarts - bNameStarts;
    return aName.localeCompare(bName);
  });
}
