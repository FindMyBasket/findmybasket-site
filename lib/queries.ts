import { supabase } from './supabase';
import { getActiveRetailerIds } from './retailers';

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

// Display labels for each top_category. Shared by the cross-category surfaces
// (category chips, brand "Available in" line) so the wording stays in one place.
export const CATEGORY_DISPLAY: Record<TopCategory, string> = {
  skincare: 'Skincare',
  makeup: 'Makeup',
  hair: 'Hair',
  fragrance: 'Fragrance',
  bath_body: 'Bath & Body',
};

// Routine order for rendering a set of categories (e.g. "also in Skincare,
// Makeup, Hair"). Unknown values sort to the end in their original order.
const CATEGORY_DISPLAY_ORDER: TopCategory[] = ['skincare', 'makeup', 'hair', 'fragrance', 'bath_body'];

export function sortCategories(cats: string[]): string[] {
  return [...cats].sort((a, b) => {
    const ai = CATEGORY_DISPLAY_ORDER.indexOf(a as TopCategory);
    const bi = CATEGORY_DISPLAY_ORDER.indexOf(b as TopCategory);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

export function categoryDisplay(cat: string): string {
  return CATEGORY_DISPLAY[cat as TopCategory] ?? cat;
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
  // Null when no retailer is in stock — render as "Out of stock" rather than
  // £Infinity (Math.min([]) === Infinity guard).
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

// Specialist import retailers: Stylevana #11, YesStyle #25, Atelier De Glow #29.
// Presentational ONLY — drives the "Specialist import" badge so longer delivery
// and possible customs charges are set out before the click. These retailers are
// never hidden or de-ranked; they compete on price like any other.
export const SPECIALIST_IMPORTER_RETAILER_IDS = new Set<number>([11, 25, 29]);

// Summarise a product's price rows for card display. Deliberately unfiltered:
// every active in-stock retailer counts and competes.
//
// This previously hid importers whenever a mainstream retailer was in stock,
// because Stylevana feed 98661 carried unreliable product URLs. Stylevana is now
// on feed 101286 and link quality was spot-checked in production (2026-07-20:
// 18/18 URLs resolved to live, correctly-titled product pages), so the rule has
// been removed per its own sunset condition. It was suppressing the lowest price
// on 1,246 product pages.
//
// Note for anyone reintroducing a filter here: filter by retailer_id, never by
// price value. The original value-based filter dropped a non-importer whose price
// coincided with an importer's, emptying the price array while a retailer
// remained → Math.min([]) === Infinity (the £Infinity brand-page bug).
export function summarisePriceRows(
  rows: { retailer_id: number; price: number }[]
): { retailerCount: number; prices: number[] } {
  return {
    retailerCount: new Set(rows.map(r => r.retailer_id)).size,
    prices: rows.map(r => r.price),
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

  const activeRetailerIds = await getActiveRetailerIds();
  const retailerIdSet = new Set<number>();
  for (const p of productRetailerRows) {
    for (const rp of p.retailer_prices ?? []) {
      if (activeRetailerIds.has(rp.retailer_id)) retailerIdSet.add(rp.retailer_id);
    }
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

export interface CrossCategoryBrand {
  name: string;            // display brand
  slug: string;            // /brands/[slug]
  in_this: number;         // products in the current category
  other_categories: string[]; // raw top_category values, routine-ordered
}

// Brands that genuinely sit in more than one top_category but which we do NOT
// want to surface as "discovery" chips: retailer own-brands (Superdrug, Boots,
// the truncated "perfume shop s") and mislabeled feed dumps whose cross-category
// counts are an artefact, not a real range (Kose/Cosy). Keyed on normalised_brand
// (lowercase). Extend here if another own-brand/noise entry crowds the chips.
const CROSS_CATEGORY_BRAND_DENYLIST = new Set<string>([
  'superdrug',
  'boots',
  'perfume shop s',
  'kose',
  'cosy',
]);

// Cross-category brand chips (Change 1). Brands with meaningful inventory in BOTH
// `category` and at least one other top_category, ranked by their presence in
// this category, for the "Brands also available in other categories" section.
// Heavy aggregation runs in the fmb_cross_category_brands RPC; here we just drop
// denylisted noise and take the top `limit`. Cached hourly via the page's ISR.
export async function getCrossCategoryBrands(
  category: TopCategory,
  limit = 13
): Promise<CrossCategoryBrand[]> {
  const { data, error } = await supabase.rpc('fmb_cross_category_brands', {
    p_category: category,
    p_min_this: 5,
    p_min_other: 5,
    p_limit: 40,
  });

  if (error || !data) return [];

  const rows = data as {
    normalised_brand: string;
    brand: string | null;
    in_this: number;
    other_categories: string[] | null;
  }[];

  return rows
    .filter(r => r.normalised_brand && !CROSS_CATEGORY_BRAND_DENYLIST.has(r.normalised_brand))
    .slice(0, limit)
    .map(r => ({
      name: r.brand ?? r.normalised_brand,
      slug: brandSlug(r.normalised_brand),
      in_this: Number(r.in_this),
      other_categories: sortCategories(r.other_categories ?? []),
    }));
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

  const activeRetailerIds = await getActiveRetailerIds();
  const { data: prices } = await supabase
    .from('retailer_prices')
    .select('product_id, retailer_id, price, in_stock')
    .in('product_id', productIds)
    .in('retailer_id', [...activeRetailerIds])
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
    const { retailerCount, prices: priceList } = summarisePriceRows(rows);
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