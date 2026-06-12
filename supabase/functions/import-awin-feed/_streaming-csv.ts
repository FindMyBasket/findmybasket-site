// Streaming CSV parser for import-awin-feed.
//
// Why this exists: the legacy path did `text = decode(wholeFeed)` then
// `text.split("\n")`, materialising the entire feed (4.85GB uncompressed for
// Debenhams) plus a parallel array of every line. That is the OOM. This parser
// consumes a byte stream incrementally and yields one parsed row at a time, so
// peak memory is one chunk + one row, regardless of feed size.
//
// Output contract: parseCsvStream yields string[] rows whose fields are
// IDENTICAL to the legacy `parseRow(line).map(f => f.replace(/^"|"$/g, ""))`
// for any feed WITHOUT embedded newlines in quoted fields. The quote/escape
// semantics deliberately mirror the legacy parseRow() char loop:
//   - a `"` toggles quote state (matching legacy's position-agnostic toggle)
//   - inside quotes, `""` is a literal quote
//   - a comma outside quotes ends a field
// On top of that, this parser is correct for the case legacy got wrong:
// embedded newlines inside quoted fields. Legacy split on "\n" first, so a
// quoted newline shattered one logical row into several broken rows (which then
// failed price/match checks and were silently excluded). This parser keeps them
// together. That is strictly more correct; on a retailer whose feed contains
// such rows the action counts can legitimately differ from legacy there.
//
// Cross-chunk safety: quote state, the field buffer, the partial row, the
// pending-escaped-quote decision, and multibyte UTF-8 sequences are all carried
// across chunk boundaries via TextDecoder({stream:true}) and the parser's own
// retained state. No row is emitted until its terminating (unquoted) newline.

// A purely synchronous, push-based core so it can be unit-tested without any
// async/stream plumbing. parseCsvStream() is a thin async wrapper over it.
export class CsvLineAccumulator {
  private cur = "";
  private fields: string[] = [];
  private inQuotes = false;
  // When inside quotes and we have just seen a `"`, we cannot yet tell whether
  // it closes the field or is the first half of an escaped `""` until we see the
  // next character. This flag defers that decision across the chunk boundary.
  private pendingQuote = false;
  private sawAnyChar = false;
  private rowHasContent = false;

  // Feed a chunk of decoded text. Returns any rows completed by this chunk.
  push(text: string): string[][] {
    const rows: string[][] = [];
    for (let i = 0; i < text.length; i++) {
      let ch = text[i];

      // Strip a leading UTF-8 BOM at the very start of the stream.
      if (!this.sawAnyChar) {
        this.sawAnyChar = true;
        if (ch === "﻿") continue;
      }

      if (this.pendingQuote) {
        // We previously saw a `"` while inQuotes. Decide now.
        this.pendingQuote = false;
        if (ch === '"') {
          // Escaped quote: literal `"`, stay in quotes.
          this.cur += '"';
          this.rowHasContent = true;
          continue;
        }
        // It was a closing quote. Leave quote mode and reprocess this char
        // through the normal (unquoted) path below.
        this.inQuotes = false;
      }

      if (this.inQuotes) {
        if (ch === '"') {
          // Defer: could be a closing quote or the start of an escaped `""`.
          this.pendingQuote = true;
        } else {
          // Everything inside quotes is literal data, including commas, CR, LF.
          this.cur += ch;
          this.rowHasContent = true;
        }
        continue;
      }

      // ── Not in quotes ──
      if (ch === '"') {
        this.inQuotes = true;
        this.rowHasContent = true;
      } else if (ch === ",") {
        this.fields.push(this.cur);
        this.cur = "";
        this.rowHasContent = true;
      } else if (ch === "\n") {
        // Record terminator. Strip a trailing CR (CRLF line endings).
        if (this.cur.endsWith("\r")) this.cur = this.cur.slice(0, -1);
        this.fields.push(this.cur);
        const completed = this.fields;
        this.fields = [];
        this.cur = "";
        // Mirror legacy behaviour: blank lines (no content at all) are skipped
        // by the caller via `!line.trim()`. We still emit them as a single
        // empty field row and let the caller filter, to keep the contract that
        // the caller decides what "blank" means.
        rows.push(completed);
        this.rowHasContent = false;
      } else if (ch === "\r") {
        // A lone CR not part of CRLF, outside quotes — keep it in the field;
        // it will be trimmed if it turns out to precede a \n. Otherwise it is
        // data. Buffer it on the field; the \n branch trims the trailing one.
        this.cur += ch;
      } else {
        this.cur += ch;
        this.rowHasContent = true;
      }
    }
    return rows;
  }

  // Flush a final row that was not newline-terminated (feed ended without a
  // trailing newline). Returns the row, or null if there is nothing buffered.
  flush(): string[] | null {
    if (this.pendingQuote) {
      // A trailing `"` that closed the final quoted field.
      this.pendingQuote = false;
      this.inQuotes = false;
    }
    if (this.cur.endsWith("\r")) this.cur = this.cur.slice(0, -1);
    if (this.fields.length === 0 && this.cur === "" && !this.rowHasContent) {
      return null;
    }
    this.fields.push(this.cur);
    const completed = this.fields;
    this.fields = [];
    this.cur = "";
    this.rowHasContent = false;
    return completed;
  }
}

// Async wrapper: byte stream -> rows. Decodes incrementally so multibyte UTF-8
// sequences that straddle a chunk boundary are handled by TextDecoder's
// streaming mode rather than producing replacement characters.
export async function* parseCsvStream(
  byteStream: AsyncIterable<Uint8Array>,
): AsyncGenerator<string[]> {
  const decoder = new TextDecoder("utf-8");
  const acc = new CsvLineAccumulator();
  for await (const chunk of byteStream) {
    const text = decoder.decode(chunk, { stream: true });
    if (!text) continue;
    for (const row of acc.push(text)) yield row;
  }
  // Flush any bytes still held in the decoder, then any final partial row.
  const tail = decoder.decode();
  if (tail) {
    for (const row of acc.push(tail)) yield row;
  }
  const last = acc.flush();
  if (last) yield last;
}
