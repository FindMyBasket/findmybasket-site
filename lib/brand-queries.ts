import { supabase } from './supabase';
import { getActiveRetailerIds } from './retailers';
import { summarisePriceRows, brandSlug, legacyBrandSlug, nextBestSavingPct, nextBestPrice, type FeaturedProduct, type TopCategory } from './queries';

export interface BrandLookup {
  /** The member whose spelling won the display; kept for callers needing one value. */
  normalised_brand: string;
  /**
   * EVERY normalised_brand sharing this slug, not just one (item 418).
   *
   * THE NAME UNIONED AND THE PRODUCTS DID NOT, and the asymmetry was built in rather
   * than introduced: `matches` below has always accumulated display names across every
   * matching member, while exactly one member was handed downstream. So the h1 showed
   * the union's majority name above one member's products.
   */
  normalised_brands: string[];
  display_name: string;
  /** Set only when the incoming slug is this brand's PRE-26-AUG-2026 address.
   *  The caller must 301 to it rather than render. Never set for a slug that
   *  resolves today. */
  legacyRedirectTo?: string;
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
  // LEGACY SLUG MATCH, collected in the same scan. See the redirect note below.
  let legacyNormalised: string | null = null;
  // Display names for the legacy match too. Needed because a brand that KEEPS its
  // legacy slug now renders at it rather than redirecting, so it needs a real display
  // name and not the lowercase normalised form.
  const legacyMatches = new Map<string, number>();
  // Every brand seen, so folded-slug ownership can be counted after the scan.
  // ~2,700 distinct values; the scan already reads every row.
  const allBrands = new Set<string>();
  // Every member sharing the requested slug. Six slugs have more than one today.
  const slugMembers = new Set<string>();

  while (true) {
    const { data, error } = await supabase
      .from('products_active')
      .select('normalised_brand, brand')
      .not('normalised_brand', 'is', null)
      // INTERIM FIX, 30 July 2026. The .order() is load-bearing: without it this
      // is LIMIT/OFFSET with no ORDER BY, which has NO guaranteed row order in
      // Postgres. Across the ~85 separate requests this loop makes, rows could be
      // returned twice or skipped entirely. A brand whose only row was skipped
      // resolved to null and its page returned 404 — deterministically, and
      // invisibly, because the row was present and correct in the database the
      // whole time. Measured 30 July: 6 of 30 sampled single-product brands were
      // 404ing live, roughly 60 pages. Exposure scales inversely with product
      // count, since losing one row from a one-product brand loses the brand.
      //
      // DO NOT REMOVE THIS ORDER BY to "tidy" the query or shave a sort.
      //
      // This is an interim fix, not the durable one. It corrects the result and
      // leaves the cost: ~85 sequential round-trips per brand-page render, no
      // early exit even after the brand is found, roughly 2s of latency on the
      // lookup alone. The durable fix is a single indexed lookup — see the
      // ticket, and note that brand_search_index is NOT a safe source for it
      // because its normalised_brand column diverges from products_active even
      // though brand_index_health reports no gap (that view compares brand, not
      // normalised_brand, and normalised_brand is what this route keys on).
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1);

    if (error || !data || data.length === 0) break;

