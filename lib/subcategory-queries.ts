import { supabase } from './supabase';
import { getActiveRetailerIds } from './retailers';
import { summarisePriceRows, brandSlug, nextBestSavingPct, nextBestPrice, type FeaturedProduct, type TopBrand, type TopCategory } from './queries';

export interface SubcategoryStats {
  total_products: number;
  total_brands: number;
  total_retailers: number;
}

/**
 * Browse facets for a grid: the named type chips, plus an optional complement chip
 * standing for everything they do not cover.
 *
 * WHY THE COMPLEMENT CAN BE null. "Everything else" is literally true whatever it
 * contains -- which is exactly the problem. While every REAL type is a chip, it means
 * "the classifier's default", the one honest reading. The moment a real type does not
 * fit under `limit`, the same words silently start meaning "the default plus whatever
 * was cut", with no signal that the claim changed. So the chip is SUPPRESSED rather
 * than allowed to mislabel: degrading to named-types-only is honest, a false label is
 * not. Item 408.
 */
export interface ProductTypeFacets {
  types: ProductTypeChip[];
  complement: { count: number } | null;
}

export interface ProductTypeChip {
  product_type: string;
  count: number;
}

// ── QUERIES ────────────────────────────────────────────────────────────

export async function getSubcategoryStats(
  category: TopCategory,
  subcategory: string,
): Promise<SubcategoryStats> {
  // ONE AGGREGATE (item 415). The two offset walks this replaces LOOKED bounded --
  // one subcategory each -- and that bound was a property of the DATA, not of the
  // query. Skincare's 45,124 products all sit in `face`, so the bound was 1.0x the
  // category and nothing here said so. That is why the audit that caught the
  // category-scoped walks did not catch these.
  const { data, error } = await supabase.rpc('fmb_scope_stats', {
    p_category: category,
    p_subcategory: subcategory,
  });
  // A FAILED READ IS NOT AN EMPTY ONE. SubcategoryPage notFound()s when
  // total_products is 0, so swallowing this error hands it a zero it cannot tell
  // from a real one and the page 404s on a transient database failure. See the
  // write-up on getSubcategoryProducts below -- this is the same guard, on the
  // other query that feeds the same notFound(). Item 576.
  if (error) {
    throw new Error(`fmb_scope_stats failed for ${category}/${subcategory}: ${error.message}`);
  }
  const r = (data as { total_products: number; total_brands: number; total_retailers: number }[] | null)?.[0];
  return {
    total_products: Number(r?.total_products ?? 0),
    total_brands: Number(r?.total_brands ?? 0),
    total_retailers: Number(r?.total_retailers ?? 0),
  };
}

