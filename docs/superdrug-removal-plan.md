# Superdrug (retailer 12) removal — orphan-handling plan

**Status:** FOR REVIEW. Nothing in here has been executed. The compliance fix
(Rakuten tracking strip, PR #103) shipped separately and is unrelated to this.

## Verified state (live DB, r29 active)

| Bucket | Count |
|---|---|
| `products_active` total | 100,231 |
| Products touching Superdrug (r12) | 29,541 |
| **True live orphans** (r12-only AND in `products_active`) | **24,484** |
| r12-only but already not indexable | 63 |
| Survive with another retailer (in `products_active`) | 4,949 |
| ...of which rescued by Atelier De Glow r29 (have both r12+r29) | 315 |
| Survive but no in-stock offer elsewhere (render OOS, not orphaned) | 67 |

The 24,484 is already net of r29's rescue. r29 has 502 price rows; 315 attach to
existing Superdrug products (those are survivors, not orphans).

## Why the naive flag-flip is wrong

`products_active` today requires only `EXISTS (any retailer_prices row)` — no
`in_stock`, no `retailers.active`. So `UPDATE retailers SET active=false WHERE id=12`
alone leaves all 24,484 orphans IN `products_active` → thin "No retailer prices"
200 pages, still in the sitemap, still inflating retailer counts/savings on
category/brand pages. We fix the view so the flag flip actually removes them.

---

## Step A — Redefine `products_active` to require an ACTIVE retailer (reversible)

Migration (apply via MCP `apply_migration`; `supabase db push` is blocked by history drift).
Column list is verbatim from the current definition; only the `EXISTS` changes.

```sql
-- 20260719_products_active_require_active_retailer.sql
CREATE OR REPLACE VIEW products_active AS
 SELECT id, name, brand, category, image_url, ean, created_at, ingredients, concerns,
        subcategory, normalised_brand, canonical_size, match_key, tags, shade, product_type,
        top_category, merged_into, merged_at, description, search_vector, amazon_asin
   FROM products p
  WHERE merged_into IS NULL AND parent_product_id IS NULL AND image_url IS NOT NULL
        AND image_url <> ''::text
        AND EXISTS (
          SELECT 1 FROM retailer_prices rp
          JOIN retailers r ON r.id = rp.retailer_id
          WHERE rp.product_id = p.id AND r.active
        );
```

Bonus: permanently fixes the thin-page bug for any future inactive retailer.

**Pre-flight before applying (must run, must be ~0 surprises):**
```sql
-- How many products would leave products_active from the VIEW CHANGE ALONE,
-- i.e. products whose every retailer_prices row is from an already-inactive
-- retailer (Superdrug is still active here, so this should be small).
SELECT count(*) FROM products p
WHERE merged_into IS NULL AND parent_product_id IS NULL
  AND image_url IS NOT NULL AND image_url <> ''
  AND EXISTS (SELECT 1 FROM retailer_prices rp WHERE rp.product_id=p.id)
  AND NOT EXISTS (
    SELECT 1 FROM retailer_prices rp JOIN retailers r ON r.id=rp.retailer_id
    WHERE rp.product_id=p.id AND r.active);
```
```sql
-- Perf sanity: the view is hot. Confirm the join uses the retailer_prices(product_id)
-- index and stays cheap. Compare buffers/time vs the pre-change view on a mega-category.
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM products_active WHERE top_category = 'Skincare';
```

The view change is a **no-op until r12 is flipped** (all current sole-retailers are
active), so it can be applied and verified first with zero user-visible change.

## Step B — Snapshot orphans, then flip the flag

```sql
-- Auditable backup of the exact orphan set + brand/category + the murl destination.
CREATE TABLE superdrug_orphan_snapshot_20260719 AS
SELECT p.id, p.brand, p.normalised_brand, p.top_category, p.subcategory, rp.url
FROM products p
JOIN retailer_prices rp ON rp.product_id = p.id AND rp.retailer_id = 12
WHERE p.merged_into IS NULL AND p.parent_product_id IS NULL
  AND p.image_url IS NOT NULL AND p.image_url <> ''
  AND NOT EXISTS (SELECT 1 FROM retailer_prices x
                  WHERE x.product_id = p.id AND x.retailer_id <> 12);
-- expect ~24,484 rows
```

Then the go-dark trigger (do this when ready to start monitoring):
```sql
UPDATE retailers SET active = false WHERE id = 12;
```
After this, orphans leave `products_active` → drop from sitemap → 404 via the
existing `resolveCanonicalKeeper`→`notFound()` path. Reversible: `active=true` repopulates.

Optional later data hygiene (NOT the go-dark mechanism, irreversible, clear
`price_history` FK rows first): delete r12 `retailer_prices`.

## Step C — Active-retailer filtering on listing/related queries

These 8 sites count/surface `retailer_prices` with **no active filter**, so they'd
keep counting Superdrug after the flip. Uniform fix: one shared helper + a guard.

New `lib/retailers.ts`:
```ts
import { cache } from 'react';
import { supabase } from './supabase-server'; // match the client these modules already use
export const getActiveRetailerIds = cache(async (): Promise<Set<number>> => {
  const { data } = await supabase.from('retailers').select('id').eq('active', true);
  return new Set((data ?? []).map(r => r.id));
});
```

Sites (diff shape):
- **Embed retailer-count** (`lib/queries.ts` ~184, `lib/brand-queries.ts` ~90,
  `lib/subcategory-queries.ts` ~71): in the accumulation loop add
  `if (!active.has(rp.retailer_id)) continue;` before `retailerIdSet.add(...)`.
- **Direct price fetches** (`lib/queries.ts` featured ~326, `lib/brand-queries.ts`
  ~211, `lib/subcategory-queries.ts` ~206, `lib/product-queries.ts`
  getMoreFromBrand ~237 + fetchRelated ~306): add `.in('retailer_id', [...active])`
  to the `.from('retailer_prices')` query (or the same JS guard).

`getRetailerOffers` (`lib/product-queries.ts` ~125) already filters `active=true` —
no change. This can ship BEFORE the flag flip (harmless while r12 still active).

## Step D — Routing: 410 tail + curated 301 (no blanket redirect)

No `middleware.ts` exists today. Create one matching `/product/:id`:

```ts
// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { GONE_IDS, REDIRECTS } from './lib/superdrug-removed'; // generated from snapshot + GSC
export const config = { matcher: '/product/:id*' };
export function middleware(req: NextRequest) {
  const m = req.nextUrl.pathname.match(/^\/product\/(\d+)/);
  if (!m) return NextResponse.next();
  const id = Number(m[1]);
  const to = REDIRECTS[id];
  if (to) return NextResponse.redirect(new URL(to, req.url), 301);
  if (GONE_IDS.has(id)) {
    return new NextResponse(GONE_HTML, { status: 410, headers: { 'content-type': 'text/html' } });
  }
  return NextResponse.next();
}
```

- `GONE_IDS`: the snapshot orphan ids MINUS the curated-301 set. Generated into
  `lib/superdrug-removed.ts` as a compact Set (~150KB for 24k numeric ids; within
  the edge bundle limit). Regenerated per removal batch.
- `REDIRECTS`: the few hundred orphans with real GSC clicks/impressions → their
  brand page (`/brands/{slug}`). Pulled from GSC top pages; NOT a blanket map.
- Middleware runs before the ISR cache, so it also **immediately stops stale
  Superdrug-price 200s** on orphan pages (faster than waiting on revalidation).

Bad/never-existed ids are untouched → keep their normal 404. Curated 301 targets
must be pages that survive the removal (verify brand still has live inventory).

## Step E — Revalidation

Orphans are handled by middleware (410), so they don't need revalidation. Revalidate
the pages whose CONTENT changes:
- ~4,949 survivor `/product/{id}` (drop Superdrug from their comparison) via `fmb_revalidate_paths`.
- Brands touched by Superdrug via `fmb_revalidate_brand_slugs`.
- Affected category/subcategory landing pages (retailer counts/savings change).
- Sitemap parts refresh on their own 1h `revalidate` (or force).

Batch the `fmb_revalidate_paths` calls (POSTs to `/api/revalidate`).

---

## Execution order (over several days, monitored)

1. Apply Step A view change + run pre-flight/EXPLAIN. Verify `products_active`
   count unchanged (~100,231). **No user-visible change yet.**
2. Ship Step C query filtering (PR) — harmless while r12 active.
3. Take Step B snapshot. Generate `lib/superdrug-removed.ts` + curated redirects.
   Ship Step D middleware (PR). Still no change until the flag flips.
4. Flip `retailers.active=false WHERE id=12`. Orphans go 410 (middleware) +
   leave `products_active` (sitemap/counts). Fire Step E revalidation.
5. Monitor GSC Coverage / soft-404 / Crawl stats over the following weeks.
   Roll back instantly via `active=true` if anything spikes.
6. (Later, optional) hard-delete r12 `retailer_prices` for data hygiene.

## Open checks before executing step 4+
- Pre-flight count (Step A) is small and expected.
- EXPLAIN confirms the view join stays cheap on mega-categories.
- Curated-301 targets all resolve to surviving pages.
- Edge middleware bundle with GONE_IDS is within Vercel's size limit.
