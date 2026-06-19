// ============================================================================
// Beauty Flash (retailer_id 27) product-name truncation repair.
//
// Pattern E: Beauty Flash's AWIN feed truncates product_name at ~64 chars,
// frequently mid-word or on a dangling connective ("… for Brighter &"). A
// truncated name normalises to a short/odd match_key, so the importer can't
// match it to the same product from other retailers (no trigram hit) and
// silently creates a duplicate.
//
// The full, un-truncated name survives in the merchant URL as a slug:
//   https://www.beautyflash.co.uk/<slug>.html
// e.g. "CeraVe Renewing 10% Pure Vitamin C Serum with Ceramides for Brighter &"
//   ← cerave-renewing-10-pure-vitamin-c-serum-with-ceramides-for-brighter-smoother-skin-30ml
//   → "CeraVe Renewing 10% … for Brighter Smoother Skin 30ml"
//
// Reconstruction is CONSERVATIVE by construction. It only rewrites when the
// deslugified URL is a STRICT, LONGER superset whose start matches the existing
// (normalised) name — i.e. the name really is a truncated prefix of the slug.
// If the slug doesn't confirm that, the name is left untouched: a missed
// reconstruction is harmless; a corrupted name is not. (Beauty Flash slugs
// occasionally drop or reorder words on NON-truncated names — those fail the
// prefix/length guard and are correctly left alone.)
//
// Lives in its own side-effect-free module so it's unit-testable
// (scripts/beautyflash-truncation-harness.mts) without importing the edge
// function's Deno.serve entrypoint.
// ============================================================================

export const BEAUTY_FLASH_RETAILER_ID = 27;

// Only consider names at least this long as truncation candidates. Beauty Flash
// cuts at ~64 chars; 60 leaves headroom without flagging ordinary short names.
const MIN_TRUNCATION_LEN = 60;

// Mirrors normaliseForMatch() in index.ts (lowercase, smart-quotes→', strip
// non-alphanumerics to single spaces). Kept local so this module has no
// dependency on the edge-function entrypoint; the prefix test below only needs
// the SAME shape, not byte-identical sharing.
function norm(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Trailing connector/conjunction tokens that never legitimately END a product
// name — their presence at the tail is itself a truncation signal, and they're
// dropped from the kept prefix when stitching the rebuilt name.
const TAIL_CONNECTOR = /^(&|\+|and|with|for|the|to|of|in|on|at|a|an|by|or|from|your|plus)$/i;

// Pull the deslugified product title out of a Beauty Flash merchant URL.
// Takes the last path segment, drops a trailing .html/.htm, turns hyphens into
// spaces. Returns "" if nothing usable.
export function deslugifyFromUrl(rawUrl: string): string {
  if (!rawUrl) return "";
  let s = String(rawUrl).split(/[?#]/)[0].replace(/\/+$/, "");
  const seg = s.substring(s.lastIndexOf("/") + 1);
  if (!seg) return "";
  let decoded = seg;
  try { decoded = decodeURIComponent(seg); } catch { /* leave as-is on bad escapes */ }
  return decoded
    .replace(/\.html?$/i, "")
    .replace(/-+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Title-case a slug token for display. Leaves anything with a digit alone
// (sizes/SPF/shade codes: 30ml, spf50, 16hr) and upper-cases lone letters
// ("c" → "C" in "Vitamin C").
function titleCaseSlugToken(tok: string): string {
  if (!tok) return tok;
  if (/\d/.test(tok)) return tok;
  if (tok.length === 1) return tok.toUpperCase();
  return tok.charAt(0).toUpperCase() + tok.slice(1);
}

/**
 * Reconstruct a (likely) truncated Beauty Flash product name from its merchant
 * URL slug. Returns the original name unchanged when reconstruction isn't
 * confidently warranted.
 *
 * The returned string ALWAYS normalises to the full deslugified slug whenever
 * reconstruction fires — which is the property the matcher depends on
 * (buildMatchKey is computed from this name). Display casing is best-effort:
 * the well-cased original prefix is preserved and the recovered tail is
 * title-cased; if stitching can't reproduce the slug exactly it falls back to a
 * fully title-cased slug (still correct for matching).
 */
export function reconstructBeautyFlashName(name: string, rawMerchantUrl: string): string {
  const original = String(name || "");
  if (original.length < MIN_TRUNCATION_LEN) return original;

  const deslug = deslugifyFromUrl(rawMerchantUrl);
  if (!deslug) return original;

  const normName = norm(original);
  const normDeslug = norm(deslug);

  // Must be a strictly longer superset.
  if (normDeslug.length <= normName.length) return original;

  // The current name must be a (raw-string) prefix of the slug. Raw-string
  // (not token) prefix so a mid-word cut like "… Smoother Sk" still confirms
  // against "… smoother skin". If the full name isn't a prefix, retry after
  // dropping its last (possibly partial) token before giving up.
  let confirmed = normDeslug.startsWith(normName);
  if (!confirmed) {
    const cut = normName.lastIndexOf(" ");
    confirmed = cut > 0 && normDeslug.startsWith(normName.slice(0, cut) + " ");
  }
  if (!confirmed) return original;

  // ── Stitch a display name: kept original prefix + recovered slug tail ──────
  const nameTokens = original.trim().split(/\s+/);
  const slugTokens = deslug.split(/\s+/);

  // Drop trailing dangling connectors ("& ", "for", "with", …).
  while (nameTokens.length && TAIL_CONNECTOR.test(nameTokens[nameTokens.length - 1])) {
    nameTokens.pop();
  }
  // Drop a trailing partial word (its norm is a strict prefix of the slug's
  // corresponding token) — the slug carries the complete token.
  if (nameTokens.length) {
    const li = nameTokens.length - 1;
    const lastNorm = norm(nameTokens[li]);
    const corr = slugTokens[li] ? norm(slugTokens[li]) : "";
    if (lastNorm && corr && lastNorm !== corr && corr.startsWith(lastNorm)) {
      nameTokens.pop();
    }
  }

  const tail = slugTokens.slice(nameTokens.length).map(titleCaseSlugToken);
  const stitched = [...nameTokens, ...tail].join(" ").replace(/\s+/g, " ").trim();

  // Guarantee the result is the full slug (for matching). If stitching drifted,
  // fall back to a fully title-cased slug.
  if (norm(stitched) === normDeslug) return stitched;
  return slugTokens.map(titleCaseSlugToken).join(" ");
}
