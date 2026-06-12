# Streaming import path (import-awin-feed)

## Why
The legacy path loaded the entire decompressed feed into memory
(`text = decode(wholeFeed)` then `text.split("\n")`). For Debenhams' raw AWIN
feed (2.3M rows / 4.85GB uncompressed) that blows past the edge runtime's
~256MB ceiling and OOMs. The streaming path removes that ceiling by never
materialising the whole feed.

## What actually OOMs (and what doesn't)
The OOM is the **feed text**, not the action buckets. The three buckets are
already bounded independent of feed size:

| Bucket          | Bound                                                        |
|-----------------|-------------------------------------------------------------|
| `updateActions` | ≤ the retailer's existing `retailer_prices` rows            |
| `linkActions`   | ≤ distinct catalogue products (deduped to lowest price)     |
| `createActions` | ≤ the 20,000 hard safety cap                                |

So this change streams **only the I/O**. Action accumulation and the entire
apply phase are byte-for-byte identical to the pre-streaming version — link
price-dedup, the 20k cap, and the dry-run derived stats all keep working
unchanged. Mid-stream buffer flushing (as some early designs proposed) was
deliberately *not* done: it would break link price-dedup and the cap check for
no real memory benefit.

## Pipeline
```
fetch (streaming body)                _streaming-fetcher.ts
   └─ incremental gzip inflate (pako.Inflate push mode)
        └─ streaming CSV parse (quote-state across chunks)   _streaming-csv.ts
             └─ rowSource() async generator                  index.ts
                  └─ unchanged per-row classification body
                       └─ unchanged apply phase
```

### gzip
Stays on **pako**, not `DecompressionStream`. Deno's `DecompressionStream("gzip")`
fails with `"failed to write whole buffer"` on feeds >1.5MB (see the v6.5/v6.6
changelog in `index.ts`). pako is the proven decompressor; the only change is
driving it incrementally with `pako.Inflate` + `push(chunk, isLast)` instead of
`ungzip()` on the whole buffer. Validated byte-identical at every chunk size in
`scripts/streaming-pipeline.spike.mts`.

### CSV parser
Hand-rolled, dependency-free, quote-state carried across chunk boundaries
(including the escaped-`""` decision and multibyte UTF-8 via streaming
`TextDecoder`). It is **more correct** than legacy on one case: embedded newlines
inside quoted fields. Legacy split on `\n` first, shattering such rows; the
streaming parser keeps them whole. On a feed containing those rows, streaming
action counts can legitimately differ there. CRLF is also stripped cleanly
(legacy left a trailing `\r` on the last field). Tested in
`scripts/streaming-csv.test.mts` (includes a byte-by-byte re-chunk torture test).

## Feature flag & rollout
`retailer_import_config.streaming_enabled` (boolean, default false). The function
reads it defensively (`=== true`), so the column can be absent and everything
stays legacy. Promote one retailer at a time:

```sql
update retailer_import_config set streaming_enabled = true where retailer_id = <N>;
```

**Streaming is HTTP-only.** The flag is a no-op for `storage://` feeds — they are
already fully buffered by `supabase-js` `.download()`, so streaming gains nothing
and the extra allocations make a memory-marginal import worse. The function gates
on `streamingActive = streaming_enabled && !feedUrl.startsWith("storage://")`, so
storage retailers always run the legacy buffered path regardless of the flag.

Recommended order (HTTP retailers, smallest first): The Organic Pharmacy →
Escentual → Beauty Flash → Beauty Bay → Stylevana → YesStyle → Boots. Then
**Debenhams last**, switching its `feed_url` off the `storage://` pre-filter back
to a direct AWIN `fid` — that switch is precisely what makes streaming both apply
to Debenhams AND give it the memory benefit it needs (4.85GB feed). Branded
Beauty (storage google_shopping) is NOT a streaming candidate; leave it on legacy.

### Verified reliability (dry-run, 2026-06-12)
- HTTP path: The Organic Pharmacy 5/5, Beauty Bay (~7.2k rows) 5/5 — solid.
- storage path (Branded Beauty): flaky ~40–60% on **both** legacy and streaming —
  a pre-existing memory-marginal condition of storage imports, not caused by
  streaming. Worth a separate fix (the catalogue memory floor below + the storage
  download buffering); BB's daily legacy cron is likely silently failing often.

**Per-retailer rollback** (zero downtime):
```sql
update retailer_import_config set streaming_enabled = false where retailer_id = <N>;
```

## Verification per retailer
1. Dry-run on legacy (`streaming_enabled=false`, `dry_run=true`), capture counts.
2. Flip to streaming, dry-run again. Action counts should match within 1%
   (embedded-newline/CRLF feeds may differ slightly, and that's expected).
3. Real import, then confirm the next daily cron shows `last_import_status = ok`.

## Known memory floor (separate future spec)
Streaming bounds the *feed*, but the in-memory catalogue lookup maps
(`productByExact`, `productByStripped`, `eanToProductId`, `mpnToProductId`,
`urlToProductId`, `sizeByProductId`, `allProducts`) load the full catalogue
(~92k products) regardless and grow with each new retailer. They are the real
memory floor and are out of scope here. Measure them before promising a hard
ceiling like <80MB; the working target for Debenhams is <150MB.

## Tests / spikes
- `npx tsx scripts/streaming-csv.test.mts` — parser unit + torture tests
- `npx tsx scripts/streaming-pipeline.spike.mts` — gz→inflate→parse end-to-end
  parity (needs `pako` installed; the spikes used a `/tmp` install)
- `npx tsx scripts/categorisation-harness.mts` — proves `inferCategorisation`
  unchanged (75/75)
