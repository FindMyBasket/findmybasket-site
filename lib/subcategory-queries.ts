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

// Stats for a category + subcategory page
export async function getSubcategoryStats(
  category: TopCategory,
  subcategory: string
): Promise<SubcategoryStats> {
  const { count: totalProducts } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('top_category', category)
    .eq('subcategory', subcategory);

  const { data: brandRows } = await supabase
    .from('products')
    .select('normalised_brand')
    .eq('top_category', category)
    .eq('subcategory', subcategory)
    .not('normalised_brand', 'is', null);

  const distinctBrands = new Set((brandRows ?? []).map(r => r.normalised_brand));

  const { data: retailerRows } = await supabase
    .from('retailer_prices')
    .select('retailer_id, products!inner(top_category, subcategory)')
    .eq('products.top_category', category)
    .eq('products.subcategory', subcategory);

  const totalRetailers = new Set((retailerRows ?? []).map(r => r.retailer_id)).size;

  return {
    total_products: totalProducts ?? 0,
    total_brands: distinctBrands.size,
    total_retailers: totalRetailers,
  };
}

// Product type chips for the subcategory page (Cleanser, Serum, Moisturiser etc.)
export async function getProductTypes(
  category: TopCategory,
  subcategory: string,
  limit = 12
): Promise<ProductTypeChip[]> {
  const { data } = await supabase
    .from('products')
    .select('product_type')
    .eq('top_category', category)
    .eq('subcategory', subcategory)
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

// Top brands within this subcategory
export async function getSubcategoryTopBrands(
  category: TopCategory,
  subcategory: string,
  limit = 16
): Promise<TopBrand[]> {
  const { data } = await supabase
    .from('products')
    .select('normalised_brand, brand')
    .eq('top_category', category)
    .eq('subcategory', subcategory)
    .not('normalised_brand', 'is', null);

  if (!data) return [];

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

// Featured products in a subcategory, paginated
export async function getSubcategoryProducts(
  category: TopCategory,
  subcategory: string,
  page = 1,
  pageSize = 48
): Promise<{ products: FeaturedProduct[]; totalCount: number }> {
  // Pull the matching product IDs first - using a wider candidate pool than
  // pageSize so we have enough multi-retailer products to fill the page
  const offset = (page - 1) * pageSize;
  const candidateLimit = pageSize * 4;

  const { data: products, count: totalCount } = await supabase
    .from('products')
    .select('id, name, brand, normalised_brand, product_type, subcategory, image_url', { count: 'exact' })
    .eq('top_category', category)
    .eq('subcategory', subcategory)
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

// Pre-build list of valid subcategories for static generation
export async function getValidSubcategories(category: TopCategory): Promise<string[]> {
  const { data } = await supabase
    .from('products')
    .select('subcategory')
    .eq('top_category', category)
    .not('subcategory', 'is', null);

  if (!data) return [];

  const unique = new Set<string>();
  for (const row of data) {
    if (row.subcategory) unique.add(row.subcategory);
  }
  return Array.from(unique);
}
