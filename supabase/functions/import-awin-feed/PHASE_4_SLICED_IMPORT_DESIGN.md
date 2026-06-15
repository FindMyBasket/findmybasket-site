# Phase 4 — Sliced / resumable import (Option C) — DESIGN

**Status:** DESIGN ONLY — review before any code. Drafted 2026-06-15.
**Predecessors:** [PHASE_3_CPU_PROFILE_AND_OPTIONS.md](./PHASE_3_CPU_PROFILE_AND_OPTIONS.md)
(profiling), Option A+B (lazy per-brand cache + `match_chunk_lookups` RPC — both
implemented, uncommitted, parity-proven byte-identical on Beauty Bay/Flash).

---

## 1. Why C (recap, with the A+B data)

A+B **solved the lookup cost**: `load_maps` fell from ~17s (B-alone) to **~5s and
flat** on Stylevana (the per-brand cache warms once, `chunk_exact` plateaus ~28k).
Parity byte-identical. But Stylevana real-apply **still 546s**, now bounded by:

- **`flush`** — update-dominated: `f_update` 4.2s over **28 round-trips**
  (`bulk_update_retailer_prices`, 500/batch), `f_link` 0.86s, `f_create` 0
  (Stylevana is a pure re-import). Round-trip-reducible but only ~modestly.
- **A variable ceiling.** Identical A+B code died at **19.6s and 34.7s** on
  different runs — but **both at the same point: chunk ~10 / rows ~20,000 (~70% of
  the feed)**. The death tracks rows processed, not wall-clock, and the wall budget
  itself is noisy. No constant-factor optimisation reliably beats a moving ceiling,
  and **Boots is ~3× the size** — it cannot fit one invocation at any constant
  factor.

**C bounds the work per invocation** so no single call approaches the ceiling. It's
the only growth-proof answer. A+B stays underneath (each slice still wants cheap
lookups); flush-batching becomes an in-slice accelerant, not the fix.

---

## 2. Architecture

Three roles for one function (`import-awin-feed`), selected by request body:

```
trigger (cron / manual, sliced_import=true)
      │
      ▼
┌──────────────┐   stage feed ONCE → Storage slice files,         ┌─────────────┐
│  STAGE       │   init import_run_state(run_id), then trigger ──▶ │ PROCESS #0  │
│  (mode=stage)│                                                   └──────┬──────┘
└──────────────┘                                                          │ A+B apply over
                                                                          │ slice 0 rows,
   each PROCESS slice: load cross-slice state → run the existing           │ persist state,
   chunked match+apply (A+B) over ITS rows → persist state →               │ trigger #1
   trigger next slice (or FINALIZE on the last).                           ▼
                                                              PROCESS #1 → … → #N
                                                                          │
                                                                          ▼
                                                                  ┌─────────────┐
                                                                  │ FINALIZE    │
                                                                  │ status=ok,  │
                                                                  │ cleanup     │
                                                                  └─────────────┘
```

Small feeds are unaffected: `sliced_import=false` (default) keeps the current
single-invocation path verbatim. Slicing is opt-in per retailer (a flag, like
`streaming_enabled`), enabled for 11/25/23 first.

---

## 3. Staging (Storage-backed, recommended)

**Why Storage, not re-stream-per-slice:** a gzip stream is sequential — a slice
can't seek to its row offset without inflating everything before it (O(offset)
inflate per slice; slice 5 would re-inflate 5/6 of Boots). Staging once removes that.

**Stage step (`mode=stage`):**
1. Stream-fetch + inflate + CSV-parse the feed **once** (the existing low-memory
   streaming path; parse was <5% of wall, so one pass fits a single invocation even
   for Boots — staging does NO catalogue lookups and NO writes, the two costs that
   546).
2. Write the parsed rows to Storage as **row-range slice files** under
   `import-staging/<run_id>/slice_<i>.jsonl` (one file per `SLICE_ROWS` rows, raw
   field arrays — header captured separately in `run_state`). Splitting at stage
   time means each PROCESS slice downloads only its own file (no re-parse, no
   re-inflate, O(slice) not O(offset)).
3. Insert `import_run_state` meta row: `run_id`, `retailer_id`, `run_started_at`
   (generated ONCE here — see §5), `total_slices`, `next_slice=0`, `status=staging`,
   zeroed counters + `creates_enqueued=0`.
4. Trigger PROCESS slice 0 (§6).

Open question (review): `.jsonl` of raw field arrays vs a compact CSV re-emit. JSONL
is simplest to consume; size is bounded by the feed. Cleanup in FINALIZE deletes the
`<run_id>/` prefix.

---

## 4. Slice processing (`mode=process`, slice_index=i)

