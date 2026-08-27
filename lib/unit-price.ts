// Per-unit price ranking for the /compare type pages.
//
// A SEPARATE MODULE SO IT CAN BE TESTED AT ALL. `lib/brand-queries.ts` imports
// `lib/supabase`, which THROWS at module load when SUPABASE_URL is unset, so anything
// living there can only be exercised against a live database. The same constraint is
// recorded in lib/__tests__/category-labels.test.ts, which reads source as text for
// exactly this reason.
//
// Everything here is arithmetic over rows already fetched. No I/O, no imports that
// reach a network. Item 444.

export interface PerUnitProduct {
  id: number;
  name: string;
  brand: string | null;
  brand_slug: string | null;
  image_url: string | null;
  price: number;
  grams: number | null;
  per100g: number | null;
  retailer_count: number;
  /** Excluded from the ranking by the sanity bound, with the reason. */
  excluded?: string;
}
/**
 * THE RANKING DECISION, SEPARATED FROM THE I/O SO IT CAN BE EXERCISED (item 444).
 *
 * The sanity bound fires ZERO times on both live pages: whey's dearest row is 1.7x its
 * median, and creatine's one qualifying row is excluded a step earlier as a blend. An
 * unexercised guard and a guard that cannot fire are indistinguishable from the outside,
 * and the way to tell them apart is not to wait for a bad row or to loosen a filter until
 * one arrives -- it is to try to defeat the rule in both directions against synthetic
 * input, the way the held-product guard was tested.
 *
 * That is only possible if the decision does not require a database. Everything above
 * this line is I/O; everything below is arithmetic over rows already fetched.
 * lib/__tests__/unit-price-bound.test.ts drives it directly.
 */
export function rankByUnitPrice(
  all: PerUnitProduct[],
  opts: { medianRatioBound?: number; notFungible?: { test: RegExp; reason: string }[] } = {},
): { ranked: PerUnitProduct[]; unranked: PerUnitProduct[]; median: number | null; bound: number | null } {
  const RATIO = opts.medianRatioBound ?? 10;
  const NOT_FUNGIBLE = opts.notFungible ?? [];

  // Median over the FUNGIBLE priced set only. Including blends and gummies would move
  // the median that the sanity bound is a ratio of, so a non-comparable row would
  // widen the tolerance for a genuinely wrong one.
  const priced = all.filter(p => p.per100g !== null && !NOT_FUNGIBLE.some(r => r.test.test(p.name)));
  if (priced.length === 0) return { ranked: [], unranked: all, median: null, bound: null };
  const sorted = [...priced].map(p => p.per100g as number).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const bound = median * RATIO;

  const ranked: PerUnitProduct[] = [];
  const unranked: PerUnitProduct[] = [];
  for (const p of all) {
    const nf = NOT_FUNGIBLE.find(r => r.test.test(p.name));
    if (nf) { unranked.push({ ...p, excluded: nf.reason }); continue; }
    if (p.per100g === null) { unranked.push({ ...p, excluded: 'no pack size on this listing' }); continue; }
    if (p.per100g > bound) {
      unranked.push({ ...p, excluded: `priced at £${p.per100g.toFixed(2)}/100g, over ${RATIO}x the £${median.toFixed(2)} median for this type — likely a pack-size error, so it is not ranked` });
      continue;
    }
    ranked.push(p);
  }
  ranked.sort((a, b) => (a.per100g as number) - (b.per100g as number));
  return { ranked, unranked, median, bound };
}
/**
 * Exclusions every per-unit type page needs, in one place.
 *
 * WHY SHARED. Three pages wrote three exclusion lists and all three were incomplete, in
 * three different ways: whey ranked collagen blends, bar bundles and a sample (item
 * 455); creatine ranked a collagen blend; plant protein ranked three samples. Each list
 * was written from the names its author happened to read, and each missed a class the
 * others had already found. **The gap was never the same gap, which is why finding it
 * once did not fix it anywhere else.** Item 456.
 *
 * A page adds only what is specific to its own type.
 */
export const COMMON_NOT_FUNGIBLE: { test: RegExp; reason: string }[] = [
  {
    test: /\bsamples?\b/i,
    reason: 'a single-serving sample, priced per gram far above the tub it samples',
  },
  {
    test: /\b(bars?|cookie|brownie|snack|wafer)\b/i,
    reason: 'a bar or snack rather than powder — not comparable by weight',
  },
  {
    test: /\b(mass gainer|weight gainer|gainer)\b/i,
    reason: 'a mass gainer rather than a protein powder — most of the weight is carbohydrate, so price per 100g flatters it',
  },
  {
    test: /\b(recipe book|magazine|subscription|ebook)\b/i,
    reason: 'not a powder at all — matched because a word in its title is also an ingredient',
  },
  {
    // COLLAGEN IS TESTED ANYWHERE IN THE NAME, NOT AFTER THE TYPE WORD. The creatine
    // page's blend pattern required "creatine &" and so ranked "Jude Collagen &
    // Creatine Pelvic Floor Supplements" -- a word-order assumption in a rule about
    // ingredients, where order carries no meaning.
    test: /\bcollagen\b/i,
    reason: 'a collagen blend — some of the weight is collagen rather than the ingredient being compared',
  },
];
