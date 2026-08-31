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

// ── THE LISTED COUNT: WHAT WE ARE ALLOWED TO SAY IN PUBLIC ────────────────────
//
// DELIBERATELY A DIFFERENT PREDICATE FROM getActiveRetailerIds ABOVE, and the
// difference is not an oversight. That set answers "whose offers count in a
// comparison" and takes active = true alone, because an active retailer we have
// stopped linking to still has real prices in the table. This one answers "how
// many retailers do we tell a stranger we compare", and a retailer we cannot send
// anyone to must not be counted in that sentence.
//
// BOTH TESTS ARE REQUIRED AND EITHER ALONE HAS A HOLE:
//   Superdrug        active = false, 9,375 live priced rows still in the table
//   Branded Beauty   active = true  with an unlisted_reason, unlisted 30 July,
//                    three days BEFORE the active flip
// `unlisted_reason` exists precisely for the second case -- a state no combination
// of the departure flags can describe. Item 528.
//
// THE THIN TWO ARE COUNTED, ON PURPOSE. Measured 31 Aug 2026, eleven of the
// thirteen carry 4,974 to 28,953 live priced rows; MyProtein carries 565 with its
// importer disabled and The Organic Pharmacy carries 110. They are IN.
//
//   > A volume threshold on top of this predicate would make the homepage state a
//   > different number from the one every other surface is built from. The site
//   > has one definition of a listed retailer and the headline uses it. A second
//   > definition invented for one sentence is the shape this work list has paid
//   > for repeatedly -- and the sentence is not "13 big retailers", it is "13
//   > retailers", which is true.
//
// RETURNS null RATHER THAN 0 WHEN IT CANNOT ANSWER. A count of zero is not a
// credible reading of this table, so zero means the query failed, and the caller
// renders nothing rather than "0 UK retailers". Item 194's cannot_run contract:
// an empty result and a broken instrument must not look the same.
export const getListedRetailerCount = cache(async (): Promise<number | null> => {
  const { data, error } = await supabase
    .from('retailers')
    .select('id')
    .eq('active', true)
    .is('unlisted_reason', null);
  if (error || !data || data.length === 0) return null;
  return data.length;
});
