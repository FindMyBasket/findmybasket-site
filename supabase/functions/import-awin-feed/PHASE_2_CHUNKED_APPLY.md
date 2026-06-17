# Phase 2 — Chunked lookups + streamed apply (spec, for review)

**Status:** DRAFT — do not implement until reviewed.
**Author:** drafted 2026-06-15.
**Predecessors:** v6.20 streaming I/O ([STREAMING.md](./STREAMING.md)), Phase 1 catalogue-map fold.

---

## 1. Why this exists

Streaming (v6.20) and Phase 1 both failed to revive the large feeds. Confirmed
empirically on **2026-06-15**: Stylevana (id 11) was flipped to
`streaming_enabled=true` — the *exact* HTTP path Beauty Bay uses successfully —
manually triggered, and still returned **546 `WORKER_RESOURCE_LIMIT`**, zero rows
applied. Stylevana is the *smallest* of the three dead feeds (11/25/23), so
YesStyle and Boots cannot pass either. All three have been stale since
**June 12**.

**Root cause:** streaming bounds only feed I/O (fetch → inflate → CSV parse). It
does **not** touch the two costs that actually dominate on a large feed:

1. **Upfront catalogue load.** Before the first row is processed the function
   loads *all* `91,924` products into `allProducts` and builds
   `productByExact` / `productByStripped` (index.ts:1126–1171), plus the full
   `ean_product_index` and `mpn_product_index` tables into
   `eanToProductId` / `mpnToProductId` (index.ts:1078–1124). This is a fixed
   floor independent of feed size, already called out in STREAMING.md as the
   "real memory floor… not addressed."
2. **Whole-run action accumulation.** `updateActions` / `linkActions` /
   `createActions` accumulate for the *entire* feed before a single write
   (apply phase begins at index.ts:2093). For a 100–150MB Boots feed that is
   hundreds of thousands of action objects retained at once.

Phase 2 attacks both: **(A)** make catalogue lookups per-chunk instead of
upfront, **(B)** flush the action accumulators on a threshold instead of at the
end, **(C)** lazy-load the retailer-scoped maps per-chunk too.

The goal is a hard memory ceiling that does not scale with catalogue size or feed
size. Target: keep peak heap bounded by `chunk_size × (distinct brands + rows)`,
not by `91,924 products + whole feed`.

---

## 2. Current shape (what we're changing)

Per-row matching tiers (index.ts:1746–1834), in order:

| Tier | Map | Source | Scope |
|---|---|---|---|
| 0 update | `existingByExtId` | `retailer_prices` (this retailer) | retailer |
| 1 EAN | `eanToProductId` | `ean_product_index` (all) | global |
| 2 MPN | `mpnToProductId` | `mpn_product_index` (all) | global |
| 3 name-exact | `productByExact` | all `products` | global |
| 4 name-stripped+size | `productByStripped` | all `products` | global |
| 5 shade-variant skip | `urlToProductId` | `retailer_prices` (this retailer) | retailer |
| else | create | — | — |

Two **cross-row, in-feed** mutations happen during the loop and must be preserved:

- `eanToProductId` / `mpnToProductId` are augmented on a successful link
  (index.ts:1828–1829) so a later row in the *same* feed links to a product first
  seen earlier in the feed.
- `urlToProductId.set(wrappedUrl, -1)` after a create (index.ts:1920) so a later
  row sharing that URL is skipped as a shade variant (index.ts:1815).

Apply phase invariants (index.ts:2108–2238):

- **Updates:** keyed by `rp_id`, chunked at 500 via `bulk_update_retailer_prices`.
  No cross-row dependency. Trivially streamable.
- **Links:** deduped **across the whole run** to the lowest price per `product_id`
  (index.ts:2147–2154), then upserted `onConflict (product_id, retailer_id)`.
  **This global lowest-price dedup is the hard part for streaming** — see §4B.
- **Creates:** two-phase — insert `products`, read back ids, insert
  `retailer_prices` (index.ts:2191–2238). Already chunked at 500.
- **Safety cap:** `countCreateNew > 20000` aborts the *whole run before any write*
  (index.ts:1986–1991). Streamed apply writes before the total is known, so this
  abort semantic changes — see §4B.

---

## 3. Key fact that makes (A) correct

`buildMatchKey(brand, name)` is **brand-prefixed** (index.ts:777–787): every
exact and stripped key begins with the normalised brand token. Therefore a
product can only match a feed row (Tier 3/4) if they share a normalised brand.
So the upfront "all products" map can be replaced by a **per-chunk query filtered
to the distinct brands present in that chunk** with no loss of matches — *provided
the brand filter uses the same normalisation as the key.*

