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
  // ADDED 24 Aug 2026. The eight above were the vocabulary; these are what the feeds
  // actually sent that it did not cover, DERIVED BY COUNTING THE RESIDUE IN STORAGE
  // (regexp_matches over every products.description) rather than guessed at a second time.
  // A decoder defined by a vocabulary decodes only that vocabulary, and the leftovers
  // are not random -- they are exactly the entries missing from the map. Item 284.
  bull: "•",
  middot: "·",
  shy: "",           // soft hyphen: invisible in prose, so it is removed rather than kept
  dagger: "†",
  Dagger: "‡",   // exact-case; see the lookup order in decodeEntities
  sup2: "²",
  frac12: "½",
  ccedil: "ç",
  iacute: "í",
  icirc: "î",
  ocirc: "ô",
  szlig: "ß",
  agrave: "à",
  acirc: "â",
  ecirc: "ê",
  iuml: "ï",
  ouml: "ö",
  uuml: "ü",
  auml: "ä",
  ntilde: "ñ",
  oacute: "ó",
  aacute: "á",
  uacute: "ú",
  euro: "€",
  pound: "£",
  times: "×",
  minus: "−",
  bdquo: "„",
  sbquo: "‚",
  laquo: "«",
  raquo: "»",
  oslash: "ø",
  aring: "å",
  aelig: "æ",
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
    // EXACT CASE FIRST, then a lower-case fallback. The fallback is what lets the
    // real-world `&Bull;` (seen in feed text) decode at all; the exact pass is what stops
    // it turning `&Dagger;` (‡) into `&dagger;` (†), which a lower-case-only lookup did.
    const exact = NAMED_ENTITIES[body];
    if (exact !== undefined) return exact;
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

/**
 * Decode HTML entities in a feed-supplied PRODUCT NAME, without tag-stripping or
 * whitespace collapsing beyond a trim.
 *
 * WHY NAMES NEED THEIR OWN ENTRY POINT. stripHtml was only ever applied to descriptions;
 * every importer took the feed's title field raw. So `Pestle &amp; Mortar Chummi Lip Mask`
 * was stored verbatim, and the consequences were not cosmetic:
 *
 *   1. React escapes the stored string correctly, producing `&amp;amp;` in the served title.
 *   2. stripBrandPrefix builds `^Pestle & Mortar[\s\-:]*`, which cannot match
 *      `Pestle &amp; Mortar`, so displayProductTitle prepended the brand AGAIN --
 *      "Pestle & Mortar Pestle & Mortar Chummi Lip Mask".
 *   3. fmb_build_match_key kept the letters: the stored key was
 *      `pestle mortar amp mortar chummi lip mask 20g coconut`, so the product could not
 *      match a clean row for the same item from any other feed.
 *
 * ONE CORRUPT CHARACTER DEFEATED A STRING-EQUALITY GUARD TWO LAYERS DOWNSTREAM. That is
 * the transferable part, not the ampersand. Item 284.
 *
 * Runs BEFORE excludes, match_key and categorisation so everything downstream sees the
 * decoded name -- the same ordering the Debenhams and slug-reconstruction hygiene uses.
 */
export function decodeFeedName(input: string | null | undefined): string {
  if (!input) return "";
  return decodeEntities(input).replace(/\s+/g, " ").trim();
}
