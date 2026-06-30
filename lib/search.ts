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
  // Total full-text product matches (>= products.length). Lets the results page
  // show "top N of M". The typeahead ignores it.
  productTotal: number;
  query: string;
}

export const SEARCH_MIN_QUERY_LEN = 2;
// Typeahead default; the /search results page asks for more (SEARCH_PAGE_LIMIT).
const PRODUCT_LIMIT = 10;
export const SEARCH_PAGE_LIMIT = 30;
const BRAND_LIMIT = 5;

// Returns brand and product matches for a free-text query. A query shorter than
// SEARCH_MIN_QUERY_LEN yields empty arrays without touching the database, so
// callers can render an empty/prompt state cheaply. `productLimit` caps the
// product list (typeahead asks for fewer than the results page).
export async function runSearch(
  rawQuery: string,
  productLimit: number = PRODUCT_LIMIT
): Promise<SearchResults> {
  const query = (rawQuery ?? '').trim();

  if (query.length < SEARCH_MIN_QUERY_LEN) {
    return { brands: [], products: [], productTotal: 0, query };
  }

  const [brands, productResult] = await Promise.all([
    searchBrands(query),
    searchProducts(query, productLimit),
  ]);

  return {
    brands,
    products: productResult.products,
    productTotal: productResult.total,
    query,
  };
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

// Full-text product search (Product Finder Stage 1). Delegates ranking + the
// total match count to the fmb_search_products RPC, which searches across name,
// brand, product_type and description (weighted) and applies the name/brand
// substring boosts. This unlocks ingredient/concern queries ("niacinamide",
// "anti-ageing") that the old name-only ILIKE missed. Brand partials are still
// covered by searchBrands above, which keeps the typeahead responsive mid-type.
async function searchProducts(
  query: string,
  limit: number
): Promise<{ products: ProductMatch[]; total: number }> {
  const { data, error } = await supabase.rpc('fmb_search_products', {
    search_query: query,
    category_filter: null,
    limit_count: limit,
  });

  const rows = (data ?? []) as {
    id: number;
    name: string;
    brand: string | null;
    product_type: string | null;
    image_url: string | null;
    total_count: number | null;
  }[];

  if (error || rows.length === 0) {
    return { products: [], total: 0 };
  }

  return {
    products: rows.map(r => ({
      id: r.id,
      name: r.name,
      brand: r.brand,
      product_type: r.product_type,
      image_url: r.image_url,
    })),
    total: Number(rows[0].total_count ?? rows.length),
  };
}