    for (const row of data) {
      if (!row.normalised_brand) continue;
      allBrands.add(row.normalised_brand);
      if (brandSlug(row.normalised_brand) === slug) {
        chosenNormalised = row.normalised_brand;
        slugMembers.add(row.normalised_brand);
        const display = row.brand ?? row.normalised_brand;
        matches.set(display, (matches.get(display) ?? 0) + 1);
      } else if (
        // ── LEGACY SLUG: this brand's PRE-26-AUG-2026 address ────────────────────
        //
        // One extra comparison inside a scan that already runs. No second query.
        //
        // THE INEQUALITY IS THE LOOP GUARD AND IT IS LOAD-BEARING. For a brand with
        // no accented characters the two functions return the same string, so
        // `legacy === slug` would be true for EVERY unaccented brand and every hub
        // would 301 to its own URL. Requiring the two to DIFFER means the legacy path
        // can only fire where a character was actually deleted -- which is exactly
        // the 44 brands this exists for. Item 384.
        legacyBrandSlug(row.normalised_brand) === slug &&
        brandSlug(row.normalised_brand) !== slug
      ) {
        legacyNormalised = row.normalised_brand;
        const display = row.brand ?? row.normalised_brand;
        legacyMatches.set(display, (legacyMatches.get(display) ?? 0) + 1);
      }
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // ── BRANDS THAT KEEP A DISTINGUISHABLE LEGACY SLUG ──────────────────────────────
  //
  // NAMED FOR WHAT IT DOES, NOT FOR THE CLASS. This is NOT a collision guard and must
  // not be read as one. Measured 26 Aug 2026: 49 folded slugs are shared by more than
  // one brand, covering 102 brands and 4,530 products. THIS HANDLES SEVEN OF THEM.
  //
  // The other 42 collided long before accents were folded -- `dr. jart+` and `dr jart`,
  // `st ives` and `st. ives`, `about tone` in three spellings -- and their LEGACY slugs
  // are identical too, so there is no pair of distinct addresses to fall back to.
  // Nothing here helps them and nothing here could.
  //
  // The seven accented pairs are the subset whose legacy slugs DIFFER (`k-rastase`
  // against `kerastase`), which is the only reason a fallback address exists. They were
  // never a special class -- they are the visible part of one. Items 386 and 387.
  const keepsLegacySlug = (nb: string): boolean => {
    const folded = brandSlug(nb);
    if (folded === legacyBrandSlug(nb)) return false;          // nothing to fall back to
    let owners = 0;
    for (const other of allBrands) if (brandSlug(other) === folded) owners++;
    return owners > 1;                                          // folded address is contested
  };

  // A brand that keeps its legacy slug does not answer at its folded one, so the
  // uncontested sibling can. Without this, /brands/kerastase served Kérastase and the
  // 125-product Kerastase had no page at all.
  if (chosenNormalised && keepsLegacySlug(chosenNormalised)) {
    let replacement: string | null = null;
    for (const other of allBrands) {
      if (other !== chosenNormalised && brandSlug(other) === slug && !keepsLegacySlug(other)) {
        replacement = other;
        break;
      }
    }
    chosenNormalised = replacement;
    if (!replacement) matches.clear();
  }

  // An exact match always wins. The legacy match is only consulted when nothing
  // resolves today, so a brand cannot be redirected away from its own live page.
  if (!chosenNormalised) {
    if (legacyNormalised) {
      // A brand keeping its legacy slug RENDERS here rather than redirecting: this IS
      // its address. Only brands whose folded slug is uncontested redirect to it.
      let legacyDisplay = legacyNormalised;
      let best = 0;
      for (const [d, n] of legacyMatches.entries()) if (n > best) { legacyDisplay = d; best = n; }
      if (keepsLegacySlug(legacyNormalised)) {
        return { normalised_brand: legacyNormalised, normalised_brands: [legacyNormalised],
                 display_name: legacyDisplay };
      }
      return { normalised_brand: legacyNormalised, normalised_brands: [legacyNormalised],
               display_name: legacyDisplay, legacyRedirectTo: brandSlug(legacyNormalised) };
    }
    return null;
  }

  let bestDisplay = chosenNormalised;
  let bestCount = 0;
  for (const [display, count] of matches.entries()) {
    if (count > bestCount) {
      bestDisplay = display;
      bestCount = count;
    }
  }

  // UNION, NOT A BETTER CHOICE. `chosenNormalised` is the LAST matching row in id
  // order -- arbitrary for every colliding slug, which is how /brands/im-from came to
  // serve 1 product of 122. Unioning removes the arbitrariness rather than replacing it
  // with a different rule, so there is no tiebreak to get wrong later. Item 418.
  const members = slugMembers.size > 0 ? [...slugMembers] : [chosenNormalised];
  return {
    normalised_brand: chosenNormalised,
    normalised_brands: members,
    display_name: bestDisplay,
  };
}

/** Accepts one brand or a slug's whole member set. */
function toBrandList(b: string | string[]): string[] {
  return Array.isArray(b) ? b : [b];
}

export async function getBrandStats(normalisedBrand: string | string[]): Promise<BrandStats> {
  const brands = toBrandList(normalisedBrand);
  const { data: catRows, count: totalProducts } = await supabase
    .from('products_active')
    .select('top_category', { count: 'exact' })
    .in('normalised_brand', brands)
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

  // Inverted embed (perf): drive from the filtered products resource (indexed on
  // normalised_brand) and embed retailer_prices, instead of driving from
  // retailer_prices and filtering the embedded products. The old shape forced a
  // full retailer_prices scan (~71k rows / ~2GB buffers for a 2.2k-product brand)
  // because the selective filter sat on the embedded side. See PR #38 canary 2.
  const { data: productRetailerRows } = await supabase
    .from('products')
    .select('retailer_prices(retailer_id)')
    .in('normalised_brand', brands)
    .is('merged_into', null)
    .is('parent_product_id', null);

  const activeRetailerIds = await getActiveRetailerIds();
  const retailerIdSet = new Set<number>();
  for (const p of (productRetailerRows ?? []) as { retailer_prices: { retailer_id: number }[] | null }[]) {
    for (const rp of p.retailer_prices ?? []) {
      if (activeRetailerIds.has(rp.retailer_id)) retailerIdSet.add(rp.retailer_id);
    }
  }
  const totalRetailers = retailerIdSet.size;

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
  normalisedBrand: string | string[]
): Promise<BrandProductTypeChip[]> {
  const brands = toBrandList(normalisedBrand);
  // FIX 2C: THE IMAGE FILTER IS LOAD-BEARING AND WAS MISSING HERE.
  //
  // getBrandProducts -- the query these chips LINK TO -- requires an image. This one did
  // not, so a type whose products all lack images produced a chip with a non-zero count
  // linking to a grid with none. That is what made /brands/clean-clear?type=Cleanser a 404
  // while /brands/clean-clear served 200: the chip was counting rows the grid excludes.
  //
  // Same shape as products_active vs products_servable (item 263) -- two queries over the
  // same table disagreeing about what qualifies, and the disagreement only visible where
  // one links to the other. A chip must count exactly what its destination will show.
  // Item 271.
  const { data } = await supabase
    .from('products_active')
    .select('product_type')
    .in('normalised_brand', brands)
    .not('product_type', 'is', null)
    .not('image_url', 'is', null)
    .neq('image_url', '')
    .not('tags', 'cs', '{cleanup_remove}');

  if (!data) return [];

  const JUNK_TYPES = new Set(['Skincare', 'Makeup', 'Hair', 'Fragrance']);

  const counts = new Map<string, number>();
  for (const row of data) {
    if (!row.product_type) continue;
    if (JUNK_TYPES.has(row.product_type)) continue;
    counts.set(row.product_type, (counts.get(row.product_type) ?? 0) + 1);
  }

  // ORDERED BY COUNT, NOT BY ROUTINE ORDER. Until 26 Aug 2026 this sorted by
  // CATEGORY_ORDER -- cleanser, exfoliator, toner, serum ... -- which is the order a
  // skincare routine is APPLIED in. That is the right default for a category page, where
  // the visitor is browsing a stage. IT IS THE WRONG DEFAULT FOR A BRAND PAGE, which is
  // reached by a brand-plus-type query ("dove shampoo") where the type is already known
  // and is the only thing the visitor came to narrow by.
  //
  // Measured on /brands/dove: 17 chips, ZERO above the fold at 390x844, and Shampoo
  // eighth in the list at y=1242 behind seven skincare chips -- on a brand that is 182
  // bath & body, 70 hair and 70 skincare. Routine order led with its smallest category
  // because routine order knows nothing about the brand. Item 358.
  //
  // CATEGORY_ORDER is kept as the TIE-BREAK so equal counts stay deterministic rather
  // than falling back on Map insertion order, which is row order and therefore arbitrary.
  return Array.from(counts.entries())
    .map(([product_type, count]) => ({ product_type, count }))
    .sort((a, b) => b.count - a.count || compareCategories(a.product_type, b.product_type));
}

export async function getBrandProducts(
  normalisedBrand: string | string[],
  page = 1,
  pageSize = 48,
  productType?: string,
  topCategory?: string
): Promise<{ products: FeaturedProduct[]; totalCount: number }> {
  const brands = toBrandList(normalisedBrand);
  const offset = (page - 1) * pageSize;
  const candidateLimit = pageSize * 4;

  let query = supabase
    .from('products_active')
    .select('id, name, brand, normalised_brand, product_type, subcategory, image_url', { count: 'exact' })
    .in('normalised_brand', brands)
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

  // `.order('id')` IS LOAD-BEARING, NOT COSMETIC. `.range()` without it is
  // unordered LIMIT/OFFSET, which Postgres gives no stability guarantee for
  // across pages: the same product can appear on two pages or on none, and the
  // TOTAL still comes back right, so no count-based check detects it. This is
  // the rule stated on fetchAllRows in lib/queries.ts (items 146, 151) — which
  // this call never came under, because that rule was scoped to the PAGING
  // HELPER rather than to the hazard, and this builds its own query.
  //
  // Scale when found, 21 Aug 2026: candidateLimit is 192 and pageSize 48, so
  // 457 brands have more than one page and 106 exceed the 192-row window, the
  // largest carrying 2,220 products. Work-list item 238.
  //
  // The in-stock/retailer-count/saving sort applied further down orders WITHIN
  // the fetched window; it cannot fix which rows the window contained.
  const { data: products, count: totalCount } = await query
    .order('id', { ascending: true })
    .range(offset, offset + candidateLimit - 1);

  if (!products || products.length === 0) {
    return { products: [], totalCount: totalCount ?? 0 };
  }

  const productIds = products.map(p => p.id);

  // NOTE: unlike the category/subcategory/featured surfaces, the brand page is a
  // brand catalogue — a fan wants the full range, so we DON'T filter by in_stock
  // here. Fully out-of-stock products still render (as "Out of stock" cards);
  // pricing + retailer count are still computed from in-stock rows only.
  const activeRetailerIds = await getActiveRetailerIds();
  const { data: prices } = await supabase
    .from('retailer_prices')
    .select('product_id, retailer_id, price, in_stock')
    .in('product_id', productIds)
    .in('retailer_id', [...activeRetailerIds]);

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
    const inStock = summarisePriceRows(rows.filter(r => r.in_stock));

    let minPrice: number | null;
    let nextBestPriceVal: number | null;
    let savingPct: number | null;
    let retailerCount: number;

    if (inStock.prices.length > 0) {
      minPrice = Math.min(...inStock.prices);
      nextBestPriceVal = nextBestPrice(inStock.prices);
      savingPct = nextBestSavingPct(inStock.prices);
      retailerCount = inStock.retailerCount;
    } else {
      // Fully out of stock: null price → ProductCard renders "Out of stock".
      // Count the retailers that carry it (over all rows) so the card still
      // reads "N retailer(s)".
      minPrice = null;
      nextBestPriceVal = null;
      savingPct = null;
      retailerCount = summarisePriceRows(rows).retailerCount;
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
      next_best_price: nextBestPriceVal,
      saving_pct: savingPct,
    });
  }

  featured.sort((a, b) => {
    // In-stock products first (no regression to existing ordering), OOS last.
    const aIn = a.min_price !== null;
    const bIn = b.min_price !== null;
    if (aIn !== bIn) return aIn ? -1 : 1;
    if (b.retailer_count !== a.retailer_count) return b.retailer_count - a.retailer_count;
    return (b.saving_pct ?? 0) - (a.saving_pct ?? 0);
  });

  return {
    products: featured.slice(0, pageSize),
    totalCount: totalCount ?? 0,
  };
}

