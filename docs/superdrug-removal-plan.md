# Superdrug (retailer 12) removal — orphan-handling plan

**Status (2026-07-19): FLIP COMPLETE — verified green.** All steps executed:
A (view flip, applied), C (#105), D (#106), gate observability (#107), curated 301s
(#108), Edge Config `superdrug_removed:true`, and `UPDATE retailers SET active=false
WHERE id=12`. products_active 100,231 -> 75,760 (24,471 orphans dropped). Post-flip
verification all green: orphans 410, curated 301 to brand pages, survivors 200 (Superdrug
dropped from comparison), merged/shade 308, bad id 404, listing pages 200. Compliance fix
(Rakuten strip, #103) shipped separately. Remaining: Step E ISR revalidation (SQL below,
service_role) and GSC monitoring of the 410 de-index over the coming weeks. Rollback if
ever needed: Edge Config `superdrug_removed:false` + `active=true` (active=true alone
restores the catalogue even without the flag).

## Reusable pattern for the NEXT retailer departure

Step A permanently changed `products_active` to require an offer from an ACTIVE retailer,
which **fixed the thin-page bug for ANY future inactive retailer** — not just Superdrug.
So the next departure is far simpler:
1. Flip `retailers.active = false` for the departing id -> its sole-retailer products
   drop out of `products_active` automatically (out of sitemap, out of listing counts).
2. Regenerate the orphan id set for that retailer and point the middleware's GONE_IDS /
   REDIRECTS at it (the middleware + Edge Config kill-switch are already in place; reuse
   `scripts/regen-superdrug-gone-ids.mts` with the retailer id parameterised).
3. Curate 301s from GSC for the traffic tail; everything else 410s.
4. Step E revalidation + monitor.
No view change, no query-filtering work, no new infra needed — those were one-time and
are now permanent. The listing-query active filtering (Step C) also already covers every
future inactive retailer.

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
-- Auditable backup of the AUTHORITATIVE drop set: products that leave products_active
-- when r12 goes inactive = live now via an active retailer, but Superdrug is their ONLY
-- active retailer. Active-qualified on purpose: a product with r12 + an inactive
-- secondary (Amazon 9 / eBay 10) still drops and must be captured. Run while r12 active.
CREATE TABLE superdrug_orphan_snapshot_<date> AS
SELECT p.id, p.brand, p.normalised_brand, p.top_category, p.subcategory,
       (SELECT rp.url FROM retailer_prices rp
        WHERE rp.product_id = p.id AND rp.retailer_id = 12 LIMIT 1) AS superdrug_url
FROM products p
WHERE p.merged_into IS NULL AND p.parent_product_id IS NULL
  AND p.image_url IS NOT NULL AND p.image_url <> ''
  AND EXISTS (SELECT 1 FROM retailer_prices rp JOIN retailers r ON r.id = rp.retailer_id
              WHERE rp.product_id = p.id AND r.active)                       -- live now
  AND NOT EXISTS (SELECT 1 FROM retailer_prices rp JOIN retailers r ON r.id = rp.retailer_id
                  WHERE rp.product_id = p.id AND r.active AND r.id <> 12);   -- no OTHER active retailer
-- expect ~24,484 rows; this count MUST equal (pre-flip products_active) - (post-flip products_active)
```
`scripts/regen-superdrug-gone-ids.mts` computes this same set and rewrites `GONE_IDS`
in `lib/superdrug-removed.ts` (preserving the curated REDIRECTS + GONE_HTML). Run it,
commit the diff, and deploy BEFORE flipping.

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

1. **[DONE]** Apply Step A view change + pre-flight/EXPLAIN. `products_active` = 100,231 unchanged.
2. **[DONE]** Ship Step C (#105) + Step D (#106) — both inert on main.
3. **[TODO — user]** Create a Vercel Edge Config store, connect to project (sets `EDGE_CONFIG`),
   add key `superdrug_removed: false`. Confirm C+D are live and inert (see runbook).
4. **[TODO]** Regenerate GONE_IDS from the authoritative drop set
   (`scripts/regen-superdrug-gone-ids.mts`), populate curated REDIRECTS from GSC, commit + deploy.
5. **[TODO — the flip]** See runbook below.
6. Monitor GSC Coverage / soft-404 / Crawl stats for weeks. Roll back instantly (Edge Config
   false + `active=true`).
7. (Later, optional) hard-delete r12 `retailer_prices` for data hygiene.

## Flip runbook (Step B — zero-gap)

Pre-flip verify (C+D live, inert):
- A Superdrug-orphan `/product/{id}` still returns **200** with its offer (flag false).
- A merged id still **308**s to keeper; a shade child still **308**s to parent; a bad id **404**s.

Flip (do the two together — the zero-gap moment):
1. `UPDATE retailers SET active = false WHERE id = 12;`
2. Set Edge Config `superdrug_removed = true`.

Post-flip verify:
- Orphan `/product/{id}` → **410** (or **301** to brand page if curated).
- Survivor (e.g. an r29-rescued id) → **200**, Superdrug absent from its comparison.
- Merged → **308** keeper, shade child → **308** parent, bad id → **404** (all unchanged).
- Category/brand/subcategory retailer counts + featured savings no longer count Superdrug.
- Sitemap parts drop the orphan ids (1h `revalidate` or forced).

Then Step E revalidation, then monitor. Rollback = Edge Config false + `active=true` (both instant).

## Open checks before executing step 4+
- Pre-flight count (Step A) is small and expected.
- EXPLAIN confirms the view join stays cheap on mega-categories.
- Curated-301 targets all resolve to surviving pages.
- Edge middleware bundle with GONE_IDS is within Vercel's size limit.
