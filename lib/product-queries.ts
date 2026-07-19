import { supabase } from './supabase';
import { getActiveRetailerIds } from './retailers';
import { applyImporterRule, brandSlug, nextBestSavingPct, nextBestPrice, IMPORTER_RETAILER_IDS, type FeaturedProduct } from './queries';

export interface ProductDetail {
  id: number;
  name: string;
  brand: string | null;
  brand_slug: string | null;
  normalised_brand: string | null;
  top_category: string | null;
  subcategory: string | null;
  product_type: string | null;
  image_url: string | null;
  ingredients: string[] | null;
  concerns: string[] | null;
  ean: string | null;
  canonical_size: string | null;
  shade: string | null;
  description: string | null;
  amazon_asin: string | null;
}

export interface RetailerOffer {
  retailer_id: number;
  retailer_name: string;
  base_url: string;
  price: number;
  url: string;
  in_stock: boolean;
  delivery_cost: number | null;
  delivery_threshold: number | null;
  effective_price: number;
  last_updated: string | null;
}

export async function getProductById(id: number): Promise<ProductDetail | null> {
  const { data, error } = await supabase
    .from('products_active')
    .select('id, name, brand, normalised_brand, top_category, subcategory, product_type, image_url, ingredients, concerns, ean, canonical_size, shade, description, amazon_asin')
    .eq('id', id)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    name: data.name,
    brand: data.brand,
    brand_slug: data.normalised_brand ? brandSlug(data.normalised_brand) : null,
    normalised_brand: data.normalised_brand,
    top_category: data.top_category,
    subcategory: data.subcategory,
    product_type: data.product_type,
    image_url: data.image_url,
    ingredients: data.ingredients,
    concerns: data.concerns,
    ean: data.ean,
    canonical_size: data.canonical_size,
    shade: data.shade,
    description: data.description ?? null,
    amazon_asin: data.amazon_asin ?? null,
  };
}

// Resolve a requested product id to the live, indexable page that should carry
// its SEO equity when the requested row is hidden from products_active. Two ways
// a row gets hidden, both redirected here to the surviving canonical:
//   - soft-merged (merged_into set)         -> follow to the keeper
//   - shade-variant child (parent set)      -> follow to the parent
// Both are followed TRANSITIVELY and interleaved: a shade child whose parent was
// later merged resolves child -> parent -> keeper, and nested parents (a parent
// that is itself a child) resolve all the way up. At each hop merged_into takes
// priority over parent_product_id (a row should not have both; if it did, the
// merge wins). Loop-safe via a visited set plus a hop cap.
//
// Returns null (caller 404s) when: the id is unknown; the requested id is itself
// the terminal non-hidden row (caller already tried products_active); the chain
// does not resolve within the hop cap; OR the resolved target is NOT in
// products_active. That last guard is deliberate — it keeps the genuinely-thin
// rows (no image, no live price) as a correct 404 and, crucially, never redirects
// to a page that would itself 404.
export async function resolveCanonicalKeeper(id: number): Promise<number | null> {
  let current = id;
  const seen = new Set<number>();
  let resolved = false;
  for (let hops = 0; hops < 12; hops++) {
    if (seen.has(current)) return null;           // cycle guard
    seen.add(current);
    const { data } = await supabase
      .from('products')
      .select('merged_into, parent_product_id')
      .eq('id', current)
      .maybeSingle();
    if (!data) return null;                        // unknown id
    const next = data.merged_into ?? data.parent_product_id;
    if (next === null) { resolved = true; break; } // reached the terminal non-merged, non-child row
    current = next;
  }
  if (!resolved) return null;                      // hop-cap safety: don't redirect into an unresolved chain
  if (current === id) return null;                 // requested id is itself terminal (hidden for another reason)

  // Only redirect to a genuinely live, indexable page. A no-image / no-price
  // ancestor is not in products_active, so we return null and let the requested
  // url stay a legitimate 404 rather than redirect into a dead end.
  const { data: live } = await supabase
    .from('products_active')
    .select('id')
    .eq('id', current)
    .maybeSingle();
  return live ? current : null;
}

