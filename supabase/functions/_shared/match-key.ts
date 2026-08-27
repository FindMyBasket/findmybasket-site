// ============================================================================
// SHARED product match-key normalisation — the single source of truth for
// buildMatchKey() and the family of name-normalisation helpers, imported by all
// three importers (import-awin-feed, import-rakuten-feed, import-shopify-feed)
// AND by the catalogue-wide dedup backfill (scripts/dedup-preview.mts).
//
// History: this logic was previously COPY-PASTED into each importer, which
// caused drift (the container-noun / promo-tag fixes landed in awin first and
// lagged in the Rakuten/Shopify copies). Following the PR #18 categorisation
// precedent, the newest (awin) version is extracted here and the copies deleted,
// so every future match-key change lands everywhere at once — and because the
// dedup backfill imports the SAME module, the backfill and the importer agree
// by construction.
//
// PARITY: buildMatchKey() here is kept byte-identical to the SQL function
// fmb_build_match_key() in
//   supabase/migrations/20260703120000_match_key_deal_paren.sql
// so a freshly-imported row and a SQL-backfilled row produce the same
// products.match_key. Any change to buildMatchKey MUST be mirrored in that
// migration (and vice-versa).
//
// Validated by scripts/match-key-harness.mts, which imports THIS module and
// carries a regression test for every false-positive class learned from real
// catalogue data (pack counts, hidden sizes, shades, fragrance concentration,
// versions, sets, truncation).
// ============================================================================

// ─── Core normalisation ─────────────────────────────────────────────────────

// ─── Character folding, applied BEFORE the alphanumeric strip ────────────────
//
// WHY THIS EXISTS. `[^a-z0-9]+ -> " "` DELETES every character outside a-z0-9
// rather than folding it, so until 26 Aug 2026:
//
//     "Avène Thermal Water"  ->  "av ne thermal water"
//     "Avene Thermal Water"  ->  "avene thermal water"
//
// Two spellings of ONE product produced two keys and could not match. That is not
// cosmetic: matching is what the site does, so the same product from two retailers
// was two products with two prices and no comparison between them.
//
// The ampersand is the same defect wearing a different character. `&` is outside
// a-z0-9 so it was deleted, while the word "and" survived:
//
//     "Boots Nail & Cuticle Oil"    ->  "boots nail cuticle oil"
//     "Boots Nail And Cuticle Oil"  ->  "boots nail and cuticle oil"
//
// Two live Boots products, the dead twin outranking the live one on 281
// impressions. Work-list item 294.
//
// THIRD INSTANCE OF THIS CHARACTER CLASS IN TWO DAYS, after stripBrandPrefix
// (item 355) and brandSlug (item 361), and the first that costs comparisons
// rather than titles or URLs.
//
// `&` -> " and " RATHER THAN STRIPPING THE WORD "and". Both merge item 294's pair.
// Mapping was modelled and measured; stripping was not, and is more aggressive.
// Choosing the unmeasured option because it might do more is the shape this
// codebase keeps recording. Item 371.
//
// MIRRORED IN SQL as fmb_fold_for_match(). Any change here changes there.
const FOLD_FROM = "àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸšŠžŽøØåÅßñÑ";
const FOLD_TO   = "aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYYsSzZoOaAsnN";

export function foldForMatch(s: string): string {
  let out = "";
  for (const ch of String(s || "")) {
    const i = FOLD_FROM.indexOf(ch);
    out += i === -1 ? ch : FOLD_TO[i];
  }
  return out.replace(/&/g, " and ");
}

