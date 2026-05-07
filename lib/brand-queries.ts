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

// Reverse-slug lookup: given a slug like "the-ordinary", find the actual
// normalised_brand string in the database that matches.
export async function findBrandBySlug(slug: string): Promise<BrandLookup | null> {
  const { data } = await supabase
    .from('products')
    .select('normalised_brand, brand')
    .not('normalised_brand', 'is', null);

  if (!data) return null;

  // Pick the most common display name for this slug
  const matches = new Map<string, number>();
  let chosenNormalised: string | null = null;

  for (const row of data) {
    if (!row.normalised_brand) continue;
    if (brandSlug(row.normalised_brand) === slug) {
      chosenNormalised = row.normalised_brand;
      const display = row.brand ?? row.normalised_brand;
      matches.set(display, (matches.get(display) ?? 0) + 1);
    }
  }

  if (!chosenNormalised) return null;

  // Most-frequent display name wins
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

// Stats for a brand page hero
export async function getBrandStats(normalisedBrand: string): Promise<BrandStats> {
  // Total products and category breakdown
  const { data: catRows, count: totalProducts } = await supabase
    .from('products')
    .select('top_category', { count: 'exact' })
    .eq('normalised_brand', normalisedBrand)
    .not('top_category', 'is', null);

  const breakdown = new Map<string, number>();
  for (const row of catRows ?? []) {
    if (!row.top_category) continue;
    breakdown.set(row.top_category, (breakdown.get(row.top_category) ?? 0) + 1);
  }
  const category_breakdown = Array.from(breakdown.entries())
    .map(([category, count]) => ({ category: category as TopCategory, count }))
    .sort((a, b) => b.count - a.count);

  // Distinct retailers
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

// Product type chips for the brand page
export async function getBrandProductTypes(
  normalisedBrand: string,
  limit = 12
): Promise<BrandProductTypeChip[]> {
  const { data } = await supabase
    .from('products')
    .select('product_type')
    .eq('normalised_brand', normalisedBrand)
    .not('product_type', 'is', null);

  if (!data) return [];

  const counts = new Map<string, number>();
  for (const row of data) {
    if (!row.product_type) continue;
    counts.set(row.product_type, (counts.get(row.product_type) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([product_type, count]) => ({ product_type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// Paginated products for a brand page
export async function getBrandProducts(
  normalisedBrand: string,
  page = 1,
  pageSize = 48
): Promise<{ products: FeaturedProduct[]; totalCount: number }> {
  const offset = (page - 1) * pageSize;
  const candidateLimit = pageSize * 4;

  const { data: products, count: totalCount } = await supabase
    .from('products')
    .select('id, name, brand, normalised_brand, product_type, subcategory, image_url', { count: 'exact' })
    .eq('normalised_brand', normalisedBrand)
    .not('image_url', 'is', null)
    .neq('image_url', '')
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

  const byProduct = new Map<number, { retailers: Set<number>; prices: number[] }>();
  for (const p of prices) {
    if (!p.product_id || !p.price) continue;
    const entry = byProduct.get(p.product_id) ?? { retailers: new Set(), prices: [] };
    entry.retailers.add(p.retailer_id);
    entry.prices.push(Number(p.price));
    byProduct.set(p.product_id, entry);
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

  // Sort: multi-retailer first (by count desc + savings), then single-retailer
  featured.sort((a, b) => {
    if (b.retailer_count !== a.retailer_count) return b.retailer_count - a.retailer_count;
    return b.saving_pct - a.saving_pct;
  });

  return {
    products: featured.slice(0, pageSize),
    totalCount: totalCount ?? 0,
  };
}
