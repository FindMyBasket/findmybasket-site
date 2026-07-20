// Multipack-deeplink guard.
//
// THE DEFECT THIS EXISTS FOR (Gorgeous Shop, retailer 30, 2026-07-20):
// Some retailers sell "buy two" multipacks under a product_name that is
// IDENTICAL to the single item, with the multiplier appearing only in the
// deeplink URL and on the merchant's own page title. Example:
//
//   feed product_name : "Medik8 C Tetra Serum 30ml"
//   deeplink slug     : /medik8-double-c-tetra-serum-30ml
//   merchant title    : "Medik8 C Tetra Serum 30ml Double"
//
// The match key is built from the name, so the name never carries the
// multiplier and the row matches the SINGLE-item comparison page. The result is
// a 2-pack price presented as the price of one unit. Live, this put GBP 74.10
// against peers at GBP 39.00 on 84 pages, and on 53 of them the multipack was
// CHEAPER than peers, so the retailer would have won "best price" wrongly.
//
// THE RULE IS RELATIONAL, NOT ABSOLUTE.
// A multipack deeplink is only a problem when it lands on a single-item product.
// A genuine multi-item bundle ("Shampoo 300ml & Conditioner 250ml Duo") names
// both items in the feed too, matches a bundle product, and must SURVIVE.
//
// The distinction, confirmed against 20 merchant page titles:
//   multipack of ONE sku   -> title is "<single item> Double"      -> SKIP
//   bundle of DIFFERENT sku-> title is "<item A> & <item B> Duo"   -> KEEP
//
// So: skip only when the deeplink signals a multiplier AND the product name
// describes a single item.

// Multiplier words seen in real deeplink slugs, plus the numeric pack forms.
// Anchored to slug separators so "twofold-cream" or "trio-logy" cannot trip it.
// Numeric forms are bounded to 2-6 on purpose. An unbounded \d+ reads a COUNT
// as a multiplier: "Elemis Dynamic Resurfacing Facial Pads 60pk" is 60 pads,
// part of the product's identity, not sixty boxes. Real multipacks are small.
const SLUG_MULTIPLIER_RE =
  /(?:^|[-_/])(?:duo|double|twin|twinpack|triple|trio|bundle|two|[2-6]\s*-?\s*pack|[2-6]pk|x[2-6])(?:$|[-_/])/i;

// Bare "pack" is a multiplier for some merchants ("/brand-pack-metal-detox-…")
// but a PRODUCT TYPE for others ("sleeping pack", "wash-off pack", "modeling
// pack" — standard K-beauty terms). Treated as a multiplier only when it is a
// standalone slug segment AND not preceded by a word that makes it a type.
const PACK_AS_TYPE_PREFIX =
  /(sleeping|wash-?off|modell?ing|clay|mud|peel|peel-?off|bubble|night|sheet|nose|lip|eye|foot|hand|hair|mask|cream|gel|water)$/i;
const BARE_PACK_RE = /(?:^|[-_/])pack(?:$|[-_/])/i;

function bareePackIsMultiplier(slug: string): boolean {
  const m = BARE_PACK_RE.exec(slug);
  if (!m) return false;
  const before = slug.slice(0, m.index).replace(/[-_/]+$/, "");
  const prevToken = before.split(/[-_/]/).pop() ?? "";
  // A hyphenated type like "wash-off" needs the last two tokens.
  const prevTwo = before.split(/[-_/]/).slice(-2).join("-");
  return !PACK_AS_TYPE_PREFIX.test(prevToken) && !PACK_AS_TYPE_PREFIX.test(prevTwo);
}

// A name describes MORE THAN ONE distinct item if it joins two things.
// "&", "and", "+", "with" are how this catalogue writes real bundles.
const NAME_JOINS_ITEMS_RE = /(?:\s&\s|\s\+\s|\band\b|\bplus\b|\bwith\b)/i;

// An explicit bundle/multipack word in the NAME means the name already carries
// the multiplier, so the match key saw it and the row is not a silent mismatch.
const NAME_BUNDLE_WORD_RE =
  /\b(?:duo|double|twin|triple|trio|bundle|set|kit|pack|multipack)\b/i;

// Size/count tokens. Two or more distinct sizes in a name means two items.
const SIZE_TOKEN_RE = /\d+(?:\.\d+)?\s*(?:ml|g|kg|oz|l)\b/gi;

/** Pull the merchant path out of a raw or AWIN-wrapped deeplink. */
export function deeplinkSlug(url: string): string {
  const raw = String(url || "");
  if (!raw) return "";
  // AWIN wraps the merchant URL in the `ued` query parameter.
  const ued = raw.match(/[?&]ued=([^&]+)/i);
  const target = ued ? safeDecode(ued[1]) : raw;
  try {
    return new URL(target).pathname;
  } catch {
    // Not a parseable URL (relative, or malformed) — fall back to the raw string
    // so a merchant that stores a bare path is still inspected.
    return target;
  }
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Does the deeplink advertise a multipack? */
export function deeplinkSignalsMultipack(url: string): boolean {
  const slug = deeplinkSlug(url);
  return SLUG_MULTIPLIER_RE.test(slug) || bareePackIsMultiplier(slug);
}

/** Does the product name describe exactly one item? */
export function nameDescribesSingleItem(name: string): boolean {
  const n = String(name || "");
  if (!n) return false;
  if (NAME_BUNDLE_WORD_RE.test(n)) return false;   // name already says bundle
  if (NAME_JOINS_ITEMS_RE.test(n)) return false;   // names two things
  const sizes = n.match(SIZE_TOKEN_RE) || [];
  const distinct = new Set(sizes.map((s) => s.toLowerCase().replace(/\s+/g, "")));
  return distinct.size <= 1;                        // one size (or none) => one item
}

/**
 * True when this feed row is a multipack being attached to a single-item
 * product, i.e. the price would misrepresent the product. Skip those rows.
 *
 * `comparisonName` MUST be the name of the product the row MATCHED, not the
 * feed's own product_name.
 *
 * That distinction is the whole defect. The first version of this guard passed
 * the feed name, reasoning that a feed name carrying "Duo" meant the match key
 * had seen the multiplier and so no silent mismatch was possible. It is not:
 * the Tier-4 stripped matcher strips past the multiplier, so a feed row named
 * "Dermalogica Duo Biolumin-C Serum 30ml & Biolumin-C Gel Moisturiser" still
 * landed on "Dermalogica Biolumin-C Serum 30ml", a single. The feed name said
 * bundle, the guard stood down, and the mismatch shipped. Six of the ten
 * escapes in the first live run were this.
 *
 * Against the MATCHED product's name the same logic is correct: if the matched
 * product is itself a bundle, keep the row; if it is a single, skip.
 */
export function isMultipackMismatch(deepLinkUrl: string, comparisonName: string): boolean {
  return deeplinkSignalsMultipack(deepLinkUrl) && nameDescribesSingleItem(comparisonName);
}
