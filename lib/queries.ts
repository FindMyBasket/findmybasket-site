import { supabase } from './supabase';

export type TopCategory = 'skincare' | 'makeup' | 'hair';

export interface CategoryStats {
  total_products: number;
  total_brands: number;
  total_retailers: number;
  avg_saving_pct: number | null;
}

export interface TopBrand {
  name: string;
  slug: string;
  product_count: number;
}

export interface FeaturedProduct {
  id: number;
  name: string;
  brand: string | null;
  brand_slug: string | null;
  product_type: string | null;
  subcategory: string | null;
  image_url: string | null;
  retailer_count: number;
  // Null when no in-stock retailer remains after the importer rule — render as
  // "Out of stock" rather than £Infinity (Math.min([]) === Infinity guard).
  min_price: number | null;
  max_price: number | null;
  saving_pct: number;
}

export function brandSlug(brand: string): string {
  return brand
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Hides specialist K-beauty importers (Stylevana #11, YesStyle #25) when a
// mainstream UK retailer is in stock. Original justification: Stylevana feed
// 98661 had unreliable product URLs, so we preferred a more reliable retailer
// whenever one existed. Pending Stylevana migration to feed 101286 — when that
// ships and link quality is verified in production, this rule and the constant
// can be removed entirely (Stylevana shown alongside every other retailer).
export const IMPORTER_RETAILER_IDS = new Set<number>([11, 25]);

// Apply the importer-hide rule to a product's in-stock price rows. Filters by
// retailer_id, NOT by price value: the old value-based filter wrongly dropped a
// non-importer whose price coincided with an importer's, which could empty the
// price array while a retailer remained → Math.min([]) === Infinity (the
// £Infinity brand-page bug). Importers are hidden only when at least one
// non-importer retailer is in stock; otherwise all importers are kept.
export function applyImporterRule(
  rows: { retailer_id: number; price: number }[]
): { retailerCount: number; prices: number[] } {
  const hasNonImporter = rows.some(r => !IMPORTER_RETAILER_IDS.has(r.retailer_id));
  const kept = hasNonImporter
    ? rows.filter(r => !IMPORTER_RETAILER_IDS.has(r.retailer_id))
    : rows;
  return {
    retailerCount: new Set(kept.map(r => r.retailer_id)).size,
    prices: kept.map(r => r.price),
  };
}

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

export async function getCategoryStats(category: TopCategory): Promise<CategoryStats> {
  const { count: totalProducts } = await supabase
    .from('products_active')
    .select('*', { count: 'exact', head: true })
    .eq('top_category', category)
    .not('tags', 'cs', '{cleanup_remove}');

  const brandRows = await fetchAllRows<{ normalised_brand: string | null }>(offset =>
    supabase
      .from('products_active')
      .select('normalised_brand')
      .eq('top_category', category)
      .not('normalised_brand', 'is', null)
      .not('tags', 'cs', '{cleanup_remove}')
      .range(offset, offset + PAGE_SIZE - 1),
  );

  const distinctBrands = new Set(brandRows.map(r => r.normalised_brand).filter(Boolean));

  const retailerRows = await fetchAllRows<{ retailer_id: number }>(offset =>
    supabase
      .from('retailer_prices')
      .select('retailer_id, products!inner(top_category)')
      .eq('products.top_category', category)
      .range(offset, offset + PAGE_SIZE - 1),
  );

  const totalRetailers = new Set(retailerRows.map(r => r.retailer_id)).size;

  return {
    total_products: totalProducts ?? 0,
    total_brands: distinctBrands.size,
    total_retailers: totalRetailers,
    avg_saving_pct: null,
  };
}

export async function getTopBrands(category: TopCategory, limit = 16): Promise<TopBrand[]> {
  const data = await fetchAllRows<{ normalised_brand: string | null; brand: string | null }>(
    offset =>
      supabase
        .from('products_active')
        .select('normalised_brand, brand')
        .eq('top_category', category)
        .not('normalised_brand', 'is', null)
        .not('tags', 'cs', '{cleanup_remove}')
        .range(offset, offset + PAGE_SIZE - 1),
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

export async function getFeaturedProducts(
  category: TopCategory,
  limit = 24
): Promise<FeaturedProduct[]> {
  const { data: products } = await supabase
    .from('products_active')
    .select('id, name, brand, normalised_brand, product_type, subcategory, image_url')
    .eq('top_category', category)
    .not('image_url', 'is', null)
    .neq('image_url', '')
    .not('tags', 'cs', '{cleanup_remove}')
    .limit(500);

  if (!products || products.length === 0) return [];

  const productIds = products.map(p => p.id);

  const { data: prices } = await supabase
    .from('retailer_prices')
    .select('product_id, retailer_id, price, in_stock')
    .in('product_id', productIds)
    .eq('in_stock', true);

  if (!prices) return [];

  const byProduct = new Map<number, { retailer_id: number; price: number }[]>();
  for (const p of prices) {
    if (!p.product_id || !p.price) continue;
    const arr = byProduct.get(p.product_id) ?? [];
    arr.push({ retailer_id: p.retailer_id, price: Number(p.price) });
    byProduct.set(p.product_id, arr);
  }

  const featured: FeaturedProduct[] = [];
  for (const product of products) {
    const rows = byProduct.get(product.id);
    if (!rows) continue;
    const { retailerCount, prices: priceList } = applyImporterRule(rows);
    // Featured deals require a genuine multi-retailer comparison.
    if (retailerCount < 2 || priceList.length === 0) continue;

    const minPrice = Math.min(...priceList);
    const maxPrice = Math.max(...priceList);
    const savingPct = maxPrice > 0 ? Math.round(((maxPrice - minPrice) / maxPrice) * 100) : 0;

    featured.push({
      id: product.id,
      name: product.name,
      brand: product.brand,
      brand_slug: product.normalised_brand ? brandSlug(product.normalised_brand) : null,
      product_type: product.product_type,
      subcategory: product.subcategory,
      image_url: product.image_url,
      retailer_count: retailerCount,
      min_price: minPrice,
      max_price: maxPrice,
      saving_pct: savingPct,
    });
  }

  featured.sort((a, b) => {
    if (b.retailer_count !== a.retailer_count) return b.retailer_count - a.retailer_count;
    return b.saving_pct - a.saving_pct;
  });

  return featured.slice(0, limit);
}

export async function getSubcategories(category: TopCategory): Promise<{ name: string; count: number }[]> {
  const data = await fetchAllRows<{ subcategory: string | null }>(offset =>
    supabase
      .from('products_active')
      .select('subcategory')
      .eq('top_category', category)
      .not('subcategory', 'is', null)
      .not('tags', 'cs', '{cleanup_remove}')
      .range(offset, offset + PAGE_SIZE - 1),
  );

  const counts = new Map<string, number>();
  for (const row of data) {
    if (!row.subcategory) continue;
    counts.set(row.subcategory, (counts.get(row.subcategory) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}