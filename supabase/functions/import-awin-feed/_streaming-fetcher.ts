// Streaming feed reader for import-awin-feed.
//
// Exposes a SINGLE flat async generator, streamFeedRowBatches(), that yields
// BATCHES of parsed CSV rows (string[][]) — one batch per source chunk/slice,
// not one yield per row. Two flatness rules, both learned the hard way against
// the Deno edge runtime's resource limits:
//   1. Shallow nesting. An early version chained five async generators; Deno's
//      storage Blob.stream() re-chunks the in-memory blob into tiny pieces, so
//      cost scaled O(bytes x layers) in microtasks and a 3MB feed blew the CPU
//      budget. There is now exactly one generator.
//   2. Batch, don't drip. Yielding one row at a time still costs one await per
//      row (~7.7k for a small feed). That alone was enough to flakily trip
//      WORKER_RESOURCE_LIMIT (546). Yielding a whole chunk's worth of rows at
//      once drops the await count to ~one-per-source-chunk; the consumer loops
//      the batch synchronously.
//
// Two source modes:
//   - storage://bucket/path : supabase-js .download() already buffers the whole
//     object into a Blob, so "streaming" it gains nothing. We take the
//     ArrayBuffer, gunzip it whole (pako.ungzip, like the legacy path), and feed
//     it to the parser in fixed slices. storage:// feeds are pre-filtered/small.
//   - http(s):// : TRUE streaming via Response.body. Network chunks are normal
//     (~64KB), gzip is inflated incrementally with pako.Inflate push mode, and
//     nothing larger than one chunk + one partial row is ever resident. This is
//     the path that matters for huge direct AWIN feeds (Debenhams, Sephora…).
import pako from "https://esm.sh/pako@2.1.0";
import { CsvLineAccumulator } from "./_streaming-csv.ts";

export class FeedFetchError extends Error {
  status: number;
  detail: Record<string, unknown>;
  constructor(message: string, status: number, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = "FeedFetchError";
    this.status = status;
    this.detail = detail;
  }
}

interface StorageLike {
  storage: {
    from(bucket: string): { download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }> };
  };
}

export interface FeedDiagnostics {
  gzipped: boolean | null;
  firstBytesHex: string;
  source: string;
}

const SLICE = 1 << 18; // 256KB: parser feed granularity for the buffered path

function hexPreview(bytes: Uint8Array): string {
  return Array.from(bytes.slice(0, 32)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
}
function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

// Yields batches of parsed CSV rows (the first batch's first row is the header).
// Populates `diag` in place once the first bytes have been seen. Empty batches
// are never yielded.
export async function* streamFeedRowBatches(
  feedUrl: string,
  supa: StorageLike,
  diag: FeedDiagnostics,
): AsyncGenerator<string[][]> {
  const acc = new CsvLineAccumulator();
  const decoder = new TextDecoder("utf-8");

  if (feedUrl.startsWith("storage://")) {
    diag.source = "supabase-storage";
    const withoutScheme = feedUrl.slice("storage://".length);
    const slashIdx = withoutScheme.indexOf("/");
    if (slashIdx < 0) {
      throw new FeedFetchError("Invalid storage URL — expected format storage://bucket/path", 400, { feed_url: feedUrl });
    }
    const bucket = withoutScheme.slice(0, slashIdx);
    const objectPath = withoutScheme.slice(slashIdx + 1);
    const { data, error } = await supa.storage.from(bucket).download(objectPath);
    if (error || !data) {
      throw new FeedFetchError("Failed to download from Supabase Storage", 502, {
        details: error?.message || "no data",
        bucket,
        object_path: objectPath,
        hint: "Has the GitHub Action uploaded this file yet? Check the Actions tab.",
      });
    }
    let buf = new Uint8Array(await data.arrayBuffer());
    diag.firstBytesHex = hexPreview(buf);
    diag.gzipped = isGzip(buf);
    if (diag.gzipped) {
      try {
        buf = pako.ungzip(buf);
      } catch (e) {
        throw new FeedFetchError(`Gzip decompression failed: ${String(e)}`, 502, {});
      }
    }
    for (let off = 0; off < buf.length; off += SLICE) {
      const text = decoder.decode(buf.subarray(off, off + SLICE), { stream: true });
      if (text) {
        const batch = acc.push(text);
        if (batch.length) yield batch;
      }
    }
    const tail = decoder.decode();
    if (tail) {
      const batch = acc.push(tail);
      if (batch.length) yield batch;
    }
    const last = acc.flush();
    if (last) yield [last];
    return;
  }

  // ── HTTP(S): true streaming ────────────────────────────────────────────────
  diag.source = "http";
  const resp = await fetch(feedUrl, {
    headers: {
      "Accept-Encoding": "identity",
      "User-Agent": "FindMyBasket/1.0 (Supabase Edge Function)",
    },
  });
  if (!resp.ok || !resp.body) {
    throw new FeedFetchError(`Feed download failed: ${resp.status}`, 502, { status_text: resp.statusText });
  }
  const reader = resp.body.getReader();

  let inflator: pako.Inflate | null = null;
  let inflated: Uint8Array[] = [];
  let detected = false;

  // Decode a decompressed byte chunk and return the rows it completed.
  const rowsFrom = (bytes: Uint8Array): string[][] => {
    const text = decoder.decode(bytes, { stream: true });
    return text ? acc.push(text) : [];
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.length === 0) continue;

    if (!detected) {
      detected = true;
      diag.firstBytesHex = hexPreview(value);
      diag.gzipped = isGzip(value);
      if (diag.gzipped) {
        inflator = new pako.Inflate();
        inflator.onData = (chunk: Uint8Array) => inflated.push(chunk);
      }
    }

    if (inflator) {
      inflator.push(value, false);
      if (inflator.err) {
        throw new FeedFetchError(`Gzip decompression failed: ${inflator.msg || inflator.err}`, 502, {});
      }
      // Coalesce every decompressed chunk produced by this push into one batch.
      const batch: string[][] = [];
      for (const d of inflated) for (const row of rowsFrom(d)) batch.push(row);
      inflated = [];
      if (batch.length) yield batch;
    } else {
      const batch = rowsFrom(value);
      if (batch.length) yield batch;
    }
  }

  // End of stream: flush pako, the decoder, and the final partial row.
  if (inflator) {
    inflator.push(new Uint8Array(0), true);
    if (inflator.err) {
      throw new FeedFetchError(`Gzip decompression failed at end of stream: ${inflator.msg || inflator.err}`, 502, {});
    }
    const batch: string[][] = [];
    for (const d of inflated) for (const row of rowsFrom(d)) batch.push(row);
    inflated = [];
    if (batch.length) yield batch;
  }
  const tail = decoder.decode();
  if (tail) {
    const batch = acc.push(tail);
    if (batch.length) yield batch;
  }
  const last = acc.flush();
  if (last) yield [last];
}
