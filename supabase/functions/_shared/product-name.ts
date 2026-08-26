// MIRROR of lib/format/product-name.ts for the Deno runtime, which cannot import a
// Next module. Kept honest by lib/format/__tests__/product-name.test.ts, which imports
// BOTH and asserts they AGREE on every case -- not merely that each works. See the note
// there: agreement is the property, and item 345 is why it is asserted at extraction
// rather than discovered later.
//
// Helpers for de-duplicating the brand prefix that most product names already
// carry. Roughly 90% of catalogue names start with their own brand string
// (e.g. name "Kiehl's Calendula Cleanser" + brand "Kiehl's"), so naively
// prepending the brand again produces "Kiehl's Kiehl's Calendula Cleanser".
// These helpers strip the redundant prefix for display, titles and meta.
//
// ── MATCHING IGNORES PUNCTUATION AND SPACING, AND CONSUMES REPEATS ──────────────
//
// Until 26 August 2026 the match was a literal regex, `^<brand>[\s\-:]*`, which
// required the name's prefix to be spelled EXACTLY like the brand column. Measured
// across 136,584 branded products, it missed 2,890 -- and missing meant PREPENDING,
// so the helper written to prevent a doubled brand was itself producing one:
//
//     brand "e.l.f."         name "e. l.f. Cosmetics 16hr Camo Concealer"
//        -> "e.l.f. e. l.f. Cosmetics 16hr Camo Concealer"
//     brand "L.A. COLORS"    name "L. A. Colors 28 Color Eyeshadow"
//     brand "Nails Inc"      name "Nails. Inc 2-in-1 Base Coat"
//     brand "Dr. Jart+"      name "Dr Jart Brightamin Serum"
//
// The failure class is entirely punctuation and spacing. `_shared/strip-html.ts`
// records the same bug found from the other end: `Pestle &amp; Mortar` could not
// match `^Pestle & Mortar`, so the brand was prepended again (item 284). THAT one
// was fixed in the DATA, correctly -- `&amp;` in a stored name is corrupt. A
// punctuation variant is not: "e. l.f. Cosmetics" is what the supplier calls it.
//
// ── FOLLOWING match-key.ts RATHER THAN INVENTING A SECOND SHAPE ─────────────────
//
// This is not a new problem for the codebase. `supabase/functions/_shared/match-key.ts`
// solved it on the MATCHING side long ago: it strips leading brand repetition and then
// re-prepends the canonical brand, with the whole-brand-repeat case, the multi-word
// partial-brand case, the name-IS-the-brand case and the possessive-stem risk all
// reasoned out in its header. The rule below follows that shape deliberately. Two
// implementations of one idea, diverging quietly, is what item 345 is about.
//
// THE MID-WORD GUARD IS THE PART THAT MATTERS. A brand may legitimately open a longer
// word: "Phyto" + "Phyto Phytophanere Ultra Serum", "o_p_i" + "o_p_i OPIcons". Those
// are product lines, not repeats, and stripping them would be worse than leaving a
// genuine double alone. match-key.ts's judgement applies unchanged: the rule CAN AT
// WORST MISS, and MISSING IS SAFE WHERE OVER-STRIPPING IS NOT.

const ALNUM = /[a-z0-9]/;
const SEPARATOR = /[\s\-:.,]/;

/** The brand reduced to lowercase letters and digits, which is what we compare on. */
function brandAlnum(brand: string): string {
  return brand.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Number of characters of `name` consumed by ONE copy of the brand, or null if the
 * brand does not open the name. Compares alphanumerics only, so any spelling of the
 * separators matches, then eats trailing separators.
 */
function consumeBrandOnce(name: string, bn: string): number | null {
  let i = 0;
  let j = 0;
  while (j < bn.length) {
    if (i >= name.length) return null;
    const c = name[i].toLowerCase();
    if (ALNUM.test(c)) {
      if (c !== bn[j]) return null;
      j += 1;
    }
    i += 1;
  }
  // MID-WORD GUARD: the brand must end at a word boundary. Without this, "Phyto"
  // would be stripped out of "Phytophanere".
  if (i < name.length && ALNUM.test(name[i].toLowerCase())) return null;
  while (i < name.length && SEPARATOR.test(name[i])) i += 1;
  return i;
}

/**
 * Returns the product name with the brand prefix stripped if present, ignoring
 * differences in punctuation and spacing, and consuming EVERY consecutive copy.
 * Returns the original name unchanged if the brand doesn't prefix it.
 */
export function stripBrandPrefix(name: string, brand: string | null | undefined): string {
  if (!name || !brand) return name;
  const bn = brandAlnum(brand);
  if (!bn) return name;

  let cur = name;
  for (;;) {
    const consumed = consumeBrandOnce(cur, bn);
    if (consumed === null) break;
    const rest = cur.slice(consumed).trim();
    // Safety: never return an empty string (e.g. name === brand exactly).
    if (rest.length === 0) break;
    cur = rest;
  }
  return cur;
}

/**
 * Returns the brand-and-name string for display. If the name already
 * carries the brand, the brand isn't repeated; if it doesn't, the brand is
 * prepended once. Always includes the brand (except when no brand is given).
 */
export function displayProductTitle(name: string, brand: string | null | undefined): string {
  if (!brand) return name;
  const clean = stripBrandPrefix(name, brand);
  if (clean !== name) {
    // Name carried the brand and we stripped it: rebuild as "Brand Rest".
    return `${brand} ${clean}`;
  }
  // Strip changed nothing: either the name lacks the brand (prepend it) or
  // the name equals the brand exactly / already starts with it (leave as-is).
  return name.toLowerCase().startsWith(brand.toLowerCase()) ? name : `${brand} ${name}`;
}
