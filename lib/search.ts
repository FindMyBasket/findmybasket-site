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

// Accent-fold and strip apostrophes the same way brand_search_index.brand_folded
// is built, so a shopper typing "loreal paris" or "loccitane" matches the stored
// form. Kept in step with fmb_refresh_brand_index() in
// supabase/migrations/20260727200000_brand_search_index.sql.
function foldForBrandMatch(input: string): string {
  return input
    .toLowerCase()
    .replace(/'/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Brand matches come from brand_search_index, one row per brand (~2,053), NOT
// from a scan of products_active.
//
// Two reasons. Recall: the old ILIKE against the brand column returned nothing
// at all for %loreal%, %kerastase% and %loccitane%, because the stored values
// carry apostrophes and accents that a UK shopper does not type. Latency: that
// scan was the slowest leg of the whole search at p95 202 ms, and since
// runSearch runs both legs in Promise.all it set end-to-end latency. Measured
// over the 127 real queries in search_events, the indexed lookup is p95 ~0 ms
// and takes end-to-end search p95 from 471 ms to 99.9 ms.
//
// Folding at query time over products_active was measured and rejected at p95
// 401 ms: it fixes recall and makes the slow leg twice as slow.
async function searchBrands(query: string): Promise<BrandMatch[]> {
  const folded = foldForBrandMatch(query);
  if (!folded) return [];

  const { data } = await supabase
    .from('brand_search_index')
    .select('brand, normalised_brand, product_count')
    .like('brand_folded', `%${folded}%`)
    .order('product_count', { ascending: false })
    .limit(50);

  if (!data) return [];

  const qLower = folded;
  const matches = data
    .filter(row => row.normalised_brand)
    .map(row => ({
      display_name: row.brand ?? row.normalised_brand!,
      slug: brandSlug(row.normalised_brand!),
      product_count: row.product_count ?? 0,
    }));

  matches.sort((a, b) => {
    // Compare folded on both sides, or "L'Oréal Paris" never counts as a prefix
    // match for "loreal paris" and loses its ranking boost.
    const aPrefix = foldForBrandMatch(a.display_name).startsWith(qLower) ? 0 : 1;
    const bPrefix = foldForBrandMatch(b.display_name).startsWith(qLower) ? 0 : 1;
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