export async function getRetailerOffers(productId: number): Promise<RetailerOffer[]> {
  const { data: prices } = await supabase
    .from('retailer_prices')
    .select('retailer_id, price, url, in_stock, last_updated')
    .eq('product_id', productId);



  if (!prices || prices.length === 0) return [];

  const retailerIds = Array.from(new Set(prices.map(p => p.retailer_id)));

const { data: retailers } = await supabase    .from('retailers')
    .select('id, name, base_url, delivery_cost, delivery_threshold, active')
    .in('id', retailerIds)
    .eq('active', true);


  if (!retailers) return [];

  const retailerMap = new Map(retailers.map(r => [r.id, r]));

  const offers: RetailerOffer[] = [];
  for (const price of prices) {
    const retailer = retailerMap.get(price.retailer_id);
    if (!retailer) continue;
    if (!price.price || !price.url) continue;

    const numericPrice = Number(price.price);
    const deliveryCost = retailer.delivery_cost ? Number(retailer.delivery_cost) : null;
    const deliveryThreshold = retailer.delivery_threshold ? Number(retailer.delivery_threshold) : null;

    const effectivePrice =
      deliveryCost !== null && deliveryThreshold !== null && numericPrice < deliveryThreshold
        ? numericPrice + deliveryCost
        : numericPrice;

    offers.push({
      retailer_id: price.retailer_id,
      retailer_name: retailer.name,
      base_url: retailer.base_url,
      price: numericPrice,
      url: price.url,
      in_stock: price.in_stock ?? false,
      delivery_cost: deliveryCost,
      delivery_threshold: deliveryThreshold,
      effective_price: effectivePrice,
      last_updated: price.last_updated,
    });
  }

 offers.sort((a, b) => {
    if (a.in_stock !== b.in_stock) return a.in_stock ? -1 : 1;
    return a.effective_price - b.effective_price;
  });

  // Hide specialist K-beauty importers (Stylevana, YesStyle — see
  // IMPORTER_RETAILER_IDS) when a mainstream UK retailer stocks the same product,
  // since UK retailers are cheaper/faster/more trustworthy. Keep importers when
  // they're the only in-stock option (incl. when ONLY other importers stock it).
  const hasNonImporterInStock = offers.some(o => !IMPORTER_RETAILER_IDS.has(o.retailer_id) && o.in_stock);
  if (hasNonImporterInStock) {
    return offers.filter(o => !IMPORTER_RETAILER_IDS.has(o.retailer_id));
  }

  return offers;
}

export async function getRelatedProducts(product: ProductDetail, limit = 6): Promise<FeaturedProduct[]> {
  if (!product.brand && !product.product_type) return [];

  let candidates = await fetchRelated(product, true, true);

  if (candidates.length < limit && product.product_type) {
    const more = await fetchRelated(product, false, true);
    candidates = mergeUnique(candidates, more);
  }

  if (candidates.length < limit && product.brand) {
    const more = await fetchRelated(product, true, false);
    candidates = mergeUnique(candidates, more);
  }

  return candidates.slice(0, limit);
}