export async function getProductTypes(
  category: TopCategory,
  subcategory: string | null,
  limit = 12
): Promise<ProductTypeFacets> {
  // AGGREGATED IN SQL, NOT PAGED AND COUNTED HERE (item 412). The previous version
  // used fetchAllRows: 12 round trips and a 1.2s page for hair's 11,025 rows, 46 round
  // trips and a MEASURED 15.8s page for skincare's 45,124. Same shape as the RPC
  // getFeaturedProducts already uses, and its comment already argued for it.
  const { data: rows, error } = await supabase.rpc('fmb_product_type_facets', {
    p_category: category,
    p_subcategory: subcategory,
  });
  if (error || !rows) return { types: [], complement: null };
  const data = (rows as { product_type: string | null; n: number }[]).map(r => ({
    product_type: r.product_type,
    n: Number(r.n),
  }));

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
  //
  // 'Supplements' IS THE FIFTH, AND IT IS DERIVED RATHER THAN WRITTEN. Supplements is
  // the only category whose rows carry no product_type -- the categoriser sets NULL
  // deliberately -- so products_active now COALESCEs in fmb_supplement_type(name, brand),
  // a read-time derivation from the name. Rows that match no type vocabulary get
  // 'Supplements', exactly as the other four defaults are emitted by their classifiers.
  //
  // IT MUST BE A STRING RATHER THAN NULL, AND THAT IS THE WHOLE REASON THE DEFAULT
  // EXISTS. `totalRows` below counts only non-null product_type, so a NULL residue makes
  // complementCount zero and SUPPRESSES the "Everything else" chip -- stranding 868
  // products behind "All" with no affordance reaching them. The suppression guard is
  // right; it just cannot distinguish "no residue" from "residue we declined to name".
  const JUNK_TYPES = new Set(['Skincare', 'Makeup', 'Hair', 'Hair Care', 'Fragrance', 'Supplements']);

  const counts = new Map<string, number>();
  let totalRows = 0;
  for (const row of data) {
    if (!row.product_type) continue;
    totalRows += row.n;
    if (JUNK_TYPES.has(row.product_type)) continue;
    counts.set(row.product_type, (counts.get(row.product_type) ?? 0) + row.n);
  }

  const ranked = Array.from(counts.entries())
    .map(([product_type, count]) => ({ product_type, count }))
    .sort((a, b) => b.count - a.count);

  const types = ranked.slice(0, limit);

  // Everything the named chips do not cover: the suppressed defaults, plus any real
  // type that did not fit. THE GUARD: if a real type was cut, the complement no longer
  // means "the default" and the chip is dropped rather than relabelled.
  const everyRealTypeIsAChip = ranked.length <= limit;
  const namedTotal = types.reduce((n, t) => n + t.count, 0);
  const complementCount = totalRows - namedTotal;

  return {
    types,
    complement:
      everyRealTypeIsAChip && complementCount > 0 ? { count: complementCount } : null,
  };
}

export async function getSubcategoryTopBrands(
  category: TopCategory,
  subcategory: string,
  limit = 16,
  productType?: string
): Promise<TopBrand[]> {
  // Aggregated in SQL (item 415), same RPC as getTopBrands with the subcategory bound.
  const { data } = await supabase.rpc('fmb_top_brands', {
    p_category: category,
    p_subcategory: subcategory,
    p_product_type: productType ?? null,
    p_limit: limit,
  });
  return ((data ?? []) as { normalised_brand: string; display: string | null; n: number }[]).map(r => ({
    name: r.display ?? r.normalised_brand,
    slug: brandSlug(r.normalised_brand),
    product_count: Number(r.n),
  }));
}

/**
 * Paginated products for a category, optionally narrowed to one subcategory.
 *
 * GENERALISED RATHER THAN COPIED (item 408). The category ROOT needs exactly this
 * query with one `.eq()` fewer, and this file's last three findings were all about a
 * second copy of something drifting from the first. `subcategory: null` means the
 * whole category.
 *
 * `comparableOnly` restricts to products stocked by more than one retailer. It is a
 * CLAIM ABOUT THE CATALOGUE, not a property of the product, and it is OFF by default:
 * on, it hides 86% of skincare and 79% of hair behind a control the visitor did not
 * set, and makes the root stricter than the pages beneath it -- which is the defect
 * this whole change exists to remove.
 */
