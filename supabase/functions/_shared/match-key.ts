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

// Normalised name for fuzzy matching (lowercase, alphanumeric only, single
// spaces). Curly quotes are folded to a straight apostrophe first so "L'Oréal"
// and "L’Oréal" collapse identically before the non-alphanumeric strip.
export function normaliseForMatch(s: string): string {
  return String(s || "")
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
function stripLeadingBrandRepetition(normName: string, normBrand: string): string {
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
  const normNameRaw = stripContainerNouns(normaliseForMatch(stripPromoTags(name)));
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
export function extractCanonicalSize(rawName: string): string | null {
  if (!rawName) return null;
  const s = String(rawName);
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
