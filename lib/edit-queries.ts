import { supabase } from './supabase';
import { brandSlug, type FeaturedProduct, type TopBrand } from './queries';
import type { Edit } from './edits';

export interface EditStats {
  total_products: number;
  total_brands: number;
  total_retailers: number;
}

// Get headline stats for an edit page
export async function getEditStats(edit: Edit): Promise<EditStats> {
  const productIds = await getEditProductIds(edit);

  if (productIds.length === 0) {
    return { total_products: 0, total_brands: 0, total_retailers: 0 };
  }

  // Distinct brands among edit products
  const { data: brandRows } = await supabase
    .from('products')
    .select('normalised_brand')
    .in('id', productIds)
    .not('normalised_brand', 'is', null);

  const distinctBrands = new Set((brandRows ?? []).map(r => r.normalised_brand));

  // Distinct retailers stocking edit products
  const { data: retailerRows } = await supabase
    .from('retailer_prices')
    .select('retailer_id')
    .in('product_id', productIds);

  const distinctRetailers = new Set((retailerRows ?? []).map(r => r.retailer_id));

  return {
    total_products: productIds.length,
    total_brands: distinctBrands.size,
    total_retailers: distinctRetailers.size,
  };
}

// Top brands within this edit, by product count
export async function getEditTopBrands(edit: Edit, limit = 16): Promise<TopBrand[]> {
  const productIds = await getEditProductIds(edit);

  if (productIds.length === 0) return [];

  const { data } = await supabase
    .from('products')
    .select('normalised_brand, brand')
    .in('id', productIds)
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

// Featured products within this edit
export async function getEditFeaturedProducts(
  edit: Edit,
  limit = 24
): Promise<FeaturedProduct[]> {
  const productIds = await getEditProductIds(edit);

  if (productIds.length === 0) return [];

  // Pull product details with images
  const { data: products } = await supabase
    .from('products')
    .select('id, name, brand, normalised_brand, product_type, subcategory, image_url')
    .in('id', productIds)
    .not('image_url', 'is', null)
    .neq('image_url', '')
    .limit(500);

  if (!products || products.length === 0) return [];

  const fetchedIds = products.map(p => p.id);

  // Pull all retailer prices for these products
  const { data: prices } = await supabase
    .from('retailer_prices')
    .select('product_id, retailer_id, price, in_stock')
    .in('product_id', fetchedIds)
    .eq('in_stock', true);

  if (!prices) return [];

  const byProduct = new Map<number, { retailers: Set<number>; prices: number[] }>();
  for (const p of prices) {
    if (!p.product_id || !p.price) continue;
    const entry = byProduct.get(p.product_id) ?? { retailers: new Set(), prices: [] };
    entry.retailers.add(p.retailer_id);
    entry.prices.push(Number(p.price));
    byProduct.set(p.product_id, entry);
  }

  // Build featured records. Allow single-retailer for edits because
  // many K-beauty products are stocked at only one retailer (Skin Cupid)
  // and we still want to show them.
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

  // Sort by retailer count desc, then by saving pct desc
  featured.sort((a, b) => {
    if (b.retailer_count !== a.retailer_count) return b.retailer_count - a.retailer_count;
    return b.saving_pct - a.saving_pct;
  });

  return featured.slice(0, limit);
}

// Internal: get the IDs of products that match an edit's criteria.
// Cached per request via a module-level memo since multiple page-level
// queries call this.
const productIdCache = new Map<string, number[]>();

async function getEditProductIds(edit: Edit): Promise<number[]> {
  const cacheKey = edit.slug;
  if (productIdCache.has(cacheKey)) {
    return productIdCache.get(cacheKey)!;
  }

  const productIds = new Set<number>();

  // Match by brand
  if (edit.brand_slugs.length > 0) {
    const { data: brandMatches } = await supabase
      .from('products')
      .select('id')
      .in('normalised_brand', edit.brand_slugs);

    for (const row of brandMatches ?? []) {
      productIds.add(row.id);
    }
  }

  // Match by retailer
  if (edit.include_retailer_ids.length > 0) {
    const { data: retailerMatches } = await supabase
      .from('retailer_prices')
      .select('product_id')
      .in('retailer_id', edit.include_retailer_ids);

    for (const row of retailerMatches ?? []) {
      if (row.product_id) productIds.add(row.product_id);
    }
  }

  const result = Array.from(productIds);
  productIdCache.set(cacheKey, result);
  return result;
}