// ─── ALIAS FALLBACK: resolve a slug nobody serves to the canonical that does ──────────────
//
// Brand slugs are DERIVED from the brand string, so a rename silently orphans the old URL.
// `brand_aliases` has recorded the folds all along -- `rimmel london -> Rimmel` since
// 19 June 2026 -- and this route never consulted it. Measured 24 Aug: 30 of 49 candidate
// alias slugs returned 404 while their canonical served 200, covering brands with hundreds
// of live products. Item 271.
//
// ── THREE CONSTRAINTS, EACH FROM A MEASURED CASE. DO NOT REORDER. ────────────────────────
//
// 1. LIVE FIRST, ALIAS ONLY ON MISS. Two alias slugs are ALSO live brands:
//    /brands/nineless (live "Nineless", alias for nine-less) and /brands/vt-cosmetics
//    (live "VT Cosmetics", alias for vt). Both serve 200 today. Consulting aliases first
//    would 301 them away from working pages. TWO ROWS OUT OF 196, invisible unless looked
//    for -- which is why the order is load-bearing rather than stylistic.
//
// 2. FOLLOW THE CHAIN, WITH A CAP. A canonical can itself be an alias: mac -> m-a-c ->
//    mac-cosmetics. ON EXHAUSTION THE CALLER GETS null AND SERVES THE 404 -- it does NOT
//    redirect to the last hop reached. Partial resolution is the failure mode that would
//    look like success: a 301 to a halfway point is indistinguishable from a correct one
//    in the response, and wrong.
//
// 3. VERIFY THE TARGET BEFORE REDIRECTING. Eight aliases point at canonicals with no live
//    products -- /brands/superdrug, /brands/johnsons, /brands/pastel-cosmetics,
//    /brands/makeup-academy all 404. A 301 INTO A 404 IS WORSE THAN THE 404 IT REPLACES:
//    the doctrine's own rule, deciding its second case this week.
const ALIAS_HOP_CAP = 4;

