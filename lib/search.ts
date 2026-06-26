import { supabase } from './supabase';
import { brandSlug } from './queries';

// Shared free-text search used by BOTH the typeahead API (GET /api/search) and
// the server-rendered /search results page. Extracting it keeps a single source
// of truth for ranking/limits and gives the results page direct DB access (no
// internal HTTP hop). Future ingredient/concern browsing can build on runSearch.

export interface BrandMatch {
  display_name: string;
  slug: string;
  product_count: number;
}

export interface ProductMatch {
  id: number;
  name: string;
  brand: string | null;
  product_type: string | null;
  image_url: string | null;
}

export interface SearchResults {
  brands: BrandMatch[];
  products: ProductMatch[];
  query: string;
}

export const SEARCH_MIN_QUERY_LEN = 2;
const PRODUCT_LIMIT = 10;
const BRAND_LIMIT = 5;

// Returns brand and product matches for a free-text query. A query shorter than
// SEARCH_MIN_QUERY_LEN yields empty arrays without touching the database, so
// callers can render an empty/prompt state cheaply.
export async function runSearch(rawQuery: string): Promise<SearchResults> {
  const query = (rawQuery ?? '').trim();

  if (query.length < SEARCH_MIN_QUERY_LEN) {
    return { brands: [], products: [], query };
  }

  const [brands, products] = await Promise.all([
    searchBrands(query),
    searchProducts(query),
  ]);

  return { brands, products, query };
}

async function searchBrands(query: string): Promise<BrandMatch[]> {
  const { data } = await supabase
    .from('products_active')
    .select('normalised_brand, brand')
    .ilike('brand', `%${query}%`)
    .not('normalised_brand', 'is', null)
    .not('tags', 'cs', '{cleanup_remove}')
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
  const { data } = await supabase
    .from('products_active')
    .select('id, name, brand, product_type, image_url')
    .or(`name.ilike.%${query}%,brand.ilike.%${query}%`)
    .not('image_url', 'is', null)
    .neq('image_url', '')
    .not('tags', 'cs', '{cleanup_remove}')
    .limit(40);

  if (!data || data.length === 0) {
    const words = query.split(/\s+/).filter(w => w.length >= 2);
    if (words.length > 1) {
      let fallbackQuery = supabase
        .from('products_active')
        .select('id, name, brand, product_type, image_url');
      for (const w of words) {
        fallbackQuery = fallbackQuery.or(`name.ilike.%${w}%,brand.ilike.%${w}%`);
      }
      const { data: fallback } = await fallbackQuery
        .not('image_url', 'is', null)
        .neq('image_url', '')
        .not('tags', 'cs', '{cleanup_remove}')
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