1. **Load cross-slice state** from `import_run_state` (§5) into the in-memory
   accumulators.
2. **Download `slice_<i>.jsonl`** from Storage → feed it through the **existing A+B
   chunked match+apply loop unchanged** (CHUNK_SIZE chunks, `match_chunk_lookups`
   per chunk, flush on threshold). The per-brand cache (A) warms fresh for this
   slice (see §7 cost note).
3. **Persist new cross-slice state** (§5): append new `createdUrls`, bump
   `creates_enqueued`, add running counters.
4. **Advance + trigger:** set `next_slice=i+1`; if `i+1 < total_slices`, trigger
   PROCESS slice i+1 (§6) and return 200. Else run **FINALIZE**: aggregate counters
   → `last_import_status='ok'`, delete staging files, mark run_state done.

`last_import_status='running'` is (re)written at the top of every slice with the
slice index in the message, so the existing stuck-`running` monitor still flags a
dead chain (see [[feed-health-monitoring]]).

---

## 5. Cross-slice state — the crux

Every whole-import accumulator in the current code, and how it survives slicing.
**The key realisation: slices commit to the DB sequentially, so anything the next
slice can re-derive from committed rows does NOT need explicit persistence.**

| Accumulator | Purpose | Cross-slice handling |
|---|---|---|
| `run_started_at` | scopes `upsert_retailer_prices_lowest` (lowest-price-wins this run) | **PERSIST** (meta). Generated once at STAGE, passed to every slice's flush so cross-slice link dedup is preserved. |
| `seenEanToProductId` | in-feed: link a later row by EAN to a product an earlier row linked/created | **DB-COVERED.** After a slice commits, that product's `retailer_prices.ean_normalised` is in the `ean_product_index` VIEW → next slice's RPC finds it. Keep in-memory **per-slice** only. |
| `seenMpnToProductId` | same, MPN | **DB-COVERED** (`mpn_product_index` view). Per-slice. |
| `productByExact` / `productByStripped` / `loadedBrands` (Option A cache) | per-chunk lookup cache | **PER-SLICE** (re-warm each slice; derived from `products`, queryable). Not persisted. §7. |
| `createdByMatchKey` (4A-i) | suppress an in-feed **duplicate create** of the same new product | **DB-COVERED, benign deviation.** A product created in slice 1 is committed → slice 2 finds it by name (Tier 3) and **links** instead of suppressing. The link upserts on `(product_id, retailer_id)` → **no duplicate row**, just lowest-price-wins applied. Net: a counter shifts (suppressed_create→link) and the lower of the two prices wins. Keep **per-slice**; document the deviation. (Persist it too if exact counter parity is required — cheap, kind=`matchkey`.) |
| `createdUrls` (Tier 5) | suppress **shade variants** — different name, SAME url, of an in-feed-created product | **MUST PERSIST.** Shade variants share a url but differ by name, so name-matching can't catch them and the code does NOT query `retailer_prices.url`. Without persistence, slice 2 would **create a duplicate product** for a slice-1 shade variant. Persist as `(run_id, kind='url', key=url)` rows; load into the in-memory set at slice start. Bounded by create count (≈0 for re-imports like Stylevana; larger for first-imports like Boots). |
| `creates_enqueued` | drives the global 20k CREATE_CAP | **PERSIST** (meta). The cap is whole-import, so the running total must carry across slices. |
| `counts*` (update/link/create/excluded/…) | final report + `last_import_error` summary | **PERSIST** running totals (meta jsonb), aggregated in FINALIZE. Not correctness-critical, but needed for an accurate status/monitor. |

### 5.1 `import_run_state` schema (proposed)

```
import_run_state (
  run_id        text,          -- STAGE-generated uuid/timestamp
  retailer_id   int,
  kind          text,          -- 'meta' | 'url'  (| 'matchkey' if we persist 4A-i)
  key           text,          -- url / matchkey for set-kinds; null for meta
  meta          jsonb,         -- meta row only: run_started_at, total_slices,
                               -- next_slice, creates_enqueued, counters, status, header
  created_at    timestamptz default now(),
  primary key (run_id, kind, key)
)
```

