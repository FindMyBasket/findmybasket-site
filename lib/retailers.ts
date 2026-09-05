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
//
// ── IT THROWS, AND THE REASON IS THAT THE FAILURE IS OTHERWISE UNDETECTABLE ──
//
// It used to read `const { data } = ...` and return `new Set((data ?? []))`. On any failure that is
// an EMPTY SET, and six of the eight callers feed it straight into `.in('retailer_id', [...])`,
// which matches nothing. Every card on every listing page then renders with no retailer, no price
// and no saving -- on a 200, with a correct-looking product count above it.
//
// THAT FAILURE PRODUCES NO LOG LINE, NO ALERT, NO 500 AND NO EDGE-LOG ENTRY. It is not a bad
// failure that went unnoticed; it is one that CANNOT be noticed. A thrown error reaches Vercel's
// runtime logs and get_runtime_errors. That asymmetry -- observable against unobservable -- is a
// stronger reason to throw than anything a visitor sees. Item 596.
//
// THE cache() WRAPPER IS LOAD-BEARING AND MUST STAY. React memoises per request INCLUDING a
// rejection, so this is one failure per request rather than one per call site. Without it, eight
// independent calls could each succeed or fail and a page could render some modules priced and
// others not -- a half-priced page, which is worse than either extreme because nothing about it
// looks wrong.
export const getActiveRetailerIds = cache(async (): Promise<Set<number>> => {
  const { data, error } = await supabase.from('retailers').select('id').eq('active', true);
  if (error) throw new Error(`getActiveRetailerIds failed: ${error.message}`);
  // An empty table is not a real state and must not be reported as one: every caller would
  // silently price nothing. Treated as a failed read, because that is what it would mean.
  if (!data || data.length === 0) throw new Error('getActiveRetailerIds returned no active retailers');
  return new Set(data.map((r) => r.id as number));
});

/**
 * The same set, degrading to EMPTY instead of throwing. Two callers, both named at the call site.
 *
 * NOT A GENERAL ESCAPE HATCH. It exists because the throw/empty choice is not uniform across the
 * eight callers: on a listing page an empty result is a lie a visitor cannot detect, and on the
 * PRODUCT page it inverts. The product page's price table runs its own retailers query and never
 * touches this function, so the comparison the visitor arrived for is unaffected either way --
 * which means throwing there would destroy a working page because a recommendation strip could not
 * load. Empty is right where the missing content is decoration, and only there.
 *
 * It calls the cached function, so a rejection is still memoised once per request and this adds no
 * second query.
 */
export async function getActiveRetailerIdsOrEmpty(): Promise<Set<number>> {
  try {
    return await getActiveRetailerIds();
  } catch {
    return new Set<number>();
  }
}

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
export type ListedRetailer = { name: string; logoPath: string | null };

export const getListedRetailers = cache(async (): Promise<ListedRetailer[] | null> => {
  const { data, error } = await supabase
    .from('retailers')
    .select('name, logo_path')
    .eq('active', true)
    .is('unlisted_reason', null)
    .order('name');
  if (error || !data || data.length === 0) return null;
  return data.map((r) => ({
    name: r.name as string,
    logoPath: (r.logo_path as string | null) ?? null,
  }));
});

// ONE QUERY, ONE PREDICATE, TWO RENDERINGS. The count below and the logo strip on the
// homepage both come out of getListedRetailers, so the number and the marks cannot
// disagree about who is listed. Item 530.
//
// THEY CAN DISAGREE ABOUT HOW MANY ARE PICTURED, AND THAT IS THE DESIGN. logo_path is
// nullable: a retailer added without one is counted and not pictured, because the strip
// rendering without a mark is better than rendering a broken image. The number is the
// authoritative claim and the marks illustrate it.
export const getListedRetailerCount = cache(async (): Promise<number | null> => {
  const rows = await getListedRetailers();
  return rows === null ? null : rows.length;
});
