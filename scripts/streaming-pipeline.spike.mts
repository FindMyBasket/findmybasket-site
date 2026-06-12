/**
 * End-to-end pipeline spike:  gz bytes -> incremental inflate -> CSV parser -> rows.
 *
 *   npx tsx scripts/streaming-pipeline.spike.mts
 *
 * Validates the GLUE between streaming inflate and the streaming CSV parser
 * against the legacy whole-buffer approach (pako.ungzip + split("\n") +
 * parseRow). The inflate loop here is a byte-for-byte mirror of inflateStream()
 * in _streaming-fetcher.ts (which can't be imported directly because it pulls
 * pako from an esm.sh URL). pako is loaded from the /tmp spike install.
 *
 * What this CANNOT test: the Deno edge runtime itself (fetch streaming,
 * Blob.stream, pako under Deno). That is only provable on a deployed dry-run.
 */
import { createRequire } from "node:module";
import { parseCsvStream } from "../supabase/functions/import-awin-feed/_streaming-csv.ts";
const require = createRequire("/tmp/gzspike/");
const pako = require("pako");
const zlib = require("node:zlib");

// ── Mirror of inflateStream() from _streaming-fetcher.ts ─────────────────────
async function* inflateStream(byteStream: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  const inflator = new pako.Inflate();
  const out: Uint8Array[] = [];
  inflator.onData = (chunk: Uint8Array) => out.push(chunk);
  for await (const chunk of byteStream) {
    inflator.push(chunk, false);
    if (inflator.err) throw new Error(`inflate err: ${inflator.msg}`);
    while (out.length) yield out.shift()!;
  }
  inflator.push(new Uint8Array(0), true);
  if (inflator.err) throw new Error(`inflate end err: ${inflator.msg}`);
  while (out.length) yield out.shift()!;
}

// ── Legacy reference: whole-buffer ungzip + split + parseRow ──────────────────
function parseRow(line: string): string[] {
  const out: string[] = [];
  let cur = ""; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { out.push(cur); cur = ""; }
    else { cur += ch; }
  }
  out.push(cur);
  return out;
}
function legacyRows(gz: Uint8Array): string[][] {
  const text = new TextDecoder("utf-8").decode(pako.ungzip(gz));
  const lines = text.split("\n");
  const rows: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = i === 0 ? lines[0].replace(/^﻿/, "") : lines[i];
    if (!line.trim()) continue;
    rows.push(parseRow(line).map((f) => f.replace(/^"|"$/g, "")));
  }
  return rows;
}

// ── Build a feed WITHOUT embedded newlines (true parity target) ──────────────
function buildPlainFeed(n: number): string {
  let s = "id,name,brand,price\n";
  for (let i = 0; i < n; i++) {
    s += `${i},"Serum ${i}, 30ml","Brand ${i % 50}",${(i / 100).toFixed(2)}\n`;
  }
  return s;
}

const enc = new TextEncoder();
async function* chunkBytes(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.slice(i, i + size);
}
async function streamRows(gz: Uint8Array, gzChunk: number): Promise<string[][]> {
  const rows: string[][] = [];
  const bytes = inflateStream(chunkBytes(gz, gzChunk));
  for await (const r of parseCsvStream(bytes)) {
    if (r.some((f) => f.trim() !== "") || r.length > 1) {
      rows.push(r.map((f) => f.replace(/^"|"$/g, "")));
    }
  }
  return rows;
}

let pass = 0, fail = 0;
function check(cond: boolean, label: string) {
  if (cond) pass++; else { fail++; console.error(`✗ ${label}`); }
}

// 1. Parity on a 5,000-row gzipped feed, across several gz chunk sizes.
{
  const feed = buildPlainFeed(5000);
  const gz = new Uint8Array(zlib.gzipSync(Buffer.from(feed, "utf8")));
  const expected = legacyRows(gz);
  for (const cs of [1, 64, 4096, 1 << 16]) {
    const got = await streamRows(gz, cs);
    check(JSON.stringify(got) === JSON.stringify(expected), `5k-row parity @gzChunk=${cs}`);
  }
  console.log(`feed: ${feed.length} bytes uncompressed, ${gz.length} gz, ${expected.length} rows`);
}

// 2. Embedded newline in a quoted field survives the full gz->inflate->parse chain.
{
  const feed = `id,desc\n1,"alpha\nbeta"\n2,plain\n`;
  const gz = new Uint8Array(zlib.gzipSync(Buffer.from(feed, "utf8")));
  const got = await streamRows(gz, 3); // [header, row1, row2]
  check(got.length === 3, "embedded-newline feed -> header + 2 logical rows through full chain");
  check(JSON.stringify(got[1]) === JSON.stringify(["1", "alpha\nbeta"]), "embedded-newline row intact through inflate+parse");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
