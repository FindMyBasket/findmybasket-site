import { supabase } from './supabase';

export type TopCategory = 'skincare' | 'makeup' | 'hair' | 'fragrance' | 'bath_body';

// User-facing route slug for each top_category. Identity for all except
// bath_body, whose DB value carries an underscore but whose route is the
// hyphenated /bath-and-body. Use categoryToSlug() everywhere a category value is
// turned into a landing-page URL; queries always filter on the raw DB value.
export const CATEGORY_SLUGS: Record<TopCategory, string> = {
  skincare: 'skincare',
  makeup: 'makeup',
  hair: 'hair',
  fragrance: 'fragrance',
  bath_body: 'bath-and-body',
};

export function categoryToSlug(cat: string): string {
  return CATEGORY_SLUGS[cat as TopCategory] ?? cat;
}

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
  // The next-best (second-lowest) in-stock price — a real reference price shown
  // struck through on the card, consistent with saving_pct. Null when there is
  // no second price. (Replaces the former max_price, which struck through the
  // most-expensive price and overstated the saving.)
  next_best_price: number | null;
  // Null when there is no genuine comparison to show (fewer than two in-stock
  // prices). Anchored to the next-best price, not the most expensive — see
  // nextBestSavingPct.
  saving_pct: number | null;
}

/**
 * Saving anchored to the NEXT-BEST price, not the most expensive in-stock price.
 * saving = (second-lowest - lowest) / second-lowest, over the supplied in-stock
 * prices, so a single outlier high price can no longer set the percentage.
 * Returns null when fewer than two prices exist (no genuine comparison to show)
 * or when the two best prices are equal.
 */
export function nextBestSavingPct(prices: number[]): number | null {
  if (prices.length < 2) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const lowest = sorted[0];
  const nextBest = sorted[1];
  if (!(nextBest > lowest)) return null;
  return Math.round(((nextBest - lowest) / nextBest) * 100);
}

/**
 * The next-best (second-lowest) price — the real reference price shown struck
 * through on a product card. Null when fewer than two prices exist.
 */
export function nextBestPrice(prices: number[]): number | null {
  if (prices.length < 2) return null;
  return [...prices].sort((a, b) => a - b)[1];
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

  // Inverted embed (perf): drive from the filtered products resource and embed
  // retailer_prices, instead of driving from retailer_prices and filtering the
  // embedded products (which forced a full retailer_prices scan). PR #38 canary
  // 2. Note: top categories are always large, so this is the weakest beneficiary
  // of the inversion and the prime candidate for the parked caching follow-up.
  const productRetailerRows = await fetchAllRows<{ retailer_prices: { retailer_id: number }[] | null }>(offset =>
    supabase
      .from('products')
      .select('retailer_prices(retailer_id)')
      .eq('top_category', category)
      .is('merged_into', null)
      .is('parent_product_id', null)
      .range(offset, offset + PAGE_SIZE - 1),
  );

  const retailerIdSet = new Set<number>();
  for (const p of productRetailerRows) {
    for (const rp of p.retailer_prices ?? []) retailerIdSet.add(rp.retailer_id);
  }
  const totalRetailers = retailerIdSet.size;

  // Catalogue-wide next-best average saving, precomputed and stored by
  // fmb_refresh_category_savings (weekly via pg_cron). Falls back to null if the
  // row or table is absent, so category pages never break on a missing aggregate.
  const { data: savingRow } = await supabase
    .from('category_savings')
    .select('avg_saving_pct')
    .eq('top_category', category)
    .maybeSingle();

  return {
    total_products: totalProducts ?? 0,
    total_brands: distinctBrands.size,
    total_retailers: totalRetailers,
    avg_saving_pct:
      savingRow?.avg_saving_pct != null ? Number(savingRow.avg_saving_pct) : null,
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
    const savingPct = nextBestSavingPct(priceList);

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
      next_best_price: nextBestPrice(priceList),
      saving_pct: savingPct,
    });
  }

  featured.sort((a, b) => {
    if (b.retailer_count !== a.retailer_count) return b.retailer_count - a.retailer_count;
    return (b.saving_pct ?? 0) - (a.saving_pct ?? 0);
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