import { supabase } from './supabase';
import { brandSlug, type FeaturedProduct, type TopCategory } from './queries';

export interface BrandLookup {
  normalised_brand: string;
  display_name: string;
}

export interface BrandStats {
  total_products: number;
  total_retailers: number;
  category_breakdown: { category: TopCategory; count: number }[];
}

export interface BrandProductTypeChip {
  product_type: string;
  count: number;
}

// Reverse-slug lookup. Does NOT filter out cleanup_remove products
// because we want brand pages to resolve even if all of a brand's
// products happen to be tagged for cleanup.
export async function findBrandBySlug(slug: string): Promise<BrandLookup | null> {
  const PAGE_SIZE = 1000;
  let offset = 0;
  const matches = new Map<string, number>();
  let chosenNormalised: string | null = null;

  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('normalised_brand, brand')
      .not('normalised_brand', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error || !data || data.length === 0) break;

    for (const row of data) {
      if (!row.normalised_brand) continue;
      if (brandSlug(row.normalised_brand) === slug) {
        chosenNormalised = row.normalised_brand;
        const display = row.brand ?? row.normalised_brand;
        matches.set(display, (matches.get(display) ?? 0) + 1);
      }
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (!chosenNormalised) return null;

  let bestDisplay = chosenNormalised;
  let bestCount = 0;
  for (const [display, count] of matches.entries()) {
    if (count > bestCount) {
      bestDisplay = display;
      bestCount = count;
    }
  }

  return {
    normalised_brand: chosenNormalised,
    display_name: bestDisplay,
  };
}

export async function getBrandStats(normalisedBrand: string): Promise<BrandStats> {
  const { data: catRows, count: totalProducts } = await supabase
    .from('products')
    .select('top_category', { count: 'exact' })
    .eq('normalised_brand', normalisedBrand)
    .not('top_category', 'is', null)
    .not('tags', 'cs', '{cleanup_remove}');

  const breakdown = new Map<string, number>();
  for (const row of catRows ?? []) {
    if (!row.top_category) continue;
    breakdown.set(row.top_category, (breakdown.get(row.top_category) ?? 0) + 1);
  }
  const category_breakdown = Array.from(breakdown.entries())
    .map(([category, count]) => ({ category: category as TopCategory, count }))
    .sort((a, b) => b.count - a.count);

  const { data: retailerRows } = await supabase
    .from('retailer_prices')
    .select('retailer_id, products!inner(normalised_brand)')
    .eq('products.normalised_brand', normalisedBrand);

  const totalRetailers = new Set((retailerRows ?? []).map(r => r.retailer_id)).size;

  return {
    total_products: totalProducts ?? 0,
    total_retailers: totalRetailers,
    category_breakdown,
  };
}

export async function getBrandProductTypes(
  normalisedBrand: string,
  limit = 12
): Promise<BrandProductTypeChip[]> {
  const { data } = await supabase
    .from('products')
    .select('product_type')
    .eq('normalised_brand', normalisedBrand)
    .not('product_type', 'is', null)
    .not('tags', 'cs', '{cleanup_remove}');

  if (!data) return [];

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

export async function getBrandProducts(
  normalisedBrand: string,
  page = 1,
  pageSize = 48,
  productType?: string
): Promise<{ products: FeaturedProduct[]; totalCount: number }> {
  const offset = (page - 1) * pageSize;
  const candidateLimit = pageSize * 4;

  let query = supabase
    .from('products')
    .select('id, name, brand, normalised_brand, product_type, subcategory, image_url', { count: 'exact' })
    .eq('normalised_brand', normalisedBrand)
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

  // Hide Stylevana from products that have UK retailer alternatives. Same
  // rationale as getRetailerOffers in product-queries.ts.
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
