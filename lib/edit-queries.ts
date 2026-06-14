import { supabase } from './supabase';
import { brandSlug, type FeaturedProduct, type TopBrand } from './queries';
import { compareCategories, type BrandProductTypeChip } from './brand-queries';
import type { Edit } from './edits';

export interface EditStats {
  total_products: number;
  total_brands: number;
  total_retailers: number;
}

export async function getEditStats(edit: Edit): Promise<EditStats> {
  const productIds = await getEditProductIds(edit);

  if (productIds.length === 0) {
    return { total_products: 0, total_brands: 0, total_retailers: 0 };
  }

  const { data: brandRows } = await supabase
    .from('products_active')
    .select('normalised_brand')
    .in('id', productIds)
    .not('normalised_brand', 'is', null)
    .not('tags', 'cs', '{cleanup_remove}');

  const distinctBrands = new Set((brandRows ?? []).map(r => r.normalised_brand));

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

export async function getEditTopBrands(edit: Edit, limit = 16): Promise<TopBrand[]> {
  const productIds = await getEditProductIds(edit);

  if (productIds.length === 0) return [];

  const { data } = await supabase
    .from('products_active')
    .select('normalised_brand, brand')
    .in('id', productIds)
    .not('normalised_brand', 'is', null)
    .not('tags', 'cs', '{cleanup_remove}');

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

// ── Product-type chip filter (used by the edit page) ─────────────────────────
// Same pattern as the brand and subcategory pages: chips are derived from the
// product_type column, products are filtered by a ?type= query param, and the
// grid is paginated. Cushions land under the Foundation chip (and Masks stays
// clean) purely because the importer types cushion foundations as
// makeup/Foundation — there is no bespoke cushion handling here.

const PAGE_SIZE = 48;
const SUPABASE_PAGE = 1000; // Supabase per-request row cap

// Every product_type the edit's brand set has (minus the generic top-level
// buckets) renders as a chip, ordered by the shared CATEGORY_ORDER. Mirrors
// getBrandProductTypes, but paginated: a single brand rarely exceeds the 1000-
// row cap whereas an edit spans tens of thousands of products, so an un-ranged
// select would silently truncate the chip set.
export async function getEditProductTypes(edit: Edit): Promise<BrandProductTypeChip[]> {
  if (edit.brand_slugs.length === 0) return [];

  const JUNK_TYPES = new Set(['Skincare', 'Makeup', 'Hair']);
  const counts = new Map<string, number>();

  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('products_active')
      .select('product_type')
      .in('normalised_brand', edit.brand_slugs)
      .not('product_type', 'is', null)
      .not('tags', 'cs', '{cleanup_remove}')
      .order('id', { ascending: true })
      .range(from, from + SUPABASE_PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      if (!row.product_type) continue;
      if (JUNK_TYPES.has(row.product_type)) continue;
      counts.set(row.product_type, (counts.get(row.product_type) ?? 0) + 1);
    }
    if (data.length < SUPABASE_PAGE) break;
    from += SUPABASE_PAGE;
  }

  return Array.from(counts.entries())
    .map(([product_type, count]) => ({ product_type, count }))
    .sort((a, b) => compareCategories(a.product_type, b.product_type));
}

// Paginated, optionally product_type-filtered product grid for the edit. Mirrors
// getBrandProducts (candidate window + in-stock retailer rollup + Stylevana
// hiding + retailer-count sort), scoped to the edit's brand set.
export async function getEditProducts(
  edit: Edit,
  page = 1,
  pageSize = PAGE_SIZE,
  productType?: string
): Promise<{ products: FeaturedProduct[]; totalCount: number }> {
  if (edit.brand_slugs.length === 0) return { products: [], totalCount: 0 };

  const offset = (page - 1) * pageSize;
  const candidateLimit = pageSize * 4;

  let query = supabase
    .from('products_active')
    .select('id, name, brand, normalised_brand, product_type, subcategory, image_url', { count: 'exact' })
    .in('normalised_brand', edit.brand_slugs)
    .not('image_url', 'is', null)
    .neq('image_url', '')
    .not('tags', 'cs', '{cleanup_remove}')
    .order('id', { ascending: true });

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
  // rationale as getBrandProducts / getRetailerOffers.
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

const productIdCache = new Map<string, number[]>();

async function getEditProductIds(edit: Edit): Promise<number[]> {
  const cacheKey = edit.slug;
  if (productIdCache.has(cacheKey)) {
    return productIdCache.get(cacheKey)!;
  }

  const productIds = new Set<number>();

  if (edit.brand_slugs.length > 0) {
    const { data: brandMatches } = await supabase
      .from('products_active')
      .select('id')
      .in('normalised_brand', edit.brand_slugs)
      .not('tags', 'cs', '{cleanup_remove}');

    for (const row of brandMatches ?? []) {
      productIds.add(row.id);
    }
  }

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
