/**
 * Standalone test for _streaming-csv.ts.
 *
 *   npx tsx scripts/streaming-csv.test.mts
 *
 * Covers: parity with legacy parseRow (no-embedded-newline case), the
 * cross-chunk torture test (re-chunk at every byte boundary, assert invariant
 * output), and the edge cases the spec calls out (embedded commas, embedded
 * newlines, escaped quotes, CRLF/LF, empty/trailing fields, BOM).
 */
import { CsvLineAccumulator, parseCsvStream } from "../supabase/functions/import-awin-feed/_streaming-csv.ts";

// ── Legacy reference implementation, copied verbatim from index.ts ──────────
function parseRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) { out.push(cur); cur = ""; }
    else { cur += ch; }
  }
  out.push(cur);
  return out;
}
// How index.ts turns a whole feed into rows (the legacy path).
function legacyRows(feed: string): string[][] {
  const lines = feed.split("\n");
  const out: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = i === 0 ? lines[0].replace(/^﻿/, "") : lines[i];
    if (!line.trim()) continue; // caller skips blank lines
    out.push(parseRow(line).map((f) => f.replace(/^"|"$/g, "")));
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const enc = new TextEncoder();
async function* chunked(text: string, size: number): AsyncGenerator<Uint8Array> {
  const bytes = enc.encode(text);
  for (let i = 0; i < bytes.length; i += size) yield bytes.slice(i, i + size);
}
async function streamRows(text: string, chunkSize: number): Promise<string[][]> {
  const rows: string[][] = [];
  for await (const r of parseCsvStream(chunked(text, chunkSize))) rows.push(r);
  return rows;
}
// How index.ts will use the parser: same per-field strip the legacy path
// applies (`parseRow(line).map(f => f.replace(/^"|"$/g, ""))`). Applying it here
// makes the comparison reflect the real wiring, not the raw parser.
function wired(rows: string[][]): string[][] {
  return rows
    .filter((r) => r.some((f) => f.trim() !== "") || r.length > 1) // caller's blank-line skip
    .map((r) => r.map((f) => f.replace(/^"|"$/g, "")));
}

let pass = 0, fail = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`✗ ${label}\n    expected: ${e}\n    actual:   ${a}`); }
}

// ── 1. Parity with legacy across a battery of no-embedded-newline feeds ──────
const parityFeeds: string[] = [
  `a,b,c\n1,2,3\n4,5,6\n`,
  `a,b,c\n1,2,3\n4,5,6`,                                   // no trailing newline
  `name,price\n"Foo, Bar",9.99\n"Baz ""Special""",1.00\n`, // commas + escaped quotes
  `h1,h2\n,\n"",""\n`,                                      // empty + quoted-empty fields
  `h1,h2,h3\na,,c\n,b,\n`,                                  // interior empties
  `﻿h1,h2\n1,2\n`,                                     // BOM on header
  `a,b\nval,"trailing,comma,"\n`,                           // trailing comma inside quotes
  `a,b,c\n1,2,3\n\n4,5,6\n`,                                // blank line in the middle
];
for (const [i, feed] of parityFeeds.entries()) {
  const expected = legacyRows(feed);
  // Test at several chunk sizes including 1 byte (worst case for boundaries).
  for (const size of [1, 2, 3, 7, 64, 100000]) {
    const got = wired(await streamRows(feed, size));
    eq(got, expected, `parity feed #${i} @chunk=${size}`);
  }
}

// ── 1b. CRLF: documented improvement over legacy ─────────────────────────────
// Legacy splits on "\n" only, leaving a trailing "\r" contaminating the LAST
// field of every row. The spec requires the streaming parser to handle CRLF, so
// it strips the CR. This is a sub-1% improvement, not a regression.
{
  const feed = `h1,h2\r\nx,y\r\nz,w\r\n`;
  eq(legacyRows(feed), [["h1", "h2\r"], ["x", "y\r"], ["z", "w\r"]],
    "legacy leaves trailing CR on last field (the bug we fix)");
  eq(wired(await streamRows(feed, 3)), [["h1", "h2"], ["x", "y"], ["z", "w"]],
    "streaming strips CRLF cleanly");
}

// ── 2. Torture: re-chunk at EVERY byte boundary, assert invariant ────────────
{
  const feed = `name,price,desc\n"A, B",1.50,"line one\nline two"\n"C""D",2.00,plain\n`;
  const baseline = await streamRows(feed, 100000);
  const totalBytes = enc.encode(feed).length;
  let invariant = true;
  for (let size = 1; size <= totalBytes; size++) {
    const got = await streamRows(feed, size);
    if (JSON.stringify(got) !== JSON.stringify(baseline)) {
      invariant = false;
      console.error(`✗ torture: output changed at chunk size ${size}`);
      console.error(`    baseline: ${JSON.stringify(baseline)}`);
      console.error(`    got:      ${JSON.stringify(got)}`);
      break;
    }
  }
  eq(invariant, true, "torture: output invariant across all chunk boundaries");
  // And assert the embedded-newline row was kept whole (the killer case).
  eq(baseline[1], ["A, B", "1.50", "line one\nline two"], "embedded newline kept in one row");
  eq(baseline[2], ['C"D', "2.00", "plain"], "escaped quote across fields");
}

// ── 3. Embedded newline: legacy SHATTERS, streaming KEEPS WHOLE ──────────────
{
  const feed = `id,desc\n1,"multi\nline"\n2,ok\n`;
  const legacy = legacyRows(feed);
  const stream = wired(await streamRows(feed, 5));
  eq(legacy.length, 4, "legacy shatters embedded-newline feed into 4 rows (broken)");
  eq(stream.length, 3, "streaming keeps embedded-newline feed as 3 logical rows");
  eq(stream[1], ["1", "multi\nline"], "streaming row intact");
}

// ── 4. flush() on feed with no trailing newline via the sync core ────────────
{
  const acc = new CsvLineAccumulator();
  const mid = acc.push("a,b,c\n1,2,");
  eq(mid, [["a", "b", "c"]], "sync core emits completed row, holds partial");
  eq(acc.flush(), ["1", "2", ""], "sync core flush returns trailing partial row");
  eq(acc.flush(), null, "sync core flush is idempotent/empty after drain");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
