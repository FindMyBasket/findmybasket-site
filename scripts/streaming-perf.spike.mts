/**
 * Perf spike: is the streaming parser pipeline pathologically slow, and does it
 * degrade with small source chunks (as Deno's storage Blob.stream() may yield)?
 *
 *   npx tsx scripts/streaming-perf.spike.mts
 */
import { parseCsvStream } from "../supabase/functions/import-awin-feed/_streaming-csv.ts";

function parseRow(line: string): string[] {
  const out: string[] = []; let cur = ""; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { out.push(cur); cur = ""; }
    else { cur += ch; }
  }
  out.push(cur); return out;
}

// Build a google_shopping-shaped feed ~7700 rows with realistic long fields.
function buildFeed(n: number): string {
  const header = "id,title,brand,price,sale_price,availability,aw_deep_link,google_product_category,product_type,gtin,mpn,image_link\n";
  let s = header;
  for (let i = 0; i < n; i++) {
    s += [
      `BB${i}`,
      `"Some Brand Very Long Product Title Number ${i} With Extra Descriptive Words 50ml"`,
      `"Brand ${i % 80}"`,
      `${(i / 100).toFixed(2)} GBP`,
      `${(i / 110).toFixed(2)} GBP`,
      i % 3 === 0 ? "in_stock" : "out_of_stock",
      `"https://www.awin1.com/cread.php?awinmid=1234&awinaffid=2841268&ued=https%3A%2F%2Fexample.com%2Fproduct%2F${i}"`,
      `"Health & Beauty > Personal Care > Cosmetics > Skin Care"`,
      `"Skincare"`,
      `50000000${String(i).padStart(5, "0")}`,
      `MPN-${i}`,
      `"https://images.example.com/products/${i}/main-large.jpg"`,
    ].join(",") + "\n";
  }
  return s;
}

const enc = new TextEncoder();
async function* chunked(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.slice(i, i + size);
}

const N = 7700;
const feed = buildFeed(N);
const bytes = enc.encode(feed);
console.log(`feed: ${N} rows, ${(bytes.length / 1024 / 1024).toFixed(2)} MB`);

// Baseline: legacy whole-buffer split + parseRow.
{
  const t0 = performance.now();
  const text = new TextDecoder().decode(bytes);
  const lines = text.split("\n");
  let rows = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = parseRow(lines[i]).map((x) => x.replace(/^"|"$/g, ""));
    rows += f.length > 0 ? 1 : 0;
  }
  console.log(`legacy split+parseRow:        ${(performance.now() - t0).toFixed(0)}ms  (${rows} rows)`);
}

// Streaming pipeline at various source chunk sizes.
for (const cs of [65536, 4096, 256, 32]) {
  const t0 = performance.now();
  let rows = 0;
  for await (const f of parseCsvStream(chunked(bytes, cs))) {
    if (f.length === 1 && !f[0].trim()) continue;
    const stripped = f.map((x) => x.replace(/^"|"$/g, ""));
    rows += stripped.length > 0 ? 1 : 0;
  }
  const ms = performance.now() - t0;
  console.log(`streaming parseCsvStream @${String(cs).padStart(5)}B chunks: ${ms.toFixed(0)}ms  (${rows} rows)`);
}

// Replicate the edge function's actual generator nesting depth (5 layers) to
// see whether tiny chunks + deep nesting is the cliff.
async function* layer(src: AsyncIterable<Uint8Array>) { for await (const c of src) yield c; }
function nest(src: AsyncIterable<Uint8Array>, depth: number): AsyncIterable<Uint8Array> {
  let s = src; for (let i = 0; i < depth; i++) s = layer(s); return s;
}
for (const cs of [256, 16, 4, 1]) {
  const t0 = performance.now();
  let rows = 0;
  for await (const f of parseCsvStream(nest(chunked(bytes, cs), 4))) {
    if (f.length === 1 && !f[0].trim()) continue;
    rows++;
  }
  const ms = performance.now() - t0;
  console.log(`5-layer-nested @${String(cs).padStart(5)}B chunks: ${ms.toFixed(0)}ms  (${rows} rows)`);
}