EAN/MPN (Tier 1/2) are brand-agnostic but are exact-keyed, so a per-chunk
`WHERE ean = ANY($1)` / `mpn = ANY($1)` over the chunk's distinct codes is
equally lossless.

### 3.1 The normalisation trap (must resolve before implementing A)

`normaliseForMatch` (index.ts:762) strips apostrophes and accents:
`[^a-z0-9]+ → space`. So:

```
normaliseForMatch("L'Oréal")  →  "l or al"
products.normalised_brand     =  lower(brand)  →  "l'oréal"
```

These diverge for exactly the brands beauty is full of (L'Oréal, Kiehl's, Estée
Lauder, …). If the per-chunk query filters `WHERE normalised_brand = ANY(<canonical
brands>)`, it will **miss** those products and the importer will **create
duplicates instead of linking** — a correctness regression, not a tolerable count
drift.

The match keys themselves stay internally consistent (row and product both go
through `buildMatchKey`); the problem is purely the *query filter* that decides
which products to fetch. Three options, in order of preference:

- **Option A1 (recommended): add a `match_brand` generated column.** Mirror
  `normaliseForMatch` as an `IMMUTABLE` SQL function and add
  `products.match_brand text GENERATED ALWAYS AS (fmb_match_brand(brand)) STORED`,
  indexed. Postgres backfills generated columns automatically on add — **no manual
  backfill script** (this is a narrow brand-only column, not the full `match_key`
  the prompt rightly said to avoid; `match_key` is only 16,330/91,924 populated
  and stays unused). Per-chunk query becomes `WHERE match_brand = ANY($1)` with
  `$1` = distinct JS `normaliseForMatch(canonicalBrand)` values. Exact parity,
  index-supported.
- **Option A2 (no DDL): alias-expanded filter.** `brandAliasMap` is already
  loaded (index.ts:1019–1047). For each canonical brand in the chunk, expand to
  its full alias cluster and query `normalised_brand = ANY(<all aliases + canonical>)`.
  Cheaper to ship but still misses products whose stored brand differs from the
  canonical only by punctuation/accent and isn't in `brand_aliases`. Acceptable
  *only if* the §6 parity check shows near-zero create-count inflation.
- **Option A3:** accept measured drift (Phase 1 tolerated ~0.026%). Reject unless
  A1/A2 prove unnecessary — the accented-brand failure mode is not random noise,
  it's systematic against high-value brands.

**Decision needed:** A1 vs A2. Recommendation: **A1** — it is the only option that
is provably lossless, and the generated-column backfill is free.

---

## 4. Detailed design

### 4A. Per-chunk catalogue lookups

Replace the upfront loads (index.ts:1078–1171) with per-chunk queries. For each
batch of parsed rows (reuse the existing stream batch boundary, index.ts:1580+):

1. Collect from the chunk: distinct `match_brand` values, distinct normalised
   EANs, distinct normalised MPNs, distinct ext-ids, distinct wrapped URLs.
2. Issue (at most) five `= ANY($1)` queries:
   - `products WHERE match_brand = ANY` → build chunk-scoped `productByExact` +
     `productByStripped` (same JS build as index.ts:1159–1166).
   - `ean_product_index WHERE ean = ANY` → chunk `eanToProductId`.
   - `mpn_product_index WHERE mpn = ANY` → chunk `mpnToProductId`.
   - `retailer_prices WHERE retailer_id=… AND external_product_id = ANY` → chunk
     `existingByExtId` (this is part C).
   - `retailer_prices WHERE retailer_id=… AND url = ANY` → chunk `urlToProductId`
     (part C).
3. Run the existing tier logic unchanged against the chunk-scoped maps.

**Cross-row / cross-chunk in-feed accumulator (required for parity).** The
in-feed mutations from §2 must survive across chunk boundaries. Keep a small,
*persistent* (whole-import) accumulator — call it `seenThisImport`:

- `seenThisImport.eanToProductId` / `.mpnToProductId`: every EAN/MPN linked or
  created so far this run. Merge into the chunk maps before matching, and write
  back after. Bounded by distinct codes seen — small.
- `seenThisImport.createdUrls`: set of URLs created so far (replaces the `-1`
  sentinel writes). Checked in Tier 5. Bounded by creates.
