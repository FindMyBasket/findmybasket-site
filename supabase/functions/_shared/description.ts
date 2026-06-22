// Shared product-description handling: feed-text normalisation + retailer
// priority for "best available description wins" logic.
//
// Used by both importers (import-awin-feed, import-rakuten-feed) so all feeds
// clean and prioritise descriptions identically. The retailer priority table
// below is mirrored by the SQL function fmb_description_priority() in
// migration 20260622120000_product_descriptions.sql — KEEP THE TWO IN SYNC.
// The atomic compare-and-set on apply happens in SQL (only SQL sees the current
// stored row); this TS copy documents the ordering and is what the harness
// (scripts/description-priority-harness.mts) tests.

import { stripHtml } from "./strip-html.ts";

// Lowered 4000 -> 2000 (#36): cuts peak memory on the inline import path where
// description text is held alongside the full cross-retailer index. Small SEO
// trade-off; 2000 chars is still well beyond what meta/JSON-LD surface.
export const DESCRIPTION_MAX_CHARS = 2000;

// Lower number = higher priority. Boots / Beauty Flash have editorial UK-English
// copy; Stylevana / YesStyle are machine-translated and awkward. Retailer ids
// are the live retailers.id values (confirmed against the DB), NOT the brief's
// parenthetical ids (the brief mislabelled Escentual as 11 — 11 is Stylevana).
export const DESCRIPTION_PRIORITY: Record<number, number> = {
  23: 1, // Boots
  27: 2, // Beauty Flash
  8: 3, // Escentual
  24: 4, // The Organic Pharmacy
  12: 5, // Superdrug
  11: 6, // Stylevana
  25: 7, // YesStyle
  6: 8, // Branded Beauty
};

const DEFAULT_PRIORITY = 9; // all other retailers

/** Priority rank for a retailer id (lower = higher priority). */
export function descriptionPriority(retailerId: number | null | undefined): number {
  if (retailerId == null) return DEFAULT_PRIORITY;
  return DESCRIPTION_PRIORITY[retailerId] ?? DEFAULT_PRIORITY;
}

/**
 * Clean a raw feed description into storable plain text, or null if unusable.
 * - strips HTML + decodes entities (see stripHtml)
 * - empty / whitespace-only → null
 * - identical to the product name (some feeds send the name as description) → null
 * - capped at DESCRIPTION_MAX_CHARS
 */
export function normaliseDescription(
  raw: string | null | undefined,
  productName: string | null | undefined,
): string | null {
  const cleaned = stripHtml(raw);
  if (!cleaned) return null;
  if (productName && cleaned.toLowerCase() === productName.trim().toLowerCase()) {
    return null;
  }
  return cleaned.length > DESCRIPTION_MAX_CHARS
    ? cleaned.slice(0, DESCRIPTION_MAX_CHARS)
    : cleaned;
}

/**
 * Pick the best of a long and short feed description. Prefer the long form
 * unless it exceeds the cap, in which case fall back to the (shorter) short
 * form if usable; otherwise the long form is truncated by normaliseDescription.
 * Returns cleaned plain text or null.
 */
export function pickDescription(
  rawLong: string | null | undefined,
  rawShort: string | null | undefined,
  productName: string | null | undefined,
): string | null {
  const long = stripHtml(rawLong);
  if (long && long.length <= DESCRIPTION_MAX_CHARS) {
    return normaliseDescription(long, productName);
  }
  if (long && long.length > DESCRIPTION_MAX_CHARS) {
    const short = normaliseDescription(rawShort, productName);
    if (short) return short;
  }
  // No usable long form: try short, else (truncated) long.
  return normaliseDescription(rawShort, productName) ?? normaliseDescription(long, productName);
}

/**
 * Decide whether an incoming description should overwrite the current one.
 * Set when there is no current description, or when the incoming source has
 * equal-or-higher priority (lower rank). Pure mirror of the SQL apply guard;
 * exercised directly by the harness.
 */
export function resolveDescription(
  current: { description: string | null; retailerId: number | null },
  incoming: { description: string | null; retailerId: number | null },
): string | null {
  if (!incoming.description) return current.description; // nothing to set
  if (!current.description) return incoming.description; // fill empty
  return descriptionPriority(incoming.retailerId) <= descriptionPriority(current.retailerId)
    ? incoming.description
    : current.description;
}
