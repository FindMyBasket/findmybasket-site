// ============================================================================
// Debenhams (retailer_id 28) product-name hygiene.
//
// Debenhams' AWIN feed appends structured attribute metadata onto product_name:
//   "{base name} in {colour_or_shade} | Size: {size}"
// and also injects gender possessive/plural tags into the base name:
//   "Give Me Men's Mens Body Wash ..." (sometimes doubled).
//
// Left untouched, every colour and size spawns a distinct product row (match_key
// is derived from name) and the gender tags pollute both display and match_key.
// This module rebuilds a clean base name and routes the attribute values to their
// proper columns:
//   - "| Size: {value}"  -> returned as sizeClause (caller feeds canonical_size)
//   - " in {value}"       -> products.shade when the base is a shade-bearing
//                            makeup product; dropped when it is a packaging colour
//                            or placeholder; otherwise LEFT IN PLACE (conservative)
//   - gender tags         -> stripped
//
// Deliberately conservative. The " in {value}" attribute in this feed always sits
// directly before "| Size:", so after the size clause is removed it is the trailing
// " in ...". But base names legitimately contain " in " ("4 in 1 Trolley",
// "Lock in Moisture") and shade fields carry marketing copy ("Blurs Lips in 1
// Swipe, 3D Cushion Effect, with Squalane"), so the value is only stripped when it
// looks like a real attribute (no comma, <=5 words, <=35 chars) AND is either a
// known packaging/placeholder colour (dropped) or the base name is shade-bearing
// makeup (routed to shade). Anything else is left in the name so a legitimate
// " in " is never corrupted.
//
// Lives in its own side-effect-free module so it is unit-testable
// (scripts/debenhams-name-hygiene-harness.mts) without importing the edge
// function's Deno.serve entrypoint.
// ============================================================================

export const DEBENHAMS_RETAILER_ID = 28;

// Colour/finish values in the " in {value}" attribute that describe packaging or
// are placeholders, not a cosmetic shade. Dropped from the name, never routed to
// products.shade. Kept tight: real foundation/powder shades like "medium", "dark",
// "light", "natural", "translucent" are intentionally NOT here.
const PACKAGING_VARIANT_DENYLIST = new Set([
  "misc", "clear", "white", "black", "blue", "pink", "green", "silver",
  "amber", "nude", "grooming", "mens grooming", "none", "na", "n/a",
  "not applicable", "colorless", "colourless", "all", "assorted",
]);

// The base name is a shade-bearing makeup product. When it matches, a non-packaging
// " in {value}" attribute is treated as a shade. Mirrors the shade-bearing product
// types in the fix spec (Foundation, Lipstick, Lip*, Eyeshadow, Nail, Concealer,
// Blush, Highlighter, Bronzer, Mascara, Eyeliner, Lip Liner, Lip Gloss, ...).
const SHADE_BEARING_RE =
  /\b(lipstick|lip gloss|lip liner|lip balm|lip cream|lip tint|lip oil|lip stain|lip perfector|liquid lip|lip idole|lip colou?r|lip|foundation|concealer|skincealer|mascara|eye ?liner|eye ?shadow|eye ?pencil|eye ?colou?r|blush|bronzer|highlighter|contour|nail (?:polish|varnish|lacquer|colou?r)|bb cream|cc cream|tinted moisturiser|pressed powder|setting powder|loose powder|compact powder|brow)\b/i;

// Gender possessive/plural tags ("Men's", "Women's", "Mens", "Womens"), including
// the doubled "Men's Mens" case. Anchored on word boundaries so "Menswear" /
// "Womenswear" / "Regimens" are untouched, and "for Men" / "for Women" (no
// possessive) are left intact.
const GENDER_TAG_RE = /\b(?:Men|Women)['’]?s\b/gi;

export interface DebenhamsNameHygiene {
  name: string;               // cleaned display name
  sizeClause: string | null;  // raw text after "| Size:" (caller derives canonical_size)
  shade: string | null;       // shade routed from the " in {value}" attribute, if any
  changed: boolean;           // true if the cleaned name differs from the input
}

export function cleanDebenhamsName(rawName: string): DebenhamsNameHygiene {
  const input = String(rawName || "");
  let n = input;
  let sizeClause: string | null = null;
  let shade: string | null = null;

  // 1. Capture + strip the trailing "| Size: {value}" attribute clause.
  const sizeM = n.match(/\s*\|\s*Size:\s*(.+?)\s*$/i);
  if (sizeM) {
    sizeClause = sizeM[1].trim();
    n = n.slice(0, sizeM.index).replace(/\s+$/, "");
  }

  // 2. Capture + route the appended " in {value}" colour/shade attribute. After
  //    step 1 it is the trailing " in ...". The [^|]{1,35} + $ anchor means a
  //    value longer than 35 chars (marketing copy) fails to match from that " in "
  //    and the engine backtracks to a later " in " (so a real short shade after a
  //    long marketing clause is still recovered). Guards below stop us stripping a
  //    legitimate " in " out of a base name.
  const varM = n.match(/\sin\s+([^|]{1,35})\s*$/i);
  if (varM) {
    const value = varM[1].trim();
    const base = n.slice(0, varM.index).replace(/\s+$/, "");
    const wordCount = value.split(/\s+/).length;
    const looksLikeAttribute =
      value.length >= 1 &&
      !value.includes(",") &&      // rejects marketing copy ("... in 1 Swipe, 3D ...")
      wordCount <= 5 &&
      /[a-z]/i.test(value);
    if (looksLikeAttribute && base) {
      if (PACKAGING_VARIANT_DENYLIST.has(value.toLowerCase())) {
        n = base;                  // packaging/placeholder colour -> drop
      } else if (SHADE_BEARING_RE.test(base)) {
        shade = value;             // real shade on a makeup product -> route to products.shade
        n = base;
      }
      // else: non-packaging value on a non-makeup base -> leave " in {value}" in
      // the name (never corrupt a legitimate " in ", e.g. "4 in 1 Trolley").
    }
  }

  // 3. Strip gender possessive/plural tags (handles the doubled "Men's Mens" case).
  n = n.replace(GENDER_TAG_RE, " ");

  // 4. Collapse whitespace.
  n = n.replace(/\s{2,}/g, " ").trim();

  return { name: n, sizeClause, shade, changed: n !== input };
}
