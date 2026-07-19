import { cache } from 'react';
import { supabase } from './supabase';

// Active-retailer id set, memoised per request (React cache).
//
// The listing / aggregate / related-product queries count and surface
// retailer_prices rows WITHOUT joining retailers, so on their own they would keep
// counting offers from inactive retailers — inflating "compare across N retailers"
// counts and featured-deal savings, and surfacing links to now-orphaned products.
// (products_active already excludes inactive-only products via its view predicate;
// this covers the per-offer counting/surfacing that the view can't.) Callers either
// add `.in('retailer_id', [...ids])` to their retailer_prices query or guard the
// accumulation loop with `ids.has(rp.retailer_id)`.
export const getActiveRetailerIds = cache(async (): Promise<Set<number>> => {
  const { data } = await supabase.from('retailers').select('id').eq('active', true);
  return new Set((data ?? []).map((r) => r.id as number));
});