export async function getSubcategoryProducts(
  category: TopCategory,
  subcategory: string | null,
  page = 1,
  pageSize = 48,
  productType?: string,
  comparableOnly = false,
  /** Select the COMPLEMENT of these named types instead of a single type. */
  complementOf?: string[]
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
    .not('image_url', 'is', null)
    .neq('image_url', '')
    .not('tags', 'cs', '{cleanup_remove}');

  if (subcategory) {
    query = query.eq('subcategory', subcategory);
  }

  if (productType) {
    query = query.eq('product_type', productType);
  } else if (complementOf && complementOf.length > 0) {
    // STILL SLOW ON SUPPLEMENTS, AND KNOWN. `not in` on the derived expression cannot use
    // idx_products_supplements_derived_type -- an index answers "which rows equal this",
    // not "which rows equal none of these" -- so /supplements?other=1 still runs 1.5-2.4 s
    // (measured 4 Sep) where every ?type= link now runs under 0.6 s.
    //
    // LEFT AS IS BECAUSE ITS FAILURE MODE IS DIFFERENT, NOT BECAUSE IT IS FINE. This branch
    // is reached only from CategoryPage, which has no notFound() -- a timeout here degrades
    // to an empty grid, not a 404. That is QUIETER AND NOT BETTER: a silent empty is a page
    // that lies about the catalogue with a 200, and nothing measures it. Work-list item 576.
    //
    // PostgREST in-list: quote each value, since type names contain spaces and '&'.
    const list = complementOf.map(t => `"${t.replace(/"/g, '\\"')}"`).join(',');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // Chaining a fourth .not() past this point exceeds TypeScript's instantiation
    // depth on the generated PostgREST builder types. The filter itself is ordinary.
    query = (query as any).not('product_type', 'in', `(${list})`);
  }

  // ── THE .order() RULE LIVES HERE NOW, WITH THE ONLY PAGINATOR LEFT IN THIS FILE ──
  //
  // EVERY .range() MUST FOLLOW .order() ON A UNIQUE COLUMN.
  //
  // `.range()` without `.order()` is unordered LIMIT/OFFSET, and Postgres gives NO
  // stability guarantee across pages: rows can be missed and others returned twice.
  //
  // MEASURED 16 August on supplements, running a real caller's two-page scan: it
  // returned 1,719 rows against an actual 1,719 -- THE RIGHT TOTAL -- while containing
  // only 102 of the 117 rows carrying one subcategory value. 15 rows came back twice
  // and 15 never came back. Row count reconciled, page-size arithmetic reconciled, and
  // `719 < PAGE_SIZE` was the loop's own termination condition, so THE READ REPORTED
  // ITSELF COMPLETE.
  //
  // A COUNT THAT RECONCILES IS NOT EVIDENCE THAT A PAGINATED READ IS COMPLETE. It is
  // evidence that the right NUMBER of rows came back, which is a different claim and
  // the easy one to check -- which is why it gets checked instead. Items 146, 151.
  //
  // MOVED HERE FROM fetchAllRows, WHICH IS GONE (item 417). The rule used to sit on a
  // shared helper 200 lines up; when the helper's callers became RPCs the helper died,
  // and a rule living in dead code reads as guidance on a live mechanism while guarding
  // nothing. It now sits on the code it protects.
  //
  // THIS FILE ALREADY CONTAINED THE PROOF, 70 LINES BELOW: getValidSubcategories
  // carries item 146's write-up, where exactly this defect returned 1,719 rows —
  // the correct total — while containing only 102 of 117 `womens-health` rows,
  // and put the sitemap and the page into disagreement. That fix was applied to
  // the SUBCATEGORY LIST and never to the PRODUCT LIST in the same file.
  //
  // The rule existed, the evidence was in this file, and this call still had the
  // bug — because the rule was scoped to the paging helper and the evidence was
  // written up against one caller. Work-list item 238.
  const { data: products, count: totalCount, error } = await query
    .order('id', { ascending: true })
    .range(offset, offset + candidateLimit - 1);

  // ── A FAILED READ IS NOT AN EMPTY ONE, AND THE DIFFERENCE IS A 404 ──
  //
  // `error` USED TO BE DISCARDED HERE. On any PostgREST failure `products` comes back
  // null and `count` null, so `totalCount ?? 0` returned 0 -- and SubcategoryPage reads
  // a 0 under ?type= as "this type matches nothing" and calls notFound(). A transient
  // database failure was therefore rendered as a HARD 404 on a link the site's own
  // browse chips emit.
  //
  // THAT IS THE WORST AVAILABLE FAILURE, NOT MERELY AN UGLY ONE. 60,032 pages are already
  // crawled-and-declined; a 404 is the one response that tells Google a page it was offered
  // does not exist. A 500 is honest, retryable, and not a de-indexing signal. A 404 on a
  // link the site renders itself is none of those. When the two are indistinguishable at
  // the call site, the code picks the irreversible one.
  //
  // ── IT BECAME BROKEN. THE CODE DID NOT CHANGE; THE CATALOGUE CROSSED A CEILING. ──
  //
  // /supplements/supplements?type=Vitamins 404'd intermittently from 30 August to 4
  // September. The derivation shipped 27 August (20260827111048) against 1,946 rows in that
  // subcategory and produced ZERO 500s on 27-29 August. 4,017 rows landed on the 28th.
  // The first failure is 30 August. Same code, three times the scan.
  //
  // So "it has been broken since it launched" is exactly wrong, and the shape of the
  // evidence says why it looked that way: the pages were at ~97% of the timeout budget
  // rather than over it -- 2.76-3.64 s measured against anon's 3 s statement_timeout --
  // so EVERY LOAD WAS A COIN FLIP. A defect that fires on some loads and not others reads
  // as a broken page seen intermittently, not as a threshold that moved.
  //
  // ── WHAT IT WAS NOT: THE CHIPS AND THE FILTER READING DIFFERENT COLUMNS ──
  //
  // The standing hypothesis was that the chip is built from the derived type while the
  // query filters the stored column, so the chip says Vitamins and the filter finds
  // nothing. It is a good theory and the code refutes it without any measurement:
  // fmb_product_type_facets and this query BOTH read products_active, and the facets RPC
  // filters `product_type is not null`. If the stored column were what either of them saw,
  // every supplements row would have been excluded and NO CHIPS WOULD HAVE RENDERED AT ALL.
  // The chips existing is the refutation. Both sides saw the same 600 rows throughout; the
  // data was never wrong and nothing ever disagreed.
  //
  // The query was simply SLOW. product_type on that view is COALESCE'd from
  // fmb_supplement_type() at read time, so filtering on it is a filter on an EXPRESSION and
  // derived the value per row: 1,794 ms for 6,660 rows, against 130 ms for the same query
  // shape over skincare's 27,243. The timeout returned a 500, the 500 arrived here as an
  // empty result, and the empty-type guard did the rest.
  //
  // Fixed at the source by idx_products_supplements_derived_type (1,794 ms -> 47 ms), but
  // THE CONVERSION OF AN ERROR INTO A 404 IS THE DEFECT THAT OUTLIVES ANY ONE SLOW QUERY.
  // The index removes today's way of reaching this line. It removes no other.
  //
  // AND THE RULE ALREADY EXISTED. supabase/migrations/README.md convention 10, added 3
  // August: "Any supabase-js call whose result is acted on must read `error`, and must
  // classify an error differently from an empty result." It even names this call site's
  // family -- "Where it will recur: anywhere supabase-js is called without checking error.
  // That is not a hypothetical set... and no sweep has been run." The sweep was not run,
  // and the rule was written down in a document about MIGRATION conventions while the
  // hazard lived in page queries. Same failure as item 238's .order() rule: correct
  // guidance, filed where the code that needed it would never be read against it.
  //
  // THE SWEEP IS STILL NOT RUN. Counted 4 September: of 98 awaited supabase-js results,
  // 44 do not read `error` at all, and a further 15 read it and then collapse it into
  // the same branch as "no rows" -- which satisfies the rule's first half, breaches its
  // second, and LOOKS LIKE COMPLIANCE to any search for a missing `error`.
  // getValidSubcategories, seventy lines below, is one of the 15. Five notFound() sites
  // can still be reached by a query failure, one of them
  // (app/edit/[slug]/page.tsx:76, fed by edit-queries.ts:166) byte-for-byte this guard.
  // Two call sites fixed here is not the set. Work-list item 576.
  if (error) {
    throw new Error(
      `products_active read failed for ${category}/${subcategory ?? '*'}` +
        `${productType ? ` type=${productType}` : ''}: ${error.message}`
    );
  }

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
    if (comparableOnly && retailerCount < 2) continue;

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
