import { supabase } from './supabase';
import { applyImporterRule, brandSlug, type FeaturedProduct, type TopCategory } from './queries';

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
      .from('products_active')
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
    .from('products_active')
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

// Defines display order, NOT inclusion. Categories not listed sort to the end
// alphabetically. Routine order: skincare -> makeup -> hair -> nails.
const CATEGORY_ORDER: string[] = [
  // Skincare in routine order
  'Cleanser', 'Exfoliator', 'Toner', 'Mist',
  'Essence', 'Serum', 'Treatment', 'Oil',
  'Eye Care',
  'Moisturiser', 'Mask', 'SPF',
  // Makeup
  'Primer', 'Foundation', 'Concealer', 'Powder',
  'Setting', 'Blush/Bronzer',
  'Eyeshadow', 'Eyeliner', 'Mascara', 'Brow',
  'Lipstick', 'Lip Liner', 'Lip Colour', 'Lip Care',
  // Hair
  'Shampoo', 'Conditioner', 'Hair Treatment',
  // Nails
  'Nail Polish',
  // Catch-all generics
  'Skincare', 'Makeup',
];

// Shared product_type chip ordering. Exported so other product_type-driven chip
// surfaces (e.g. the edit page) order their chips identically.
export function compareCategories(a: string, b: string): number {
  const ai = CATEGORY_ORDER.indexOf(a);
  const bi = CATEGORY_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1; // unknowns to the end
  if (bi === -1) return -1;
  return ai - bi;
}

// Inclusion is derived from the data: every product type a brand has (minus the
// generic top-level buckets) renders as a chip. Order is the only hardcoded
// part — CATEGORY_ORDER above, unknowns alphabetical at the end. No cap.
export async function getBrandProductTypes(
  normalisedBrand: string
): Promise<BrandProductTypeChip[]> {
  const { data } = await supabase
    .from('products_active')
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
    .sort((a, b) => compareCategories(a.product_type, b.product_type));
}

export async function getBrandProducts(
  normalisedBrand: string,
  page = 1,
  pageSize = 48,
  productType?: string,
  topCategory?: string
): Promise<{ products: FeaturedProduct[]; totalCount: number }> {
  const offset = (page - 1) * pageSize;
  const candidateLimit = pageSize * 4;

  let query = supabase
    .from('products_active')
    .select('id, name, brand, normalised_brand, product_type, subcategory, image_url', { count: 'exact' })
    .eq('normalised_brand', normalisedBrand)
    .not('image_url', 'is', null)
    .neq('image_url', '')
    .not('tags', 'cs', '{cleanup_remove}');

  // `productType` filters the fine-grained product_type (e.g. "Lipstick");
  // `topCategory` filters the coarse top_category (skincare/makeup/hair). They
  // sit on different axes, so both can apply, but the UI uses one at a time.
  if (productType) {
    query = query.eq('product_type', productType);
  }
  if (topCategory) {
    query = query.eq('top_category', topCategory);
  }

  const { data: products, count: totalCount } = await query
    .range(offset, offset + candidateLimit - 1);

  if (!products || products.length === 0) {
    return { products: [], totalCount: totalCount ?? 0 };
  }

  const productIds = products.map(p => p.id);

  // NOTE: unlike the category/subcategory/featured surfaces, the brand page is a
  // brand catalogue — a fan wants the full range, so we DON'T filter by in_stock
  // here. Fully out-of-stock products still render (as "Out of stock" cards);
  // pricing + retailer count are still computed from in-stock rows only.
  const { data: prices } = await supabase
    .from('retailer_prices')
    .select('product_id, retailer_id, price, in_stock')
    .in('product_id', productIds);

  if (!prices) return { products: [], totalCount: totalCount ?? 0 };

  const byProduct = new Map<number, { retailer_id: number; price: number; in_stock: boolean }[]>();
  for (const p of prices) {
    if (!p.product_id || !p.price) continue;
    const arr = byProduct.get(p.product_id) ?? [];
    arr.push({ retailer_id: p.retailer_id, price: Number(p.price), in_stock: !!p.in_stock });
    byProduct.set(p.product_id, arr);
  }

  const featured: FeaturedProduct[] = [];
  for (const product of products) {
    const rows = byProduct.get(product.id);
    if (!rows || rows.length === 0) continue; // no retailer carries it → nothing to show

    // Pricing + count from IN-STOCK rows only — unchanged behaviour for products
    // that are buyable (incl. partially-OOS, where some retailers are in stock).
    const inStock = applyImporterRule(rows.filter(r => r.in_stock));

    let minPrice: number | null;
    let maxPrice: number | null;
    let savingPct: number;
    let retailerCount: number;

    if (inStock.prices.length > 0) {
      minPrice = Math.min(...inStock.prices);
      maxPrice = Math.max(...inStock.prices);
      savingPct = maxPrice > 0 ? Math.round(((maxPrice - minPrice) / maxPrice) * 100) : 0;
      retailerCount = inStock.retailerCount;
    } else {
      // Fully out of stock: null price → ProductCard renders "Out of stock".
      // Count the retailers that carry it (importer rule over all rows) so the
      // card still reads "N retailer(s)".
      minPrice = null;
      maxPrice = null;
      savingPct = 0;
      retailerCount = applyImporterRule(rows).retailerCount;
    }

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
    // In-stock products first (no regression to existing ordering), OOS last.
    const aIn = a.min_price !== null;
    const bIn = b.min_price !== null;
    if (aIn !== bIn) return aIn ? -1 : 1;
    if (b.retailer_count !== a.retailer_count) return b.retailer_count - a.retailer_count;
    return b.saving_pct - a.saving_pct;
  });

  return {
    products: featured.slice(0, pageSize),
    totalCount: totalCount ?? 0,
  };
}
