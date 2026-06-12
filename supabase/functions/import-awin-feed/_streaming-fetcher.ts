// Streaming feed reader for import-awin-feed.
//
// Exposes a SINGLE flat async generator, streamFeedRows(), that yields parsed
// CSV rows (string[]) one at a time. Flatness is the whole point: an earlier
// version chained five async generators (raw -> gzip-detect -> reassemble ->
// inflate -> parse -> rowSource). Deno's storage Blob.stream() re-chunks the
// in-memory blob into small pieces, and cost scaled as O(bytes x layers) in
// async microtasks — a 3MB feed blew the edge CPU budget (WORKER_RESOURCE_LIMIT).
// Here there is exactly one generator; per-byte and per-row work is synchronous,
// and there is one await per source read.
//
// Two source modes:
//   - storage://bucket/path : supabase-js .download() already buffers the whole
//     object into a Blob in memory, so "streaming" it gains nothing. We take the
//     ArrayBuffer, gunzip it whole (pako.ungzip, like the legacy path), and feed
//     it to the parser in fixed slices. storage:// feeds are pre-filtered and
//     small, so the buffer is cheap; this avoids the Blob.stream() chunk penalty.
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

// Yields parsed CSV rows (including the header row first). Populates `diag` in
// place once the first bytes have been seen.
export async function* streamFeedRows(
  feedUrl: string,
  supa: StorageLike,
  diag: FeedDiagnostics,
): AsyncGenerator<string[]> {
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
    // Feed the buffer to the parser in fixed slices (synchronous; no awaits).
    for (let off = 0; off < buf.length; off += SLICE) {
      const text = decoder.decode(buf.subarray(off, off + SLICE), { stream: true });
      if (text) for (const row of acc.push(text)) yield row;
    }
    const tail = decoder.decode();
    if (tail) for (const row of acc.push(tail)) yield row;
    const last = acc.flush();
    if (last) yield last;
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

  // Gzip is detected from the first chunk's magic bytes. pako.Inflate (push mode)
  // is set up lazily; its onData pushes decompressed chunks into `inflated`,
  // which we drain synchronously after every push.
  let inflator: pako.Inflate | null = null;
  let inflated: Uint8Array[] = [];
  let detected = false;

  const handleDecompressed = function* (bytes: Uint8Array): Generator<string[]> {
    const text = decoder.decode(bytes, { stream: true });
    if (text) for (const row of acc.push(text)) yield row;
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
      if (inflated.length) {
        for (const d of inflated) yield* handleDecompressed(d);
        inflated = [];
      }
    } else {
      yield* handleDecompressed(value);
    }
  }

  // End of stream: flush pako, the decoder, and the final partial row.
  if (inflator) {
    inflator.push(new Uint8Array(0), true);
    if (inflator.err) {
      throw new FeedFetchError(`Gzip decompression failed at end of stream: ${inflator.msg || inflator.err}`, 502, {});
    }
    for (const d of inflated) yield* handleDecompressed(d);
    inflated = [];
  }
  const tail = decoder.decode();
  if (tail) for (const row of acc.push(tail)) yield row;
  const last = acc.flush();
  if (last) yield last;
}