- `meta` row: `(run_id, 'meta', '')`. The set-kinds: one row per url (per the
  user's "(run_id, kind, key)" shape).
- Slice start: `SELECT key FROM import_run_state WHERE run_id=$1 AND kind='url'`
  (paginated) → rebuild `createdUrls`; read the meta row for the rest.
- Slice end: bulk-insert the slice's NEW urls (`ON CONFLICT DO NOTHING`), update the
  meta row (counters, creates_enqueued, next_slice).

---

## 6. Trigger pattern (slice → next slice)

The parent slice must NOT stay alive while the child runs (that recreates the
single-long-invocation problem). Two options:

- **Option T1 (recommended): `pg_net` (`net.http_post`) from the slice.** The slice's
  final act is a `net.http_post(self_url, next_slice_payload)` via the DB; pg_net is
  fire-and-forget and dispatches independently of the worker's lifetime. The codebase
  already triggers imports this way (service-role key from vault). Clean lifetime
  decoupling, survives the parent returning immediately.
- **Option T2: direct `fetch(self_url, …)` without awaiting the body.** Simpler, no
  DB dependency, but the worker may be reclaimed before the request is dispatched
  unless held briefly; reliability is fiddlier than T1.

Recommend **T1**. Either way, payload = `{ retailer_id, run_id, slice_index, mode:'process' }`.
Auth: the same service-role bearer the cron uses.

---

## 7. Slice sizing + the cache-warmup trade-off

- Target **~10–15s of measured work per slice** (well under the observed 19.6s
  variable floor). From the A+B trace (~10s of measured work at rows 20k):
  `SLICE_ROWS ≈ 8,000–10,000`. Stylevana (~28k rows) → **~3 slices**; Boots
  (~50k+ rows) → **~6 slices**. Validated per-slice by the timing probe (kept).
- **Warm-up tax:** each slice re-warms the Option-A product cache (~5s `load_maps`
  for the cold chunks, since dense brands recur in every slice). At
  SLICE_ROWS≈9k that's ~5s warmup + ~5s flush ≈ within target. If warmup proves too
  large a fraction, two future mitigations (NOT in v1): (a) STAGE sorts rows by
  `match_brand` so each slice touches few brands → tiny warmup (parity-safe: the
  link upsert is order-independent; first-create-wins picks the same product); (b)
  persist the product cache — rejected (≈ same cost as re-querying).

---

## 8. Idempotency / crash resume

- **Happy path** is the goal; crash-resume is a bonus the structure enables.
- Slices are **approximately idempotent**: updates/links are upserts (re-running
  re-applies identically, run-scoped lowest-price). Creates are the exception — a
  re-run of a slice whose creates already committed will **find them by name/EAN and
  link instead of re-create** (DB-covered), so a retried slice does not duplicate
  products in the common case. Full exactly-once is out of scope for v1; document as
  **at-least-once with DB-dedup**.
- `next_slice` in the meta row is the resume cursor. A separate sweeper (or the
  existing monitor) can re-trigger a run stuck mid-chain from `next_slice`.

---

## 9. Parity & correctness summary

- Tiers 0–4 unchanged; `match_chunk_lookups` already parity-proven.
- Cross-slice link lowest-price: preserved via shared `run_started_at` (§5).
- Global create-cap: preserved via persisted `creates_enqueued` (§5).
- Shade-variant suppression: preserved via persisted `createdUrls` (§5).
- **One documented benign deviation:** `createdByMatchKey` becomes DB-covered →
  an in-feed duplicate-create that spans a slice boundary becomes a *link* (price
  upsert) rather than a *skip*. No duplicate rows; a counter and possibly which
  price wins differ. Persist `matchkey` rows to remove even this, if desired.
- Tier 5 stays in-feed-only (we do NOT restore DB-url matching here — that would be
  a separate, larger parity change).

Validation = the same pattern: per-slice timing probe; run Stylevana (3 slices) →
YesStyle → Boots; compare **aggregated** counts across slices to a single-invocation
dry-run baseline (must match modulo the one documented deviation).

---

## 10. Infra / migrations needed (on approval)

1. `import_run_state` table (§5.1) + index on `(run_id, kind)`.
2. A Storage bucket `import-staging` (private) + lifecycle/cleanup in FINALIZE.
3. `sliced_import boolean default false` on `retailer_import_config` (opt-in flag).
4. Confirm `pg_net` available + service-role key in vault for T1 (already used by
   the import triggers).
5. No new catalogue indexes (A+B already covers the per-chunk lookups).

---

## 11. Open decisions for review

1. **§3** stage format: `.jsonl` raw-field-arrays (simplest) vs compact CSV re-emit.
2. **§5** persist `createdByMatchKey` for exact counter parity, or accept the benign
   link-vs-skip deviation? (Recommend: accept; it's harmless and saves a per-slice
   load that scales with creates.)
3. **§6** trigger: pg_net (T1, recommended) vs direct fetch (T2).
4. **§7** SLICE_ROWS starting value (≈9k) and whether to ship brand-sort (§7a) in v1
   (recommend: no — measure warmup first).
5. **§8** scope crash-resume/sweeper in v1, or happy-path only?
6. Roll-out: opt-in flag on 11 → 25 → 23, same smallest-first order; keep the
   timing + flush probes until Boots validates.

No code until these are settled.