export async function resolveBrandAliasSlug(slug: string): Promise<string | null> {
  const seen = new Set<string>([slug]);
  let current = slug;

  for (let hop = 0; hop < ALIAS_HOP_CAP; hop++) {
    const { data } = await supabase
      .from('brand_aliases')
      .select('alias, canonical')
      .limit(500);
    if (!data) return null;

    const next = data.find(r => r.canonical && brandSlug(r.canonical) !== current
      && aliasSlugOf(r) === current);
    if (!next?.canonical) break;

    const target = brandSlug(next.canonical);
    if (seen.has(target)) return null;      // cycle -> 404, never a partial redirect
    seen.add(target);
    current = target;

    // CONSTRAINT 3: only return a target that actually resolves.
    const live = await findBrandBySlug(current);
    if (live) return current;
  }

  return null;                               // cap exhausted or no alias -> caller 404s
}

function aliasSlugOf(row: { alias?: string | null; canonical?: string | null }): string {
  return brandSlug(row.alias ?? '');
}

// ─── FACTS A BRAND HUB'S METADATA MAY CLAIM ──────────────────────────────────────────────
//
// Every brand hub emitted one templated description: "Compare {Brand} prices across multiple
// UK retailers". Measured 24 Aug 2026: 2,121 of 2,784 brand pages -- 76.2%, covering 30,935
// products -- have ZERO products with more than one stockist. THE CLAIM IS UNSUPPORTABLE ON
// THREE-QUARTERS OF THE PAGES THAT MAKE IT. Item 279.
//
// NOTHING IS BAKED. The sole retailer's name and both counts are resolved per call, on the
// same call that decides which template applies, so the template and the facts it states can
// never disagree. A description naming Boots for a brand now at Escentual is the
// frozen-catalogue-state defect wearing metadata, and deriving at render is the only guard.
//
// STALENESS IS THE PAGE'S OWN. The route sets revalidate = 3600 with no generateStaticParams,
// so metadata and body regenerate together from live data. A count in the description cannot
// drift from the count the page renders -- they come from the same regeneration.
export interface BrandMetadataFacts {
  stockists: number;
  comparable: number;
  sole_retailer: string | null;
}

