# Phase 3 — Big-feed 546 re-diagnosis (profiled) + architectural options

**Status:** DESIGN ONLY — no implementation. Drafted 2026-06-15.
**Predecessor:** [PHASE_2_CHUNKED_APPLY.md](./PHASE_2_CHUNKED_APPLY.md) (chunked apply, deployed v88).
**Live function:** clean v88 (rolled back). The lazy per-brand cache is implemented
but **uncommitted** (working-tree only) — it is necessary but not sufficient (§3).

---

## 1. What we did and what we found

We built the lazy per-brand product cache the Phase 2 note called for ("FIX (next):
a cross-chunk lazy per-brand product cache so each brand is fetched ONCE"),
validated it, and ran the Stylevana canary. **It did not clear the 546.** So we
instrumented the importer with `performance.now()` deltas around every compute
bucket and wrote them to `import_memory_trace.timings`. This overturned the
Phase 2 hypothesis.

### 1.1 The cache works and is outcome-neutral

- **Parity:** Beauty Bay (26) dry-run counts **byte-identical** old vs new. Beauty
  Flash (27): all new-version runs identical at 10,545 rows; the only baseline
  delta was 3-row live-feed drift (`rows_with_mpn`, a feed-only counter, moved —
  proving the input changed, not the cache). Parity argument is rigorous: match
  keys are brand-prefixed, so a row of brand B only ever consults brand B's
  entries, present whether B was loaded this chunk or earlier; colliding keys
  always share a `match_brand` and load together → first-id-wins is identical.
- **Mechanism confirmed:** `chunk_exact` (cumulative product map) plateaus at ~28k
  by chunk 8, so each dense brand is fetched once.

### 1.2 But the canary still 546'd — and the cause is NOT what we thought

Stylevana (11) real apply **and dry-run** both 546 at ~21–28s. Controls:

| Control | Result | Rules out |
|---|---|---|
| Dry-run (skips apply/flush/writes) also 546s | apply path is **not** the cause | streamed-apply / write RPCs |
| `CHUNK_SIZE` 500 vs 2000 → identical heap (~65 MB) | per-chunk transient is **not** the driver | chunk sizing |
| Heap tops out ~65 MB; v88 dies at ~33 MB | 33 MB ≪ worker ceiling → **not memory** | OOM theories |

### 1.3 Profiling: it is DB round-trip latency, ~94% of wall time

v88, Stylevana dry-run, **cumulative ms at chunk 6 (12,000 rows seen):**

| bucket | ms | share |
|---|---:|---:|
| `loadChunkMaps` total (DB lookups) | **11,786** | **~94%** |
| &nbsp;&nbsp;• products (`WHERE match_brand = ANY`) | 8,188 | 69% of load |
| &nbsp;&nbsp;• ean_product_index | 1,848 | 16% |
| &nbsp;&nbsp;• retailer_prices (external_product_id) | 1,627 | 14% |
| &nbsp;&nbsp;• mpn (Stylevana feed has no MPNs) | 0 | 0% |
| parse (fetch + gzip-inflate + CSV) | 595 | ~4% |
| match-tier loop (total, all rows) | 335 | ~2% |
| inferCategorisation (create-path rows) | 91 | <1% |
| buildMatchKey (per row) | 24 | <1% |

`loadChunkMaps` grows ~2 s/chunk; the worker is killed around chunk 11–12 (~23 s).
**All per-row CPU combined is ~450 ms.** The importer spends essentially all of its
budget *waiting on sequential Postgres round-trips*, dominated by the per-chunk
**product refetch** (the cache's target), then EAN and ext-id (which the product
cache does **not** touch).

### 1.4 Consequences for the option set

- The "decouple categorisation" / "drop categorisation from the import path" ideas
  target `inferCategorisation`, which is **<1%** of wall time. **Rejected** — they
  cannot move the needle. (Categorisation stays in-path.)
- The real lever is **reducing DB round-trips** (and/or **bounding total wall per
  invocation**). Everything below is organised around that.

Why the cache alone wasn't enough: it removes the 69% products slice, but (a) the
cold-cache early chunks still pay to load ~28k products, and (b) EAN (16%) + ext-id
(14%) are per-chunk, uncached, and grow with the feed. Removing only products
leaves ~30% of `loadChunkMaps` plus the early warm-up — still enough sequential
round-trips to blow the wall budget on a feed this size.

### 1.5 Feed scale (why this bites 11/25/23 and not 26/27)

`retailer_prices` row counts: Boots (23) **31,942**, YesStyle (25) 11,102, Stylevana
(11) ~10k (partial). Beauty Bay (26) 7,344, Beauty Flash (27) 6,536 — small enough
that even the un-cached refetch finishes inside budget. The three dead feeds are
simply large enough that cumulative round-trip latency exceeds the worker wall.

---

## 2. Options (design only)

Each: scope · complexity · expected saving · behaviour delta vs current.

### Option A — Lazy per-brand product cache (BUILT, uncommitted)

- **Scope:** persistent `productByExact`/`productByStripped` + `loadedBrands`;
  fetch each brand once. ~58 LOC in `index.ts`, no DDL, no schema change.
- **Complexity:** low. Already written, parity-proven.
- **Saving:** removes the **69%** products slice from steady state (refetch → one
  cold load). Measured peak-heap cost +~30 MB (retains ~28k entries).
- **Behaviour delta:** none (byte-identical counts).
- **Verdict:** keep, but **necessary-not-sufficient**. Only lands the big feeds if
  paired with B or C. Risk if shipped alone: the +30 MB heap is a mild regression
  for medium feeds with no upside (they already pass).

### Option B — Push matching into a single set-based RPC per chunk (round-trip collapse)

- **Idea:** replace the 4 `eachIn` helpers (each issuing many paginated
  `IN (300 keys) × 1000-row pages` round-trips) with **one** `rpc('match_chunk',
  { brands, eans, mpns, ext_ids })` that does brand/EAN/MPN/ext-id matching
  set-based in SQL and returns only the matched rows (id, key, size, rp row).
- **Scope:** one Postgres function + swap `loadChunkMaps` to call it. Matching
  logic (`buildMatchKey` parity, size-verify) must be mirrored in SQL **or** the
  RPC returns candidate rows and JS keeps the tier logic (safer for parity — RPC
  is purely a fetch-collapse, not a logic move).
- **Complexity:** medium. The parity-safe variant (RPC fetches, JS still decides)
  is the same outputs as today with **1 round-trip/chunk instead of dozens**.
- **Saving:** attacks the *whole* 94% `loadChunkMaps` cost, not just products.
  Dozens of round-trips/chunk → 1. This is the highest-leverage single change.
- **Behaviour delta:** none if the RPC only fetches and JS keeps the tiers; needs
  careful pagination (RPC must return all candidates, not silently cap at 1000 —
  the same truncation bug Phase 2 hit). Indexes already exist on `match_brand`,
  `ean`, `mpn`, `(retailer_id, external_product_id)`.
- **Verdict:** **the real fix.** Compose with A (A makes the products portion of
  the RPC trivial on repeat brands) or supersede A (a per-chunk RPC that fetches
  only this chunk's brands is already cheap; the cache's marginal value shrinks).

### Option C — Sliced / resumable multi-invocation (durable ceiling-buster)

- **Idea:** stop processing the whole feed in one invocation. Drive it in slices —
  each invocation handles rows `[offset, offset+N)` and returns a cursor; a small
  orchestrator (cron loop, or self-re-invoke via `EdgeRuntime.waitUntil` /
  `fetch` to self, or a staging row in a `import_progress` table) continues until
  done. Feed body staged once to Storage so each slice doesn't re-download.
- **Scope:** larger. Needs: stage feed → Storage; a cursor/progress table;
  slice loop; idempotent apply (already mostly true — upserts); the create-cap and
  link lowest-price dedup must become cross-slice aware (carry state in the
  progress row or accept per-slice dedup).
- **Complexity:** high. Touches control flow, not just lookups.
- **Saving:** **bounds wall per invocation regardless of lookup cost** — the only
  option that is robust as feeds keep growing (Boots is 3× Stylevana and will
  outgrow any constant-factor win from A/B eventually).
- **Behaviour delta:** import becomes multi-request; partial-visibility window
  while a feed is mid-refresh; cross-slice link dedup needs a decision.
- **Verdict:** the durable safety net. Heavier; do it if B alone doesn't give
  enough headroom for Boots, or pre-emptively for growth.

### Rejected (data-driven)

- **Decouple categorisation to a staging table / drop it from import path** —
  `inferCategorisation` is <1% of wall (91 ms at 12k rows). No meaningful saving.

---

## 3. Recommendation

1. **Ship B (set-based fetch RPC), parity-safe variant** — collapses the 94% cost,
   no behaviour change, no new control flow. Validate with the same
   `import_memory_trace.timings` probe (kept in place): expect `load_maps_ms` to
   drop from ~12 s to well under 1 s/run.
2. **Re-evaluate A** once B lands. If a per-chunk RPC already fetches cheaply, the
   persistent cache's +30 MB heap may not be worth it; keep A only if B's
   per-chunk brand fetch is still measurable on the biggest feeds.
3. **Hold C in reserve** for Boots (31,942 rows) if B's headroom proves thin, or
   when any feed approaches the wall again. C is the only growth-proof answer.

**Do not** drop the `import_memory_trace` scaffolding (incl. the new `timings`
column) until the chosen fix is validated on a real Boots run.

---

## 4. Validation artifacts (this session)

- Profiled v88 source preserved at `/tmp/index.v88-profiled.ts` (timing probe).
- Lazy-cache source = current working tree (uncommitted).
- Trace rows: `import_memory_trace` where `retailer_id=11` and `timings is not null`.
- Stylevana (11) status reset from stuck `'running'` (canary 546 artifact) to
  `'error'` with an explanatory note; last good import remains 2026-06-12.
