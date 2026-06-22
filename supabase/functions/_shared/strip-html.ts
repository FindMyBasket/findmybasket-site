// Shared HTML-stripping + entity-decoding helper for feed-sourced free text
// (product descriptions). Feeds send descriptions with markup (<p>, <br>,
// <ul>) and HTML entities (&amp;, &nbsp;, &#39;). We store plain text, so this
// removes tags, decodes the common entities, and collapses whitespace.
//
// Deliberately dependency-free (runs in Deno edge functions) and conservative:
// it does not try to preserve structure, just produce clean readable prose.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  trade: "™",
  reg: "®",
  copy: "©",
  deg: "°",
  eacute: "é",
  egrave: "è",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named !== undefined ? named : match;
  });
}

/**
 * Strip HTML tags and decode entities from feed free text, returning collapsed
 * plain text. Block-level tags become spaces so words don't run together
 * (e.g. "</p><p>" → " "). Returns "" for empty/whitespace-only input.
 */
export function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  // Drop script/style bodies entirely before tag removal.
  let out = input.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Replace all remaining tags with a space (block separators) then decode.
  out = out.replace(/<[^>]*>/g, " ");
  out = decodeEntities(out);
  // Collapse all runs of whitespace (incl. decoded &nbsp;) to single spaces.
  out = out.replace(/\s+/g, " ").trim();
  return out;
}