export async function getBrandMetadataFacts(
  normalisedBrand: string | string[],
): Promise<BrandMetadataFacts> {
  const { data } = await supabase.rpc('fmb_brand_metadata_facts', {
    p_normalised_brands: toBrandList(normalisedBrand),
  });
  const row = Array.isArray(data) ? data[0] : data;
  // A missing row is treated as "nothing comparable", which selects the narrower claim.
  // FAILING TOWARDS THE SMALLER CLAIM IS DELIBERATE: the failure mode of the old template was
  // asserting a comparison that did not exist, so an unreadable count must never restore it.
  return {
    stockists: row?.stockists ?? 0,
    comparable: row?.comparable ?? 0,
    sole_retailer: row?.sole_retailer ?? null,
  };
}

export interface BrandIndexEntry {
  slug: string;
  name: string;
  count: number;
  /** More than one normalised_brand shares this slug (item 418). */
  merged: boolean;
}

/**
 * Every brand with at least one live product, grouped by the slug its hub answers at.
 *
 * 416'S QUESTION, ASKED BEFORE THIS WAS WRITTEN: what is the largest value it can
 * return, and is that a fact about the query or about today's data?
 *
 *   A BRAND INDEX IS UNBOUNDED BY CONSTRUCTION. Nothing filters it -- one row per
 *   distinct brand, growing with every retailer onboarded. 2,458 is TODAY'S DATA, not a
 *   property of the query. So it aggregates in SQL from the first line and never
 *   pages-and-counts -- the shape items 238, 412 and 415 each reached separately, after
 *   shipping the previous one.
 *
 * GROUPED BY SLUG, NOT BY BRAND, and that is the whole reason this is not a `select
 * distinct`. Six slugs are shared by two brands each; the hub unions them (item 418), so
 * the index must show ONE row or it would advertise a distinction the site cannot
 * honour -- two entries, different names, one destination. Slugification happens here
 * rather than in SQL because brandSlug() is the same function that builds the links, and
 * a second implementation in SQL is the duplication items 406, 407 and 417 are about.
 *
 * NO THRESHOLD, AND THE COUNT IS THE DESTINATION'S OWN (item 423).
 *
 * The first version counted IN-STOCK products, which was a threshold expressed as what
 * to count rather than as what to exclude -- and it removed 167 brands whose hubs render
 * products. The count now uses getBrandProducts' predicate exactly: image present, not
 * removed, at least one price at an active retailer, stock irrelevant. Item 271's rule,
 * from this same file: a chip must count exactly what its destination will show.
 */
