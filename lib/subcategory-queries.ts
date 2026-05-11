import { supabase } from './supabase';
import { brandSlug, type FeaturedProduct, type TopBrand, type TopCategory } from './queries';

export interface SubcategoryStats {
  total_products: number;
  total_brands: number;
  total_retailers: number;
}

export interface ProductTypeChip {
  product_type: string;
  count: number;
}

// ── PAGINATION HELPER ──────────────────────────────────────────────────
//
// Supabase silently caps `.select()` row returns at 1,000 unless you
// either use `count: 'exact', head: true` (count-only, no rows) or
// paginate via `.range()`. This helper paginates a select that we need
// the actual rows for (e.g. to dedupe / aggregate in JS).

const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  build: (offset: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await build(offset);
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

// ── QUERIES ────────────────────────────────────────────────────────────

export async function getSubcategoryStats(
  category: TopCategory,
  subcategory: string
): Promise<SubcategoryStats> {
  // Total products — count-only, no row cap
  const { count: totalProducts } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('top_category', category)
    .eq('subcategory', subcategory)
    .not('tags', 'cs', '{cleanup_remove}');

  // Distinct brands — paginated row fetch
  const brandRows = await fetchAllRows<{ normalised_brand: string | null }>(offset =>
    supabase
      .from('products')
      .select('normalised_brand')
      .eq('top_category', category)
      .eq('subcategory', subcategory)
      .not('normalised_brand', 'is', null)
      .not('tags', 'cs', '{cleanup_remove}')
      .range(offset, offset + PAGE_SIZE - 1),
  );

  const distinctBrands = new Set(brandRows.map(r => r.normalised_brand).filter(Boolean));

  // Distinct retailers — paginated row fetch
  const retailerRows = await fetchAllRows<{ retailer_id: number }>(offset =>
    supabase
      .from('retailer_prices')
      .select('retailer_id, products!inner(top_category, subcategory)')
      .eq('products.top_category', category)
      .eq('products.subcategory', subcategory)
      .range(offset, offset + PAGE_SIZE - 1),
  );

  const totalRetailers = new Set(retailerRows.map(r => r.retailer_id)).size;

  return {
    total_products: totalProducts ?? 0,
    total_brands: distinctBrands.size,
    total_retailers: totalRetailers,
  };
}

export async function getProductTypes(
  category: TopCategory,
  subcategory: string,
  limit = 12
): Promise<ProductTypeChip[]> {
  const data = await fetchAllRows<{ product_type: string | null }>(offset =>
    supabase
      .from('products')
      .select('product_type')
      .eq('top_category', category)
      .eq('subcategory', subcategory)
      .not('product_type', 'is', null)
      .not('tags', 'cs', '{cleanup_remove}')
      .range(offset, offset + PAGE_SIZE - 1),
  );

  const JUNK_TYPES = new Set(['Skincare', 'Makeup', 'Hair']);

  const counts = new Map<string, number>();
  for (const row of data) {
    if (!row.product_type) continue;
    if (JUNK_TYPES.has(row.product_type)) continue;
    counts.set(row.product_type, (counts.get(row.product_type) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([product_type, count]) => ({ product_type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function getSubcategoryTopBrands(
  category: TopCategory,
  subcategory: string,
  limit = 16,
  productType?: string
): Promise<TopBrand[]> {
  const data = await fetchAllRows<{ normalised_brand: string | null; brand: string | null }>(
    offset => {
      let query = supabase
        .from('products')
        .select('normalised_brand, brand')
        .eq('top_category', category)
        .eq('subcategory', subcategory)
        .not('normalised_brand', 'is', null)
        .not('tags', 'cs', '{cleanup_remove}');

      if (productType) query = query.eq('product_type', productType);

      return query.range(offset, offset + PAGE_SIZE - 1);
    },
  );

  const brandCounts = new Map<string, { display: string; count: number }>();
  for (const row of data) {
    if (!row.normalised_brand) continue;
    const existing = brandCounts.get(row.normalised_brand);
    if (existing) {
      existing.count++;
    } else {
      brandCounts.set(row.normalised_brand, {
        display: row.brand ?? row.normalised_brand,
        count: 1,
      });
    }
  }

  return Array.from(brandCounts.entries())
    .map(([slug, { display, count }]) => ({
      name: display,
      slug: brandSlug(slug),
      product_count: count,
    }))
    .sort((a, b) => b.product_count - a.product_count)
    .slice(0, limit);
}

export async function getSubcategoryProducts(
  category: TopCategory,
  subcategory: string,
  page = 1,
  pageSize = 48,
  productType?: string
): Promise<{ products: FeaturedProduct[]; totalCount: number }> {
  // Note: this function paginates by design via `.range()`. The 1,000-row
  // cap is irrelevant because we only ever ask for `pageSize * 4` rows
  // (max ~192) at a time.
  const offset = (page - 1) * pageSize;
  const candidateLimit = pageSize * 4;

  let query = supabase
    .from('products')
    .select('id, name, brand, normalised_brand, product_type, subcategory, image_url', { count: 'exact' })
    .eq('top_category', category)
    .eq('subcategory', subcategory)
    .not('image_url', 'is', null)
    .neq('image_url', '')
    .not('tags', 'cs', '{cleanup_remove}');

  if (productType) {
    query = query.eq('product_type', productType);
  }

  const { data: products, count: totalCount } = await query
    .range(offset, offset + candidateLimit - 1);

  if (!products || products.length === 0) {
    return { products: [], totalCount: totalCount ?? 0 };
  }

  const productIds = products.map(p => p.id);

  const { data: prices } = await supabase
    .from('retailer_prices')
    .select('product_id, retailer_id, price, in_stock')
    .in('product_id', productIds)
    .eq('in_stock', true);

  if (!prices) return { products: [], totalCount: totalCount ?? 0 };

 const STYLEVANA_ID = 11;
  const byProduct = new Map<number, { retailers: Set<number>; prices: number[] }>();
  for (const p of prices) {
    if (!p.product_id || !p.price) continue;
    const entry = byProduct.get(p.product_id) ?? { retailers: new Set(), prices: [] };
    entry.retailers.add(p.retailer_id);
    entry.prices.push(Number(p.price));
    byProduct.set(p.product_id, entry);
  }

  // Hide Stylevana from products that have UK retailer alternatives.
  for (const [productId, entry] of byProduct) {
    if (entry.retailers.has(STYLEVANA_ID) && entry.retailers.size > 1) {
      const stylevanaPrices = prices
        .filter(p => p.product_id === productId && p.retailer_id === STYLEVANA_ID)
        .map(p => Number(p.price));
      entry.retailers.delete(STYLEVANA_ID);
      entry.prices = entry.prices.filter(price => !stylevanaPrices.includes(price));
    }
  }

  const featured: FeaturedProduct[] = [];
  for (const product of products) {
    const entry = byProduct.get(product.id);
    if (!entry || entry.retailers.size === 0) continue;

    const minPrice = Math.min(...entry.prices);
    const maxPrice = Math.max(...entry.prices);
    const savingPct = maxPrice > 0 ? Math.round(((maxPrice - minPrice) / maxPrice) * 100) : 0;

    featured.push({
      id: product.id,
      name: product.name,
      brand: product.brand,
      brand_slug: product.normalised_brand ? brandSlug(product.normalised_brand) : null,
      product_type: product.product_type,
      subcategory: product.subcategory,
      image_url: product.image_url,
      retailer_count: entry.retailers.size,
      min_price: minPrice,
      max_price: maxPrice,
      saving_pct: savingPct,
    });
  }

  featured.sort((a, b) => {
    if (b.retailer_count !== a.retailer_count) return b.retailer_count - a.retailer_count;
    return b.saving_pct - a.saving_pct;
  });

  return {
    products: featured.slice(0, pageSize),
    totalCount: totalCount ?? 0,
  };
}

export async function getValidSubcategories(category: TopCategory): Promise<string[]> {
  const data = await fetchAllRows<{ subcategory: string | null }>(offset =>
    supabase
      .from('products')
      .select('subcategory')
      .eq('top_category', category)
      .not('subcategory', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1),
  );

  const unique = new Set<string>();
  for (const row of data) {
    if (row.subcategory) unique.add(row.subcategory);
  }
  return Array.from(unique);
}