// Normalised name for fuzzy matching (lowercase, alphanumeric only, single
// spaces). Curly quotes are folded to a straight apostrophe first so "L'Oréal"
// and "L’Oréal" collapse identically before the non-alphanumeric strip, and
// foldForMatch then folds accents and the ampersand so they SURVIVE that strip
// as letters instead of being deleted by it.
export function normaliseForMatch(s: string): string {
  return foldForMatch(String(s || ""))
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Flash-sale promo tags YesStyle/Stylevana prepend, e.g. "[Deal]", "[DEAL]Kose",
// "[Sale]", and the parenthesised "(Deal)" / "(Sale)" variants seen on ~30 live
// rows. Removed before normalisation so two retailers' rows for the same product
// produce the same key. Only the explicit bracketed/parenthesised form is
// stripped, so an unbracketed word ("new", "gift set") is left intact.
// Either bracket style is accepted on each side ([deal), (deal] etc.) — harmless
// and keeps the pattern simple.
export const PROMO_TAG_RE =
  /[\[(]\s*(?:deal|sale|new|hot|clearance|limited|gift|exclusive)\s*[\])]/gi;
export function stripPromoTags(raw: string): string {
  return String(raw || "").replace(PROMO_TAG_RE, " ");
}

// Packaging/container nouns appended to a name ("Cream Tube 100g", "Jar 60ml",
// "Bottle 30ml", "Cleanser Pump"). They describe the vessel, not the product, so
// a retailer that omits them must still match. Deliberately NOT pack/set: in this
// catalogue "Pack" is usually a product type (Sleeping Pack, Wash-Off Pack) and
// "Set" a bundle (8pcs Set), so stripping them would cause false merges.
export const CONTAINER_NOUN_RE = /\b(?:tube|bottle|jar|pump)\b/g;
export function stripContainerNouns(normalised: string): string {
  return normalised.replace(CONTAINER_NOUN_RE, " ").replace(/\s+/g, " ").trim();
}

// Count-unit / pluralisation normalisation. A product split ONLY by the count
// unit-word on the SAME number ("70pcs" vs "70 pads" vs "70 Pieces" vs "70S") is
// one product; without this each unit spelling makes a different key. We canonise
// the unit WORD when it is attached to a number, and singularise the standalone
// nouns pad(s)/patch(es)/piece(s)/sheet(s).
//
// SAFETY — the number is NEVER touched, only the unit word attached to it. So
// "70 pads" and "70 pcs" collapse, but "70 pads" and "30 pads" stay distinct
// (different number → different key). This cannot weaken the number-distinctness
// guard: extractNameNumbers() reads the RAW name and is unaffected, and the number
// remains in the key, so different counts never share a key. Runs on the already-
// normalised (lowercased, single-spaced) string.
//   COUNT_UNIT_RE: <number><opt space><unit-word>  ->  <number>pcs
//   PLURAL_NOUN_RE: standalone pads/patches/pieces/sheets -> singular
// "ea" and bare "s" (the "40S" wax-strip / "18S" patch style) are included as unit
// words; longer alternatives precede shorter so "pieces" wins over "piece".
// ── KNOWN FALSE POSITIVE: BARE "s" AFTER DIGITS IS NOT ALWAYS A PACK COUNT ─────
// The bare `s` alternative below exists for the "40S" wax-strip / "18S" patch style
// and it earns its place. But it also fires on a DECADE or shade token:
//
//     "Sweed Le Lipstick-90's Model"  ->  key "sweed le lipstick 90pcs model"
//
// Ninety pieces, from a shade name. Product 105424 is the live instance and is
// DELIBERATELY LEFT carrying an undecoded `&#039;` entity. See
// standing_check_findings, finding_key 'held:105424:entity-shields-count-unit',
// and work-list item 237.
//
// ── CORRECTED 26 AUGUST 2026. THE CLAIM BELOW THIS LINE USED TO BE FALSE. ──────
//
// This comment previously said the entity shields the row because `90&#039;s`
// normalises to `90 039 s`, "which does not match". IT MATCHES, AND ALWAYS DID:
//
//     normaliseCountUnits("90 039 s")  ->  "90 039pcs"
//
// `039` followed by a space and a bare `s` is exactly what the alternative below
// catches. THE ENTITY NEVER SHIELDED THE RULE -- it shielded the STORED KEY, which
// predates the rule reaching this row and was never recomputed. Verified by running
// the function rather than by reading it. Work-list items 375 and 379.
//
// SO THE HOLD IS REAL AND ITS STATED MECHANISM WAS WRONG. The row is miskeyed by
// today's rule with no decoding involved, and the 26 Aug re-key skipped it
// deliberately (item 376) rather than writing `90 and 039pcs`.
//
// AND DO NOT "FIX" THIS REGEX ON THAT ROW'S ACCOUNT. Measured 26 Aug 2026 across
// 99,973 products:
//     4,418 keys carry a pcs token
//     3,989 of them fired on an EXPLICIT unit word
//       429 fired on this bare `s` alternative -- of which 348 have a countable
//           noun in the name and are genuine: 60S capsules, 30S tablets, 20S wax
//           strips, 24S patches. `NNs` is standard UK pack notation.
//   roughly 13 rows are true false positives, and they are HETEROGENEOUS: Armani
//           shade codes (42S, 68S), Braun model numbers (3010S), decades (90'S),
//           product-line names (Hyaluron 6s, Booster 2000s).
//
// A shade code and a pack count ARE THE SAME STRING. Only the surrounding noun
// separates them, so any narrowing of this pattern that catches the 13 breaks some
// of the 348. That makes a correct fix a CONTEXT rule, not a pattern edit -- and
// 13 against 4,400 does not justify one. Measured and declined, item 379.
export const COUNT_UNIT_RE =
  /\b(\d+(?:\.\d+)?)\s*(?:pcs|pc|pieces|piece|pads|pad|patches|patch|sheets|sheet|ea|s)\b/g;
export const PLURAL_NOUN_RE = /\b(pad|patch|piece|sheet)(?:e?s)\b/g;
export function normaliseCountUnits(normalised: string): string {
  return String(normalised || "")
    .replace(COUNT_UNIT_RE, "$1pcs")
    .replace(PLURAL_NOUN_RE, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// Strip leading brand-name REPETITION from an already-normalised product name,
// so that once buildMatchKey re-prepends the canonical brand the key is not
// doubled. Two real shapes, both learned from live K-beauty data:
//
//   (1) whole-brand repeats — the name restates the FULL brand, sometimes twice:
//         "goodal goodal green tangerine …"            (brand "goodal")
//         "dr althea dr althea 147 barrier cream …"    (brand "dr althea")
//       Every consecutive copy of the full brand token-sequence is consumed.
//
//   (2) partial-brand prefix on a MULTI-WORD brand — the name carries only the
//       brand's leading word(s), the rest of the brand is absent:
//         name "purito oat in calming gel cream …"     (brand "purito seoul")
//       Without this the key becomes "purito seoul purito oat in …" and never
//       matches the sibling row named "Purito SEOUL - Oat In …" which keys to
//       "purito seoul oat in …". The leading run that equals a PROPER prefix of
//       the brand is stripped.
//
// GUARDS (all FP-prone, all covered by the harness):
//   (a) NEVER strip to empty. ~20 Douvall's rows are literally named "Douvall's";
//       their whole name IS the brand, so stripping would collapse them — instead
//       the original name is kept (key stays "douvall s").
//   (b) shape (2) fires ONLY when the FULL brand is absent from the front. A
//       product line that legitimately reuses a brand word AFTER the full brand
//       ("Bondi Sands Bondi Babe …") is safe: shape (1) consumes the one real
//       brand copy and the second "bondi" is left as product text, so the key is
//       unchanged and two different products never collapse.
// Shape (2) can at worst MISS a merge (false negative) if a brand's first word is
// also a common possessive stem ("Charlotte's" under brand "Charlotte Tilbury");
// it does not manufacture false merges, because the full canonical brand is always
// re-prepended, so a corrupted stem simply keys to its own bucket.
export function stripLeadingBrandRepetition(normName: string, normBrand: string): string {
  if (!normBrand || !normName) return normName;
  const brandTokens = normBrand.split(" ");
  const nameTokens = normName.split(" ");
  const n = brandTokens.length;
  const brandMatchesAt = (pos: number): boolean => {
    if (pos + n > nameTokens.length) return false;
    for (let j = 0; j < n; j++) if (nameTokens[pos + j] !== brandTokens[j]) return false;
    return true;
  };
  let i = 0;
  while (brandMatchesAt(i)) i += n;          // (1) consume consecutive full-brand copies
  if (i === 0 && n >= 2) {                    // (2) full brand absent → allow one proper-prefix strip
    let k = 0;
    while (k < n && k < nameTokens.length && nameTokens[k] === brandTokens[k]) k++;
    if (k >= 1 && k < n) i = k;               // proper prefix only (k===n is impossible here)
  }
  if (i === 0) return normName;
  const remaining = nameTokens.slice(i).join(" ");
  return remaining === "" ? normName : remaining;   // guard (a): never strip to empty
}

// Build a match key from brand + name, deduplicating when name repeats the brand.
// Handles retailers that put the brand in both the brand field AND at the start of
// the name field (Stylevana and others), while other retailers only put it in the
// brand field. Without this, the matcher creates duplicate products because match
// keys differ:
//   Retailer A: "mixsoon mixsoon bifida ferment essence 100ml"  (brand in name)
//   Retailer B: "mixsoon bifida ferment essence 100ml"          (brand not in name)
// The name is run through stripPromoTags + stripContainerNouns first so promo
// prefixes and packaging nouns do not split otherwise-identical products, then
// through stripLeadingBrandRepetition so a doubled / partial brand token in the
// name (Goodal, Dr. Althea, Purito Seoul) does not split it either.
//
// IMPORTANT: sizes, pack counts, shade tokens, fragrance-concentration words and
// version markers are deliberately KEPT in the key. Two products that differ by
// any of those are genuinely different SKUs, and leaving the distinguishing text
// in the key is what keeps them from collapsing. Do not add a "strip size" step
// here — stripSize() exists only for the fuzzy Tier-4 candidate lookup, never for
// the stored key.
export function buildMatchKey(brand: string, name: string): string {
  const normBrand = normaliseForMatch(brand);
  const normNameRaw = normaliseCountUnits(stripContainerNouns(normaliseForMatch(stripPromoTags(name))));
  const normName = stripLeadingBrandRepetition(normNameRaw, normBrand);
  if (!normBrand) return normName;
  if (normName === normBrand) return normBrand;             // name IS the brand (rare)
  if (normName.startsWith(normBrand + " ")) return normName; // brand already at start; don't prepend
  return `${normBrand} ${normName}`.trim();
}

// ─── EAN / MPN ──────────────────────────────────────────────────────────────

// Normalise EAN/GTIN/UPC for matching: strip non-digits, strip leading zeros.
// Same logic as the SQL generated column ean_normalised on retailer_prices.
// Returns null if the result is shorter than 8 digits (rejects junk codes like
// Superdrug's internal "00000001164169" which strips to "1164169").
export function normaliseEan(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digitsOnly = String(raw).replace(/[^0-9]/g, "");
  const stripped = digitsOnly.replace(/^0+/, "");
  // OFF BY ONE FOR EAN-8, KNOWN AND DELIBERATE. Measured 5 Aug 2026.
  //
  // EAN-8 is the shortest legitimate barcode format, and a great many EAN-8 values
  // begin with a zero. Stripping leading zeros takes those to 7 digits, so this floor
  // rejects them and the row keeps its `ean` while matching on nothing.
  //
  // Catalogue-wide that is 48 rows on active retailers, 0.085% of 56,584 barcodes, of
  // which about a dozen are genuine EAN-8 (Debenhams) and the rest are merchant SKUs
  // in the EAN field or all-zero placeholders — both correctly rejected upstream by
  // validateBarcode in _shared/barcode.ts. NOT worth changing at that volume.
  //
  // It recurs on any feed carrying EAN-8, so it is written down here rather than
  // re-derived from scratch. Lowering the floor to 7 would admit EAN-8 and also admit
  // more short junk, which is why it has not been done rather than been overlooked.
  if (stripped.length < 8) return null;
  return stripped;
}

// Normalise MPN: trim + uppercase. Same logic as the SQL generated column.
export function normaliseMpn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

// ─── Size / count extraction ────────────────────────────────────────────────

// Strip trailing size/count tokens like "100ml", "30 ml", "x 24", "24pcs" so
// "cosrx pimple patch 24pcs" and "cosrx pimple patch" share a fuzzy base key.
// Used ONLY to build the Tier-4 candidate lookup; the match is then re-verified
// by extractSize() AND extractNameNumbers() so different sizes/counts never merge.
export function stripSize(normalised: string): string {
  return normalised
    .replace(/\b\d+\s*(ml|g|kg|oz|pcs|pc|ea|pack|count|ct|sheets?)\b.*$/g, "")
    .replace(/\bx\s*\d+\s*$/g, "")
    .trim();
}

// Extract a canonical size string ("50ml", "30g", "1.5oz", "1l") from a raw
// product name. Returns null if no confident size found. Used to populate the
// canonical_size column on new product rows.
//
// Differs from extractSize(): operates on the raw name (precision-preserving,
// decimals intact) and is conservative — requires a clear unit suffix to avoid
// false positives like shade numbers, SPF values, model numbers. Litre ("1L",
// "1.5 litre") is recognised so "1L" does not silently become a null size and
// collide with a smaller ml pack.
// Multiplied pack totals can land on binary-float noise (2.4 * 3 = 7.199999...).
// Round to three decimals and strip trailing zeros, so "3 x 2.4g" is "7.2g" and an
// integer result is "188g" rather than "188.000g". Item 252's 0.0012oz row is the
// reason this rounds rather than truncates.
function trimNum(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

export function extractCanonicalSize(rawName: string): string | null {
  if (!rawName) return null;
  const s = String(rawName);

  // ── MULTIPLIER FORMS FIRST: THE PACK, NOT THE SACHET ────────────────────────
  //
  // Without this, the loop below takes the LAST size token in the name, which for
  // a multipack is the UNIT size. "Vida Glow ... 90 x 3g Sachets" stored "3g"
  // against a 270g pack; "THE Electro | Electrolyte Sachets - 20 x 9.4g" stored
  // "9.4g" against 188g.
  //
  // ITEM 252 BACKFILLED THIS COLUMN TO ZERO ON 23 AUGUST AND THIS FUNCTION WAS
  // NEVER CHANGED, so the importer refilled it: 654 -> 0 -> 192, with 40 of those
  // created in the three days after the backfill. A one-time correction of a
  // column whose writer still produces the defect is a symptom cleared, and the
  // rate of return is the measure of that. Item 435.
  //
  // MEASURED BEFORE SHIPPING (item 439). This moves 1,357 stored rows -- far more than
  // the 192 the DQ metric flags -- and the split that justified it is not the 95.3%
  // that are simple multipacks. It is that NOT ONE ROW moves a correct old value to a
  // wrong new one: the old value was always a component size and never a pack total, so
  // this can only fix a row or swap one wrong subtotal for another.
  //
  // KNOWN RESIDUE, DELIBERATELY NOT ADDRESSED HERE. ~46 rows are mixed bundles --
  // "1 x 9ml 1 x 100ml" -- where no single canonical size is correct and the honest
  // value is null. Both the old answer and this one assert a size that does not exist.
  // Returning null there is a decision about WHEN A PACK HAS A SIZE rather than how to
  // compute one, and it is held for its own decision (item 439).
  //
  // The pattern is the one already proven in lib/format/pack-size.ts, whose header
  // named this exact boundary five days before the work that needed it arrived:
  // "it buys correctness on the page, not in the column ... canonical_size is
  // still wrong in the database and is still unsafe for any per-unit arithmetic."
  //
  // BOTH ORDERINGS. "20 x 9.4g" and "5g x 30" are the same pack written two ways;
  // the second appears in Cadence's carton names and was outside item 252's scope.
  const PACK_FORWARD = /(\d+)\s*[x\u00d7]\s*(\d+(?:\.\d+)?)\s*(ml|l|g|kg)\b/i;   // "20 x 9.4g"

  // "3.4g x 30", and CRITICALLY "3.4g x 30servings".
  //
  // THE ORIGINAL ENDED `[x]\s*(\d+)\b` AND THAT WAS A BUG. In "30servings" the digit
  // and the letter are both word characters, so the word boundary `\b` asserts cannot
  // exist between them -- the match failed and the row fell through to the last-token
  // rule, storing the sachet size. "3.4g x 30" worked; "3.4g x 30servings" did not.
  //
  // The single harness case for this form was "Carton (5g x 30)", where the closing
  // bracket supplies the boundary. THE TEST WAS WRITTEN FROM THE EXAMPLE THAT MOTIVATED
  // THE PATTERN and inherited its assumption that a count is terminated by something
  // non-word, so the test and the pattern shared one blind spot. Item 447.
  //
  // `(?!\d)` instead: stop at the end of the number, whatever follows it.
  const PACK_REVERSE = /(\d+(?:\.\d+)?)\s*(ml|l|g|kg)\s*[x\u00d7*]\s*(\d+)(?!\d)/i;

  // ── "SERVING" IS NOT A CONTAINER AND MUST NOT MULTIPLY ──────────────────────────
  //
  // A SACHET is a physical unit with a weight, so "3.9g - 15 Sachets" is 15 things of
  // 3.9g and multiplies to 58.5g. A SERVING is a PORTION OF the pack, so
  // "500g - 87servings" is one 500g tub divided 87 ways -- multiplying gives 43,500g,
  // which is what the first draft of this produced. "2.5KG - 70servings" gave 175kg.
  //
  // Measured before writing (item 449): including `serving` in these noun lists moved
  // 46 rows and 40 of them were catastrophically wrong, all MyProtein tubs whose names
  // state their serving count. The separator form is therefore restricted to nouns that
  // name a THING, and `serving` is deliberately absent.
  //
  // The "3.4g x 30servings" case does not need it: an explicit multiplication sign is
  // already unambiguous, so PACK_REVERSE handles that row via (?!\d) above.
  const PACK_NOUN = "sachet|stick|pod|pouch|tube|bottle|vial|ampoule|pack";

  // "3.9g - 15 Sachets", "4.5g, 20 sachets"
  const PACK_SIZE_THEN_COUNT =
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(ml|l|g|kg)\\s*[-,\\u2013]\\s*(\\d+)\\s*(?:x\\s*)?(?:${PACK_NOUN})`, "i");

  // "7 Sachets, 2g"
  //
  // THE COUNT MUST NOT BE THE TAIL OF A WORD. Without the lookbehind, "B5 Ampoule 50ml"
  // reads the 5 of the vitamin name B5 as a count and returns 250ml. Same class as the
  // recipe book that ranked as a protein because `rice` is in its title (item 448): a
  // pattern over names matches text, and text does not know what its numbers mean.
  const PACK_COUNT_THEN_SIZE =
    new RegExp(`(?<![A-Za-z0-9])(\\d+)\\s*(?:${PACK_NOUN})s?\\b[^0-9]{0,12}?(\\d+(?:\\.\\d+)?)\\s*(ml|l|g|kg)\\b`, "i");

  const fwd = s.match(PACK_FORWARD);
  if (fwd) {
    const total = Number(fwd[1]) * Number(fwd[2]);
    if (Number.isFinite(total) && total > 0) return `${trimNum(total)}${fwd[3].toLowerCase()}`;
  }
  const rev = s.match(PACK_REVERSE);
  if (rev) {
    const total = Number(rev[1]) * Number(rev[3]);
    if (Number.isFinite(total) && total > 0) return `${trimNum(total)}${rev[2].toLowerCase()}`;
  }
  const stc = s.match(PACK_SIZE_THEN_COUNT);
  if (stc) {
    const total = Number(stc[1]) * Number(stc[3]);
    if (Number.isFinite(total) && total > 0) return `${trimNum(total)}${stc[2].toLowerCase()}`;
  }
  const cts = s.match(PACK_COUNT_THEN_SIZE);
  if (cts) {
    const total = Number(cts[1]) * Number(cts[2]);
    if (Number.isFinite(total) && total > 0) return `${trimNum(total)}${cts[3].toLowerCase()}`;
  }

  const SIZE_REGEX =
    /(?<!\w)(\d+(?:\.\d+)?)\s*(ml|l|litres?|liters?|g|kg|oz|fl\.?\s*oz)\b/gi;
  const matches = [...s.matchAll(SIZE_REGEX)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const value = last[1];
  let unitRaw = last[2].toLowerCase().replace(/\s+/g, "").replace("floz", "fl oz");
  if (unitRaw === "litre" || unitRaw === "litres" || unitRaw === "liter" || unitRaw === "liters") {
    unitRaw = "l";
  }
  return `${value}${unitRaw}`;
}

// Extract a canonical size token from a NORMALISED name.
// Returns "50ml", "10pcs", "65g", or "" if no size detectable.
// Used to verify that two products being matched via stripped key actually share
// the same size — preventing 7ml samples matching 50ml full-size products, or
// 1pc masks matching 10pc multi-packs.
export function extractSize(normalised: string): string {
  const volMatch = normalised.match(/\b(\d+(?:\.\d+)?)\s*(ml|g|kg|oz)\b/);
  if (volMatch) return `${volMatch[1]}${volMatch[2]}`;
  const countMatch = normalised.match(/\b(\d+)\s*(pcs|pc|ea|count|ct|sheets?|pack)\b/);
  if (countMatch) {
    let unit = countMatch[2];
    if (unit === "sheet" || unit === "sheets") unit = "pcs";
    if (unit === "pc") unit = "pcs";
    if (unit === "count" || unit === "ct") unit = "pcs";
    if (unit === "pack") unit = "pcs";
    return `${countMatch[1]}${unit}`;
  }
  const xMatch = normalised.match(/\bx\s*(\d+)\s*$/);
  if (xMatch) return `${xMatch[1]}pcs`;
  return "";
}

// HARD DISTINCTNESS RULE. Extract EVERY number that appears in the raw name and
// return them as a sorted, comma-joined signature. If two candidate rows have
// different name-number signatures they are DIFFERENT products and must never
// merge — this is the backstop that catches sizes and pack counts embedded in
// the name text that the unit-anchored extractors miss:
//   "7 pcs" vs "32 pcs"      -> "7"    vs "32"
//   "1pc"   vs "10pcs"       -> "1"    vs "10"
//   "40S"   vs "20S"         -> "40"   vs "20"   (bare-count suffix, no unit)
//   "20 sheets" vs "60 sheets" -> "20" vs "60"
//   "...400ml" vs "...1L"    -> "400"  vs "1"    (1L would otherwise null out)
// Decimals are treated as a single number ("3.5g" -> "3.5"). Numbers are sorted
// numerically so token order in the name does not matter.
//
// ── LOAD-BEARING BEYOND ITS STATED PURPOSE. DO NOT NARROW. ──────────────────
// This rule is ALSO the only thing containing the canonical_size multipack
// defect to display, and it does so BY ACCIDENT.
//
// extractCanonicalSize (below) takes the LAST size token and has no notion of a
// multiplier, so "Vida Glow ... 90 x 3g Sachets" stores canonical_size "3g" for
// a 270g pack. 446 live products across every top_category are affected.
// canonical_size is part of idx_products_match, so in principle a unit-size row
// and a genuine single-unit row could collide and merge.
//
// They do not, because this function captures EVERY number: "90 x 3g" yields
// "3,90" and a plain "3g" yields "3". Different signatures never merge. Nothing
// else asserts that coverage and no test names it — it falls out of a rule
// written for "7 pcs" vs "32 pcs".
//
// So: the COLUMN is wrong; the CATALOGUE STRUCTURE built on it is not. If this
// function is ever narrowed — to ignore small numbers, to skip counts already
// captured by extractSize, to dedupe differently — that containment disappears
// SILENTLY and the defect stops being display-only. Any such change must cite
// this comment and re-check the multipack population first.
// See docs/supplements-brand-comparison-proposition.md (item B, merging
// protection) and lib/format/pack-size.ts.
export function extractNameNumbers(rawName: string): string {
  if (!rawName) return "";
  const nums = String(rawName).match(/\d+(?:\.\d+)?/g);
  if (!nums) return "";
  const uniq = [...new Set(nums.map((n) => Number(n)))];
  uniq.sort((a, b) => a - b);
  return uniq.join(",");
}

// ─── Shade extraction (unchanged behaviour, moved verbatim from awin) ─────────

const SHADE_DENYLIST_EXACT =
  /^(eyeliner|eyeshadow|mascara|lipstick|lip gloss|lip balm|lip liner|foundation|concealer|powder|blush|bronzer|highlighter|primer|setting spray|setting powder|cleanser|toner|serum|moisturiser|moisturizer|cream|lotion|oil|mask|mist|sunscreen|body wash|shampoo|conditioner|treatment|refill|spray|stick|pen|pencil|brush|sponge|set|mini|travel|sample|trial|gift|bundle|duo|trio|kit|dry skin|oily skin|combination skin|sensitive skin|dehydrated skin|normal skin|mature skin|all skin types)$/i;
const SHADE_DENYLIST_SUFFIX =
  /\s(eyeliner|eyeshadow|mascara|lipstick|lip gloss|lip balm|lip liner|foundation|concealer|cream|lotion|serum|mask|skin|mist|set|mini|kit|cleanser|toner|essence|ampoule|balm|foam|wash|oil|tissue|pad|patch|sheet|tonic|treatment|fluid|gel|jelly|spray|stick|powder|emulsion|solution|complex|booster|primer|moisturiser|moisturizer|sunscreen|sun cream|hand cream|eye cream|body cream|night cream|day cream|face cream|toothpaste|shampoo|conditioner|deodorant|antiperspirant|fragrance|perfume|tincture|water|milk|drops?|elixir|essence water|mineral water|toner mist|setting mist|face mist|hair mist|body mist)\s*$/i;
export function extractShade(rawName: string): string | null {
  if (!rawName) return null;
  const s = String(rawName);

  const cleanCandidate = (raw: string): string | null => {
    let candidate = raw.trim();
    candidate = candidate.replace(/\s+\d+(?:\.\d+)?\s*(ml|g|kg|oz|pcs?|fl\s*oz)\s*$/i, "").trim();
    if (!candidate) return null;
    if (candidate.length < 2 || candidate.length > 35) return null;
    if (!/[A-Za-z]/.test(candidate)) return null;
    if (candidate.includes(",")) return null;
    const wordCount = candidate.split(/\s+/).length;
    if (wordCount > 6) return null;
    if (wordCount > 4 && !/[#\d]/.test(candidate)) return null;
    if (/^\d+(?:\.\d+)?\s*(ml|g|kg|oz|pcs?|fl\s*oz)?\s*$/i.test(candidate)) return null;
    if (/^(ml|g|kg|oz|pcs|fl\s*oz)$/i.test(candidate)) return null;
    if (SHADE_DENYLIST_EXACT.test(candidate)) return null;
    if (SHADE_DENYLIST_SUFFIX.test(candidate)) return null;
    if (/\d+\s*(?:ml|g|kg|oz|pcs?)\s*x\s*\d+/i.test(candidate)) return null;
    if (/^\d+\s*(?:sheets?|sticks?|pads?|patches|pcs?|tablets?|capsules?|wipes?|sachets?)\b/i.test(candidate)) return null;
    return candidate;
  };

  const dashMatch = s.match(/\s-\s([^-]+?)\s*$/);
  if (dashMatch) {
    const result = cleanCandidate(dashMatch[1]);
    if (result) return result;
  }
  const commaMatch = s.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)\s*,\s*\d+(?:\.\d+)?\s*(?:ml|g|kg|oz|pcs?)\b/);
  if (commaMatch) {
    const result = cleanCandidate(commaMatch[1]);
    if (result) return result;
  }
  return null;
}

// ─── Dedup-tiering helpers (used by scripts/dedup-preview.mts) ────────────────
// These do not change any stored key; they classify a match-key collision group
// so the backfill can hold anything touching a "keep distinct" class back for
// human review instead of auto-merging.

// Shade-bearing product lines: rows that share a name+size on one of these lines
// are usually different SHADES, not duplicates (Clarins Joli Rouge, TirTir
// cushions, fwee lip & cheek). Detected from the product_type column first, then
// from name keywords as a fallback. When a collision group is shade-bearing and
// the shade column is empty, we cannot prove the rows are the same shade, so the
// group is held for review rather than merged.
const SHADE_BEARING_TYPE_RE =
  /\b(lipstick|lip gloss|lip liner|lip tint|lip stain|lip cream|lip oil|lip balm|lip (?:&|and) cheek|liquid lip|tinted lip|foundation|concealer|corrector|eyeshadow|eye shadow|eyeliner|eye liner|kajal|mascara|brow|blush|bronzer|highlighter|nail polish|nail lacquer|nail colour|nail color|cushion|tinted moisturiser|tinted moisturizer|colour corrector|color corrector|contour|tint)\b/i;
// Any product whose name mentions "lip" is variant-prone (tinted balms/oils,
// flavoured sleeping masks, shade ranges), so the whole lip line is treated as
// shade-bearing to keep unlabelled-shade collisions out of the auto-merge tier.
const LIP_RE = /\blip\b/i;
export function isShadeBearingLine(
  name: string,
  productType?: string | null,
  topCategory?: string | null,
): boolean {
  // All colour cosmetics are shade-variant-prone.
  if (topCategory && /makeup/i.test(topCategory)) return true;
  if (productType && (SHADE_BEARING_TYPE_RE.test(productType) || LIP_RE.test(productType))) return true;
  const n = String(name || "");
  return SHADE_BEARING_TYPE_RE.test(n) || LIP_RE.test(n);
}

// Fragrance concentration is part of the SKU identity: EDT ≠ EDP ≠ Parfum ≠
// Cologne ≠ Aftershave ≠ EDC. These tokens already live in the name (so they are
// preserved in the match key), but the dedup surfaces the concentration so a
// reviewer can eyeball a same-key fragrance group with confidence.
export function fragranceConcentration(name: string): string | null {
  const s = String(name || "");
  if (/\b(?:eau\s+de\s+parfum|\bedp\b)\b/i.test(s)) return "EDP";
  if (/\b(?:eau\s+de\s+toilette|\bedt\b)\b/i.test(s)) return "EDT";
  if (/\b(?:eau\s+de\s+cologne|\bedc\b)\b/i.test(s)) return "EDC";
  if (/\bcologne\b/i.test(s)) return "Cologne";
  if (/\baftershave\b/i.test(s)) return "Aftershave";
  if (/\bparfum\b/i.test(s) || /\bperfume\b/i.test(s)) return "Parfum";
  return null;
}

// Version / edition markers ("2.0", "4.0", "v2", "2026 Version", "refill") also
// distinguish SKUs. Preserved in the key; surfaced for review labelling.
export function versionMarker(name: string): string | null {
  const s = String(name || "");
  const m =
    s.match(/\bv\d+(?:\.\d+)?\b/i) ||
    s.match(/\b\d+\.\d+\b/) ||
    s.match(/\b(?:19|20)\d{2}\s*(?:version|edition)\b/i) ||
    s.match(/\brefill\b/i);
  return m ? m[0] : null;
}

// A trailing "+" or an ellipsis ("...", "…") means the name was truncated and a
// distinguishing detail (a shade, a bundled extra, a size) may sit beyond the
// visible text — the KSECRET "102g +" and fwee "(Random...)" cases. Treat such a
// group as uncertain and hold it for review.
export function hasUncertainTail(name: string): boolean {
  const s = String(name || "").trim();
  if (/(\.{3}|…)$/.test(s)) return true;      // ellipsis
  if (/\+\s*\.{0,3}$/.test(s)) return true;   // trailing "+" (optionally "+…")
  if (/[-:,]$/.test(s)) return true;          // dangling dash / colon / comma = cut off
  return false;
}
