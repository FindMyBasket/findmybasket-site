// Extracted from import-awin-feed/index.ts on 3 Aug 2026 so the validator is
// testable. Convention 2: a rule whose success path has never run is not known to
// work, and this one decides whether 6,228 working barcodes survive.

/**
 * Barcode validation for the sibling-coalesce path.
 *
 * ACCEPTS UPC-A (12 DIGITS) AS WELL AS EAN-13. THIS IS THE WHOLE POINT.
 *
 * A naive "EAN-13 only" validator, which is what "EAN checksum validation" naturally
 * suggests, would have REJECTED 6,228 barcodes that work correctly today: 2,629 on
 * Debenhams and 3,068 on Beauty Bay, both of which supply UPC-A. It would have looked
 * like a safeguard, reported a clean pass, and destroyed more than it protected.
 * Measured 3 Aug 2026 before this was written. See migrations/README.md convention 15.
 *
 * A UPC-A left-padded with a zero IS the equivalent EAN-13 and its checksum still
 * validates, so normalising to 13 digits is lossless and makes cross-retailer matching
 * work between a UPC-A retailer and an EAN-13 one.
 *
 * Returns null for anything that does not validate. Null is REJECTION, and the caller
 * counts it: a feed whose barcodes start failing is a finding about that feed, not a
 * silent quality drift.
 */
export function validateBarcode(raw: string): { value: string | null; reason: string | null } {
  const digits = (raw || "").replace(/[^0-9]/g, "");
  if (!digits) return { value: null, reason: null };            // absent, not invalid
  if (digits.length !== 12 && digits.length !== 13) {
    return { value: null, reason: `length_${digits.length}` };
  }
  // UPC-A -> EAN-13 is a zero left-pad. Lossless, and the check digit is unchanged.
  const ean13 = digits.length === 12 ? "0" + digits : digits;
  if (/^0+$/.test(ean13)) return { value: null, reason: "all_zero" };

  // EAN-13: positions 1..12 weighted 1,3,1,3..., check digit makes the total a
  // multiple of 10.
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(ean13[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const expected = (10 - (sum % 10)) % 10;
  if (expected !== Number(ean13[12])) return { value: null, reason: "checksum" };
  return { value: ean13, reason: null };
}

/**
 * Prefer the column we already read; fall back to its sibling only when the primary is
 * empty. ORDERING IS DELIBERATE: retailers whose primary is populated are byte
 * identical after this change, so the four working feeds (YesStyle, Debenhams,
 * Perfume Click, Beauty Bay) cannot move. Re-sourcing data for retailers that already
 * work is change for no gain, and change for no gain on the import path is risk.
 */
export function coalesceField(fields: string[], primaryIdx: number, altIdx: number): { value: string; usedAlt: boolean } {
  const primary = primaryIdx >= 0 ? (fields[primaryIdx] || "").trim() : "";
  if (primary) return { value: primary, usedAlt: false };
  const alt = altIdx >= 0 ? (fields[altIdx] || "").trim() : "";
  return { value: alt, usedAlt: alt !== "" };
}