export async function getBrandIndex(): Promise<BrandIndexEntry[]> {
  // ONE ROW CONTAINING AN ARRAY, NOT 2,457 ROWS (item 420).
  //
  // The first version returned `table (...)` and was SILENTLY TRUNCATED to PostgREST's
  // 1,000-row cap: the page rendered 934 brands and 9 letter sections instead of 2,451
  // and 27, with no error anywhere. Nothing about a short index looks wrong -- an A-Z
  // ending at I reads as an A-Z.
  //
  // fmb_active_brand_names() exists precisely to sidestep that cap, and its comment in
  // the sitemap route says so. Extending its DATA while changing its SHAPE dropped the
  // only property that mattered.
  const { data } = await supabase.rpc('fmb_brand_index');
  const rows = ((data ?? []) as [string, string | null, number][]).map(
    ([normalised_brand, display, n]) => ({ normalised_brand, display, n_live: n }),
  );

  // slug -> best display (the member contributing most live products) and the sum.
  const bySlug = new Map<string, { name: string; count: number; best: number; members: number }>();
  for (const r of rows) {
    const live = Number(r.n_live);
    if (live === 0) continue;
    const slug = brandSlug(r.normalised_brand);
    if (!slug) continue;
    const name = r.display ?? r.normalised_brand;
    const cur = bySlug.get(slug);
    if (!cur) {
      bySlug.set(slug, { name, count: live, best: live, members: 1 });
    } else {
      cur.count += live;
      cur.members += 1;
      // Majority member supplies the name, matching what the hub's h1 already shows.
      if (live > cur.best) {
        cur.best = live;
        cur.name = name;
      }
    }
  }

  return [...bySlug.entries()]
    .map(([slug, v]) => ({ slug, name: v.name, count: v.count, merged: v.members > 1 }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

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
 * Products of one supplement type, ranked by price per 100g.
 *
 * WHY A SANITY BOUND RATHER THAN A DQ-STATUS FILTER (item 441). `canonical_size` is
 * now correct for multipacks (item 439), but item 437 records the DQ metric MASKING
 * defects rather than reporting them: `Zooki Creatine+ Sachets` stores 6.78g against a
 * £39.99 pack price and scores `agrees`, because its name carries no pack count so the
 * checker structurally cannot see the error. It renders at £589.82/100g.
 *
 * So the page cannot trust `agrees`. It carries its own bound, and the bound is a
 * RATIO AGAINST THE TYPE'S OWN MEDIAN rather than an absolute ceiling: an absolute
 * limit goes stale as prices move and needs a number chosen per type, where a ratio
 * adapts and produces a readable list of what it caught.
 *
 * EXCLUDED ROWS ARE RETURNED, NOT DROPPED. They render unranked with a note. A page
 * that silently omits what it cannot price is incomplete in a way the visitor cannot
 * see -- the argument that rejected a product threshold on the brand index (item 423).
 */
export async function getTypeByUnitPrice(
  namePattern: string,
  opts: {
    medianRatioBound?: number;
    /**
     * Rows matched by the type pattern that are NOT the fungible thing being ranked.
     * A price per 100g is only a comparison where 100g is the same substance -- a
     * creatine HCl at 1-2g a dose is not a kilogram of monohydrate, a creatine blend
     * is mostly other ingredients, and 100g of gummies is mostly sugar. Each is
     * listed with its reason rather than dropped. Item 443.
     */
    notFungible?: { test: RegExp; reason: string }[];
  } = {},
): Promise<{ ranked: PerUnitProduct[]; unranked: PerUnitProduct[]; median: number | null; bound: number | null }> {
  const RATIO = opts.medianRatioBound ?? 10;
  const NOT_FUNGIBLE = opts.notFungible ?? [];

  const { data } = await supabase
    .from('products_active')
    .select('id, name, brand, normalised_brand, canonical_size, image_url')
    .eq('top_category', 'supplements')
    .not('image_url', 'is', null)
    .neq('image_url', '')
    .not('tags', 'cs', '{cleanup_remove}')
    .ilike('name', `%${namePattern}%`)
    .order('id');

  const rows = (data ?? []) as {
    id: number; name: string; brand: string | null; normalised_brand: string | null;
    canonical_size: string | null; image_url: string | null;
  }[];
  if (rows.length === 0) return { ranked: [], unranked: [], median: null, bound: null };

  const activeRetailerIds = await getActiveRetailerIds();
  const { data: prices } = await supabase
    .from('retailer_prices')
    .select('product_id, retailer_id, price, in_stock')
    .in('product_id', rows.map(r => r.id))
    .in('retailer_id', [...activeRetailerIds])
    .eq('in_stock', true);

  const byProduct = new Map<number, { retailer_id: number; price: number }[]>();
  for (const p of prices ?? []) {
    if (!p.product_id || !p.price) continue;
    const arr = byProduct.get(p.product_id) ?? [];
    arr.push({ retailer_id: p.retailer_id, price: Number(p.price) });
    byProduct.set(p.product_id, arr);
  }

  const grams = (cs: string | null): number | null => {
    if (!cs) return null;
    const m = cs.match(/^([0-9.]+)(g|kg)$/i);
    if (!m) return null;
    const v = Number(m[1]);
    return m[2].toLowerCase() === 'kg' ? v * 1000 : v;
  };

  const all: PerUnitProduct[] = [];
  for (const r of rows) {
    const pr = byProduct.get(r.id);
    if (!pr || pr.length === 0) continue;
    const price = Math.min(...pr.map(x => x.price));
    const g = grams(r.canonical_size);
    all.push({
      id: r.id, name: r.name, brand: r.brand,
      brand_slug: r.normalised_brand ? brandSlug(r.normalised_brand) : null,
      image_url: r.image_url, price, grams: g,
      per100g: g && g > 0 ? (price / g) * 100 : null,
      retailer_count: new Set(pr.map(x => x.retailer_id)).size,
    });
  }

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
