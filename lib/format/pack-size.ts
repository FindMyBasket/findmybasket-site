// Display guard for the product-page size chip.
//
// THE DEFECT THIS EXISTS FOR. `extractCanonicalSize`
// (supabase/functions/_shared/match-key.ts) takes the LAST size token in a
// product name and has no notion of a multiplier. For a name of the form
// "N x M<unit>" the last token is the UNIT size, so the stored
// `canonical_size` describes one sachet rather than the box:
//
//     "Vida Glow Natural Marine Collagen 90 x 3g Sachets"  -> canonical_size "3g"   (pack 270g)
//     "simpa Phyto-Caffeine Shampoo ... 50 x 20ml"         -> canonical_size "20ml" (pack 1000ml)
//     "Kerastase Densifique Treatment Homme 30 x 6ml"      -> canonical_size "6ml"  (pack 180ml)
//
// Measured 21 August 2026: 446 live products across every top_category
// (skincare 145, bath_body 94, supplements 64, fragrance 54, makeup 47,
// hair 42) rendered a chip understating the pack, worst case by 90x.
//
// WHY SUPPRESSION IS HONEST HERE, AND NOT HIDING A DEFECT. The product page
// renders `product.name` RAW in the <h1> (app/product/[id]/page.tsx), four
// lines above this chip. For exactly the rows this guard fires on, the pack is
// already stated in full immediately above — "90 x 3g Sachets" is right there
// in the title. Suppressing the chip therefore removes a CONTRADICTION, not a
// fact. That is the whole justification; if the title ever stops showing the
// raw name, this reasoning lapses and the guard needs revisiting.
//
// THIS IS A GUARD, NOT A SECOND DERIVATION. It compares a stored value against
// the name it was derived from and suppresses on disagreement with reality. It
// deliberately does NOT re-implement extractCanonicalSize and does NOT compute
// a pack total, so it cannot drift from the extractor the way a second
// extractor would.
//
// WHAT IT DOES NOT DO. It buys correctness on the page, not in the column.
// `canonical_size` is still wrong in the database and is still unsafe for any
// per-unit arithmetic. It also does not fix 17 live rows that are wrong in
// other ways (e.g. "Made By Mitchell Lip Palette 15X4.5g" storing "5g" against
// a 67.5g pack; "Nicce Body Wash Set 3 x 150ml" storing "440g"). Those need the
// column remedy, not this.

/**
 * Matches an "N x M<unit>" pack pattern anywhere in a raw product name.
 * Case-insensitive; tolerates "30 x 3g", "30X3G", "4x1.5ml".
 * Capture groups: 1 = multiplier, 2 = unit magnitude, 3 = unit.
 */
const PACK_PATTERN = /(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(ml|l|g|kg)\b/i;

/** Normalise a size token for comparison: lowercase, whitespace removed. */
function normaliseSize(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '');
}

/**
 * True when the size chip should be SUPPRESSED because `canonicalSize` holds
 * the per-unit size of an "N x M<unit>" multipack rather than the pack total.
 *
 * THE PRECISE PREDICATE, NOT THE BROAD ONE. Firing on "name contains N x M"
 * alone would also suppress 16 live rows where `canonical_size` is CORRECT.
 * Those are right for a reason: their names state the pack total LAST, and the
 * extractor takes the last match --
 *
 *     "Sun Bum Lip Balm SPF30 3 x 4.25g Set 12.75g"  -> "12.75g"  correct
 *     "Matrix Biolage ScalpSync ... 10 x 6ml"        -> "60ml"    correct
 *     "Organix Banana Puffcorn 40G (4X10G)"          -> "40g"     correct
 *
 * Same extractor, right answer, purely because of token order. Requiring the
 * chip to EQUAL the unit size keeps all sixteen and still suppresses all 446
 * wrong ones.
 */
export function isUnitSizeOfMultipack(
  name: string | null | undefined,
  canonicalSize: string | null | undefined,
): boolean {
  if (!name || !canonicalSize) return false;
  const chip = normaliseSize(canonicalSize);
  if (!chip) return false;

  const m = PACK_PATTERN.exec(name);
  if (!m) return false;

  // A multiplier of 1 means unit and pack are the same quantity, so the chip is
  // not understating anything. Suppressing it would remove a correct value.
  if (Number(m[1]) === 1) return false;

  return chip === normaliseSize(`${m[2]}${m[3]}`);
}

/**
 * The size chip to render, or null to render nothing.
 * Returns the stored value unchanged in every case the guard does not fire.
 */
export function displaySizeChip(
  name: string | null | undefined,
  canonicalSize: string | null | undefined,
): string | null {
  const value = canonicalSize?.trim();
  if (!value) return null;
  return isUnitSizeOfMultipack(name, value) ? null : value;
}