// "More from {Brand}" (Change 3). Other products from the same brand, with
// products in a DIFFERENT top_category surfaced first — that cross-category jump
// (e.g. a Clarins skincare page showing Clarins bath products) is the whole
// point. Driven off normalised_brand (hits idx_products_brand_producttype).
// Deterministic ordering (no RANDOM) so the ISR-cached page stays stable.
export async function getMoreFromBrand(
  normalisedBrand: string,
  currentId: number,
  currentCategory: string | null,
  limit = 12
): Promise<FeaturedProduct[]> {
  const base = () =>
    supabase
      .from('products_active')
      .select('id, name, brand, normalised_brand, product_type, subcategory, image_url, top_category')
      .eq('normalised_brand', normalisedBrand)
      .neq('id', currentId)
      .not('image_url', 'is', null)
      .neq('image_url', '')
      .not('tags', 'cs', '{cleanup_remove}');

  // Fetch the different-category and same-category pools separately so the
  // different-category candidates are guaranteed in hand (a single capped fetch
  // could return only same-category rows for a brand with a huge catalogue).
  let rows: { id: number; name: string; brand: string | null; normalised_brand: string | null; product_type: string | null; subcategory: string | null; image_url: string | null; top_category: string | null }[] = [];
  if (currentCategory) {
    const [diff, same] = await Promise.all([
      base().neq('top_category', currentCategory).limit(40),
      base().eq('top_category', currentCategory).limit(40),
    ]);
    rows = [...(diff.data ?? []), ...(same.data ?? [])];
  } else {
    const { data } = await base().limit(60);
    rows = data ?? [];
  }
  if (rows.length === 0) return [];

  const productIds = rows.map(r => r.id);
  const activeRetailerIds = await getActiveRetailerIds();
  const { data: prices } = await supabase
    .from('retailer_prices')
    .select('product_id, retailer_id, price, in_stock')
    .in('product_id', productIds)
    .in('retailer_id', [...activeRetailerIds])
    .eq('in_stock', true);

  const byProduct = new Map<number, { retailer_id: number; price: number }[]>();
  for (const p of prices ?? []) {
    if (!p.product_id || !p.price) continue;
    const arr = byProduct.get(p.product_id) ?? [];
    arr.push({ retailer_id: p.retailer_id, price: Number(p.price) });
    byProduct.set(p.product_id, arr);
  }

  const scored: (FeaturedProduct & { _diff: boolean })[] = [];
  for (const row of rows) {
    const priceRows = byProduct.get(row.id);
    if (!priceRows) continue;
    const { retailerCount, prices: priceList } = applyImporterRule(priceRows);
    if (retailerCount === 0 || priceList.length === 0) continue;
    scored.push({
      id: row.id,
      name: row.name,
      brand: row.brand,
      brand_slug: row.normalised_brand ? brandSlug(row.normalised_brand) : null,
      product_type: row.product_type,
      subcategory: row.subcategory,
      image_url: row.image_url,
      retailer_count: retailerCount,
      min_price: Math.min(...priceList),
      next_best_price: nextBestPrice(priceList),
      saving_pct: nextBestSavingPct(priceList),
      _diff: currentCategory ? row.top_category !== currentCategory : true,
    });
  }

  scored.sort((a, b) => {
    if (a._diff !== b._diff) return a._diff ? -1 : 1; // different category first
    if (b.retailer_count !== a.retailer_count) return b.retailer_count - a.retailer_count;
    return a.id - b.id; // stable, deterministic tiebreak
  });

  return scored.slice(0, limit).map(({ _diff, ...p }) => p);
}

async function fetchRelated(
  product: ProductDetail,
  matchBrand: boolean,
  matchType: boolean
): Promise<FeaturedProduct[]> {
  let query = supabase
    .from('products_active')
    .select('id, name, brand, normalised_brand, product_type, subcategory, image_url')
    .neq('id', product.id)
    .not('image_url', 'is', null)
    .neq('image_url', '')
    .limit(40);

  if (matchBrand && product.brand) {
    query = query.eq('brand', product.brand);
  }
  if (matchType && product.product_type) {
    query = query.eq('product_type', product.product_type);
  }

  const { data: rows } = await query;
  if (!rows || rows.length === 0) return [];

  const productIds = rows.map(r => r.id);
  const activeRetailerIds = await getActiveRetailerIds();
  const { data: prices } = await supabase
    .from('retailer_prices')
    .select('product_id, retailer_id, price, in_stock')
    .in('product_id', productIds)
    .in('retailer_id', [...activeRetailerIds])
    .eq('in_stock', true);

  const byProduct = new Map<number, { retailer_id: number; price: number }[]>();
  for (const p of prices ?? []) {
    if (!p.product_id || !p.price) continue;
    const arr = byProduct.get(p.product_id) ?? [];
    arr.push({ retailer_id: p.retailer_id, price: Number(p.price) });
    byProduct.set(p.product_id, arr);
  }

  const results: FeaturedProduct[] = [];
  for (const row of rows) {
    const priceRows = byProduct.get(row.id);
    if (!priceRows) continue;
    const { retailerCount, prices: priceList } = applyImporterRule(priceRows);
    if (retailerCount === 0 || priceList.length === 0) continue;
    const minPrice = Math.min(...priceList);
    const savingPct = nextBestSavingPct(priceList);
    results.push({
      id: row.id,
      name: row.name,
      brand: row.brand,
      brand_slug: row.normalised_brand ? brandSlug(row.normalised_brand) : null,
      product_type: row.product_type,
      subcategory: row.subcategory,
      image_url: row.image_url,
      retailer_count: retailerCount,
      min_price: minPrice,
      next_best_price: nextBestPrice(priceList),
      saving_pct: savingPct,
    });
  }

  results.sort((a, b) => b.retailer_count - a.retailer_count);
  return results;
}

function mergeUnique(a: FeaturedProduct[], b: FeaturedProduct[]): FeaturedProduct[] {
  const seen = new Set(a.map(p => p.id));
  const merged = [...a];
  for (const item of b) {
    if (!seen.has(item.id)) {
      merged.push(item);
      seen.add(item.id);
    }
  }
  return merged;
}