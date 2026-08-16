import { supabase } from './supabase';
import { getActiveRetailerIds } from './retailers';
import { summarisePriceRows, brandSlug, nextBestSavingPct, nextBestPrice, type FeaturedProduct, type TopBrand, type TopCategory } from './queries';

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

// EVERY CALLER MUST .order() A UNIQUE COLUMN BEFORE .range().
//
// `.range()` without `.order()` is unordered LIMIT/OFFSET, and Postgres gives NO
// stability guarantee across pages: rows can be missed and others returned twice.
//
// MEASURED 16 August on supplements, running a real caller's two-page scan: it returned
// 1,719 rows against an actual 1,719 -- the RIGHT TOTAL -- while containing only 102 of
// the 117 rows carrying one subcategory value. 15 rows came back twice and 15 never came
// back. Row count reconciled, page-size arithmetic reconciled, and `719 < PAGE_SIZE` is
// this loop's own termination condition, so the read REPORTED ITSELF COMPLETE.
//
// A COUNT THAT RECONCILES IS NOT EVIDENCE THAT A PAGINATED READ IS COMPLETE. It is
// evidence that the right NUMBER of rows came back, which is a different claim and the
// easy one to check -- which is why it gets checked instead. Work-list items 146, 151.
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
    .from('products_active')
    .select('*', { count: 'exact', head: true })
    .eq('top_category', category)
    .eq('subcategory', subcategory)
    .not('tags', 'cs', '{cleanup_remove}');

  // Distinct brands — paginated row fetch
  const brandRows = await fetchAllRows<{ normalised_brand: string | null }>(offset =>
    supabase
      .from('products_active')
      .select('normalised_brand')
      .eq('top_category', category)
      .eq('subcategory', subcategory)
      .not('normalised_brand', 'is', null)
      .not('tags', 'cs', '{cleanup_remove}')
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1),
  );

  const distinctBrands = new Set(brandRows.map(r => r.normalised_brand).filter(Boolean));

  // Distinct retailers — inverted embed (perf): drive from the filtered products
  // resource (indexed on (top_category, subcategory)) and embed retailer_prices,
  // instead of driving from retailer_prices and filtering the embedded products
  // (which forced a full retailer_prices scan). PR #38 canary 2.
  const productRetailerRows = await fetchAllRows<{ retailer_prices: { retailer_id: number }[] | null }>(offset =>
    supabase
      .from('products')
      .select('retailer_prices(retailer_id)')
      .eq('top_category', category)
      .eq('subcategory', subcategory)
      .is('merged_into', null)
      .is('parent_product_id', null)
      .order('id')
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
      .from('products_active')
      .select('product_type')
      .eq('top_category', category)
      .eq('subcategory', subcategory)
      .not('product_type', 'is', null)
      .not('tags', 'cs', '{cleanup_remove}')
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1),
  );

  // CATEGORY-NAME DEFAULTS: the value the classifier emits when it has no better
  // answer. They are not product types and must never render as browse chips.
  //
  // 'Hair Care' WAS MISSING AND IS THE WHOLE REASON THIS COMMENT EXISTS. It is the hair
  // classifier's default (_shared/categorisation.ts), it covers 2,753 products -- 100%
  // of every hair row that reached a default -- and it rendered live on /hair/treatment
  // as a chip reading "Hair Care 2753" linking to ?type=Hair+Care.
  //
  // AND 'Hair' MATCHES ZERO ROWS. The classifier has never emitted it. The list held a
  // value that never existed IN PLACE OF the one that does, one word short, and three of
  // the four defaults were caught -- so the list looked complete from every angle except
  // running it against the column.
  //
  // 'Hair' is kept only so a future classifier emitting it is covered; it suppresses
  // nothing today. Verified 16 Aug: Skincare 16,539 · Hair Care 2,753 · Makeup 682 ·
  // Fragrance 266 · Hair 0. Work-list item 152.
  const JUNK_TYPES = new Set(['Skincare', 'Makeup', 'Hair', 'Hair Care', 'Fragrance']);

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
        .from('products_active')
        .select('normalised_brand, brand')
        .eq('top_category', category)
        .eq('subcategory', subcategory)
        .not('normalised_brand', 'is', null)
        .not('tags', 'cs', '{cleanup_remove}');

      if (productType) query = query.eq('product_type', productType);

      return query.order('id').range(offset, offset + PAGE_SIZE - 1);
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
    .from('products_active')
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

  const activeRetailerIds = await getActiveRetailerIds();
  const { data: prices } = await supabase
    .from('retailer_prices')
    .select('product_id, retailer_id, price, in_stock')
    .in('product_id', productIds)
    .in('retailer_id', [...activeRetailerIds])
    .eq('in_stock', true);

  if (!prices) return { products: [], totalCount: totalCount ?? 0 };

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
    if (retailerCount === 0 || priceList.length === 0) continue;

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

  return {
    products: featured.slice(0, pageSize),
    totalCount: totalCount ?? 0,
  };
}

// Reads active_category_subcategories, the view that does the DISTINCT in SQL.
//
// THIS IS THE SAME BUG THE SITEMAP HAD, AND THE SAME FIX. That view was created on
// 29 June for the sitemap, whose comment reads: "The sitemap previously enumerated
// subcategories with an un-paginated `select subcategory from products_active where
// top_category = $1`, which hits PostgREST's default 1,000-row cap." The sitemap was
// migrated onto the view. THIS CALLER, WHICH IS THE SAME QUERY, WAS NOT.
//
// Paginating it did not fix it, it changed the failure. `.range()` WITHOUT `.order()`
// is unordered LIMIT/OFFSET, and Postgres gives no stability guarantee across such
// pages -- rows can be missed and others returned twice. MEASURED 16 August on
// supplements: the two-page scan returned 1,719 rows, exactly the right TOTAL, while
// containing only 102 of the 117 `womens-health` rows. Right count, wrong rows.
//
// The consequence was a page that 404'd and 200'd for the same URL minutes apart,
// because SubcategoryPage notFound()s when the value is absent from this list -- and a
// subcategory whose rows are few enough can miss the sample entirely. IT ALSO PUT THE
// SITEMAP AND THE PAGE INTO DISAGREEMENT, with the sitemap right: /supplements/
// womens-health was listed for crawling while the page it points at returned 404.
//
// A count that matches is not evidence that a paginated read is complete. Nothing here
// could have revealed that; only comparing the rows against a SQL DISTINCT does.
// Work-list item 146.
export async function getValidSubcategories(category: TopCategory): Promise<string[]> {
  const { data, error } = await supabase
    .from('active_category_subcategories')
    .select('subcategory')
    .eq('top_category', category);

  if (error || !data) return [];

  const unique = new Set<string>();
  for (const row of data as { subcategory: string | null }[]) {
    if (row.subcategory) unique.add(row.subcategory);
  }
  return Array.from(unique);
}
