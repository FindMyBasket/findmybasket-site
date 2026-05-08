import { supabase } from './supabase';
import { brandSlug, type FeaturedProduct } from './queries';

export interface ProductDetail {
  id: number;
  name: string;
  brand: string | null;
  brand_slug: string | null;
  top_category: string | null;
  subcategory: string | null;
  product_type: string | null;
  image_url: string | null;
  ingredients: string[] | null;
  concerns: string[] | null;
  ean: string | null;
  canonical_size: string | null;
  shade: string | null;
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
  effective_price: number; // price + delivery if under threshold
  last_updated: string | null;
}

export async function getProductById(id: number): Promise<ProductDetail | null> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, brand, normalised_brand, top_category, subcategory, product_type, image_url, ingredients, concerns, ean, canonical_size, shade')
    .eq('id', id)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    name: data.name,
    brand: data.brand,
    brand_slug: data.normalised_brand ? brandSlug(data.normalised_brand) : null,
    top_category: data.top_category,
    subcategory: data.subcategory,
    product_type: data.product_type,
    image_url: data.image_url,
    ingredients: data.ingredients,
    concerns: data.concerns,
    ean: data.ean,
    canonical_size: data.canonical_size,
    shade: data.shade,
  };
}

export async function getRetailerOffers(productId: number): Promise<RetailerOffer[]> {
  // Pull retailer prices joined with retailer metadata
  const { data: prices } = await supabase
    .from('retailer_prices')
    .select(`
      retailer_id,
      price,
      url,
      in_stock,
      last_updated
    `)
    .eq('product_id', productId);

  if (!prices || prices.length === 0) return [];

  // Get retailer metadata
  const retailerIds = Array.from(new Set(prices.map(p => p.retailer_id)));
  const { data: retailers } = await supabase
    .from('retailers')
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

  // Sort: in-stock first, then by effective price ascending
  offers.sort((a, b) => {
    if (a.in_stock !== b.in_stock) return a.in_stock ? -1 : 1;
    return a.effective_price - b.effective_price;
  });

  return offers;
}

// Related products: same brand or same product_type, excluding current
export async function getRelatedProducts(product: ProductDetail, limit = 6): Promise<FeaturedProduct[]> {
  if (!product.brand && !product.product_type) return [];

  // First try same brand + same product_type (most specific)
  let candidates = await fetchRelated(product, true, true);

  // Fallback: same product_type only
  if (candidates.length < limit && product.product_type) {
    const more = await fetchRelated(product, false, true);
    candidates = mergeUnique(candidates, more);
  }

  // Fallback: same brand only
  if (candidates.length < limit && product.brand) {
    const more = await fetchRelated(product, true, false);
    candidates = mergeUnique(candidates, more);
  }

  return candidates.slice(0, limit);
}

async function fetchRelated(
  product: ProductDetail,
  matchBrand: boolean,
  matchType: boolean
): Promise<FeaturedProduct[]> {
  let query = supabase
    .from('products')
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

  // Get retailer counts and prices
  const productIds = rows.map(r => r.id);
  const { data: prices } = await supabase
    .from('retailer_prices')
    .select('product_id, retailer_id, price, in_stock')
    .in('product_id', productIds)
    .eq('in_stock', true);

  const byProduct = new Map<number, { retailers: Set<number>; prices: number[] }>();
  for (const p of prices ?? []) {
    if (!p.product_id || !p.price) continue;
    const entry = byProduct.get(p.product_id) ?? { retailers: new Set(), prices: [] };
    entry.retailers.add(p.retailer_id);
    entry.prices.push(Number(p.price));
    byProduct.set(p.product_id, entry);
  }

  const results: FeaturedProduct[] = [];
  for (const row of rows) {
    const entry = byProduct.get(row.id);
    if (!entry || entry.retailers.size === 0) continue;
    const minPrice = Math.min(...entry.prices);
    const maxPrice = Math.max(...entry.prices);
    const savingPct = maxPrice > 0 ? Math.round(((maxPrice - minPrice) / maxPrice) * 100) : 0;
    results.push({
      id: row.id,
      name: row.name,
      brand: row.brand,
      brand_slug: row.normalised_brand ? brandSlug(row.normalised_brand) : null,
      product_type: row.product_type,
      subcategory: row.subcategory,
      image_url: row.image_url,
      retailer_count: entry.retailers.size,
      min_price: minPrice,
      max_price: maxPrice,
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
