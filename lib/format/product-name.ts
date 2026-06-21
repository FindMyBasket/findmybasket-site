// Helpers for de-duplicating the brand prefix that most product names already
// carry. Roughly 90% of catalogue names start with their own brand string
// (e.g. name "Kiehl's Calendula Cleanser" + brand "Kiehl's"), so naively
// prepending the brand again produces "Kiehl's Kiehl's Calendula Cleanser".
// These helpers strip the redundant prefix for display, titles and meta.

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the product name with the brand prefix stripped if present.
 * Case-insensitive match. Tolerates trailing space, hyphen, dash, or colon
 * after the brand string. Returns the original name unchanged if the brand
 * doesn't prefix it.
 */
export function stripBrandPrefix(name: string, brand: string | null | undefined): string {
  if (!name || !brand) return name;
  const pattern = new RegExp('^' + escapeRegExp(brand) + '[\\s\\-:]*', 'i');
  const stripped = name.replace(pattern, '').trim();
  // Safety: never return an empty string (e.g. name === brand exactly).
  return stripped.length > 0 ? stripped : name;
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