- **Just-created name keys (new behaviour — flag for review).** Today two feed
  rows that are the same *new* product but arrive in different chunks and match
  only by name would each create a row (the upfront `productByExact` never
  contained them — they didn't exist yet). The prompt asks for a "just-created
  accumulator for cross-row matches." Adding
  `seenThisImport.createdByMatchKey: Map<matchKey, productId>` and consulting it
  in Tier 3/4 would dedupe these into links. **This is a behaviour change** and
  will move some create→link counts vs production. Two sub-options:
  - **4A-i:** ship the accumulator but seed `productId = -1` (pending) and only
    use it to *suppress duplicate creates*, not to link (since the real id isn't
    known until the create flush). Closest to current behaviour; converts
    in-feed duplicate creates into skips.
  - **4A-ii:** flush creates eagerly enough that real ids are known, then link.
    More correct, more invasive.
  **Decision needed.** Recommendation: **4A-i** for parity-friendliness; treat
  true cross-chunk name-linking as a follow-up. Whatever we pick, the §6 parity
  check must explicitly account for the delta (it will not be byte-identical).

### 4B. Streamed apply

Introduce a flush triggered when *any* accumulator crosses a threshold
(`FLUSH_THRESHOLD = 1000` actions, or every N chunks — recommend a simple total
action count). Flush reuses the existing apply blocks, then clears the flushed
arrays.

- **Updates:** flush `updateActions` via `bulk_update_retailer_prices` +
  `bulk_update_product_images` (index.ts:2112–2143), then clear. Safe — no
  cross-row state.
- **Creates:** flush via the existing two-phase insert (index.ts:2191–2238), then
  clear. After insert, populate `seenThisImport.createdByMatchKey` /
  `createdUrls` / EAN/MPN with the **real** ids so subsequent chunks link rather
  than re-create (enables 4A-ii if chosen).
- **Links — the hard one.** The current global lowest-price dedup
  (index.ts:2147–2154) cannot survive a "flush and clear" because the plain
  `upsert onConflict (product_id, retailer_id)` is **last-write-wins**, not
  lowest-price-wins. If chunk 1 writes product X @ £10 and chunk 5 writes X @ £12,
  flushing per chunk would leave £12. Two options:
  - **Option B1 (recommended): price-aware upsert RPC.** Add an RPC that does
    `INSERT … ON CONFLICT (product_id, retailer_id) DO UPDATE SET price=EXCLUDED.price,
    … WHERE EXCLUDED.price < retailer_prices.price` (plus always-update
    in_stock/url/last_updated, matching current columns). Then links can flush and
    clear with the lowest price winning regardless of chunk order. True bounded
    memory.
  - **Option B2: retain a global `dedupedLinks` map, flush only updates/creates.**
    Keeps the existing upsert but never clears the link dedup map. Memory then
    scales with distinct matched products (≤ catalogue). Cheaper to build, but
    leaves the largest accumulator unbounded — partially defeats the purpose on a
    feed that links heavily (Boots).
  **Decision needed.** Recommendation: **B1** — it's the only option that makes
  links genuinely bounded, and the RPC is small.

- **Safety cap redesign.** `countCreateNew > 20000` currently aborts *before any
  write* (index.ts:1986). With streamed creates that all-or-nothing guarantee is
  gone. Replace with an **incremental ceiling**: maintain a running
  `createsApplied` count; once it reaches 20,000, stop enqueuing further creates
  (skip remaining create-eligible rows, increment a `cappedCreates` counter),
  continue updates/links, and set `last_import_status='error'` with a "create cap
  hit (partial)" message. This trades "abort, write nothing" for "bound the
  damage, write what's safe, alert." **Flag for review** — it is a deliberate
  semantic change.

### 4C. Lazy retailer-scoped maps

Folded into 4A step 2 (the two `retailer_prices` queries). Removes the upfront
full-retailer scans (index.ts:1053–1071, 1152–1157). Smaller win than A/B but
free to include.

`existingBrandSet` (used only when `existing_brands_only=true`, index.ts:1877) is
just distinct brands — keep it as a single cheap upfront
`SELECT DISTINCT normalised_brand FROM products` (1,961 rows) rather than deriving
from `allProducts`.

---

## 5. Index / migration prerequisites

Confirmed from `pg_indexes` on 2026-06-15:

- ✅ `idx_products_match (normalised_brand, canonical_size, match_key)` — leading
  `normalised_brand` already supports option A2. If we choose **A1**, add
  `match_brand` + an index on it.
- ✅ `idx_rp_external_product_id (retailer_id, external_product_id)` — supports the
  per-chunk ext-id query (C).
- ❌ **No index on `retailer_prices (retailer_id, url)`** — the per-chunk Tier 5
  query needs one. Add `CREATE INDEX … ON retailer_prices (retailer_id, url)`.
- ❌ **No index returned for `ean_product_index` / `mpn_product_index`** — verify
  these are tables (not views) and that `ean` / `mpn` are indexed; the per-chunk
  `= ANY($1)` lookups will be slow otherwise. Add indexes if missing.

Migrations required (pending §3/§4 decisions):
1. (If A1) `fmb_match_brand(text)` IMMUTABLE fn + `products.match_brand` generated
   column + index.
2. `retailer_prices (retailer_id, url)` index.
3. (If B1) price-aware link upsert RPC.
4. (Verify/add) `ean_product_index(ean)`, `mpn_product_index(mpn)` indexes.

---

## 6. Validation (same parity pattern as Phase 1)

Phase 2 changes matching inputs (chunk-scoped) and apply timing, so we validate by
**action-count parity on dry-runs** (dry_run short-circuits before apply,
index.ts:2093 — counts are computed regardless).

1. **Beauty Bay (id 26) — outcome-preserving check.** Dry-run old vs new; compare
   the full counts block (`would_update`, `would_link_via_*`, `would_create_new`,
   `skipped_shade_variant`, size-mismatch, exclusions). Expect identical **except**
   the intentional create→link/skip delta from the §4A just-created accumulator —
   that delta must be explainable row-by-row, not mystery drift.
2. **Beauty Flash (id 27) — Tier 4 stress.** Same comparison; it exercises
   stripped+size matching hardest.
3. **Live apply on Beauty Bay** (small, known-good) — confirm streamed apply
   writes the same number of rows as the current single-shot apply, no 546.
4. **Boots (id 23) is the canary** — it cannot be dry-run-validated for memory
   (the 546 happens regardless of dry_run? no — dry_run skips apply, so a dry-run
   may pass while real apply OOMs). Treat the first *real* Boots run as the
   acceptance test: products created/updated, no 546, `last_import_status` written.
   Roll out smallest-first: Stylevana (11) → YesStyle (25) → Boots (23).

> Note: because dry_run skips the apply phase, a dry-run cannot prove the *apply*
> memory is bounded — only the *matching* memory. The streamed-apply memory claim
> must be proven on a real Beauty Bay apply first, then Stylevana.

---

## 7. Silent staleness — re-scoped

The prompt proposes adding a `MAX(retailer_prices.last_updated)` staleness alert at
~36h. **That backstop already exists.** `monitor-retailer-feeds`
(monitor-retailer-feeds/index.ts:107–141) already queries the newest
`last_updated` per *active* retailer and emails when `> 48h` stale, excluding
retailers already flagged as import failures.

Diagnosis (2026-06-15):
- All three dead retailers are `active=true`, `enabled=true`,
  `last_import_status='ok'`, last write June 12 (~78h).
- The monitor cron (job 23, 09:00 UTC) **ran successfully every day**, including
  June 14 09:00 — when all three had crossed 48h. By the logic it *should* have
  emailed "3 stale" that morning. `net._http_response` rows are auto-purged so the
  email send can't be confirmed retroactively.

So the genuine gaps are narrower than "add staleness detection":

1. **The FAST signal lies after a hard kill.** A 546 kills the worker before the
   `last_import_status` write (index.ts:2244–2253), so it stays `'ok'` from the
   last good run. That is the *silent* part. **Fix:** write a status at the *top*
   of the run — set `last_attempt_at = now()` and `last_import_status = 'running'`
   before fetch — so a 546 leaves `'running'`, not `'ok'`. Then teach the monitor
   to flag any retailer stuck `'running'` past its expected window (its cron
   interval + margin). This makes hard kills self-evident.
2. **Threshold too loose.** 48h tolerates two consecutive missed daily runs.
   Lower `STALENESS_HOURS` to **36** so a single missed run alerts next morning.
3. **Confirm delivery.** Verify the June 14 monitor email actually arrived. If it
   didn't, there's a Resend/delivery bug to chase independently of thresholds —
   that, not the detection logic, would be the true silent failure.

These are independent of Phase 1/2 and can ship first (they're low-risk and would
have surfaced this whole incident on June 14).

---

## 8. Open decisions for review

1. **§3.1 brand filter:** A1 (`match_brand` generated column, recommended) vs A2
   (alias-expanded filter, no DDL).
2. **§4A just-created accumulator:** 4A-i (suppress duplicate creates only) vs
   4A-ii (real cross-chunk linking after eager create flush).
3. **§4B links:** B1 (price-aware upsert RPC, recommended) vs B2 (retain global
   dedup map, links stay unbounded).
4. **§4B safety cap:** accept the "incremental ceiling / partial write" change to
   the 20k cap?
5. **§7 monitoring:** ship the `'running'` status + 36h threshold now, ahead of
   Phase 2?

No code to be written until these are settled.
