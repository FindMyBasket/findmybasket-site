// THE SIX METADATA TEMPLATES, IN ONE PLACE SO THEY SHARE ONE VOCABULARY.
//
// Three for product pages (by how many retailers stock the product) and three for brand
// hubs (by how many stock the range). They say the same things in the same words because
// they are written beside each other, not because two files were kept in step by hand --
// which is item 267's drift shape, two expressions of one rule becoming two rules.
//
// MOVED, NOT COPIED, out of app/product/[id]/page.tsx and app/brands/[slug]/page.tsx.
// Both routes import from here; nothing renders its own wording. The move also makes the
// templates reachable from the test runner without a Supabase client, which is the same
// reason brandSlug moved in item 271.
//
// The reasoning for WHY each branch exists (the 13,257 / 73,669 / 12,315 split, the
// 1,654 / 190 / 167 hub split, and why a count in ISR metadata is safe here) lives at the
// call sites, next to the revalidate setting the argument depends on.

/** Shorten to `cap`, with an ellipsis, on a whitespace-tidy boundary. */
export function truncate(s: string, cap: number): string {
  if (s.length <= cap) return s;
  return s.slice(0, cap - 1).trimEnd() + '…';
}

/**
 * Strip everything but letters and digits, for comparing two strings that mean the same
 * thing but are punctuated differently.
 */
export function comparisonKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Total title length before the product name is shortened to fit.
 *
 * THE NAME IS CUT, THE SUFFIX IS KEPT WHOLE. The suffix is the part that matches the
 * query -- "prices compared across 3 UK retailers", "Boots price with delivery" -- so a
 * title cut mid-claim is worse than a shortened product name followed by an intact one.
 * Catalogue titles are median 52 characters, p90 75, max 200 across 99,241 live pages,
 * so the cap is a tail control rather than something most pages meet.
 */
export const TITLE_CAP = 110;

/** Append `suffix` whole, shortening `base` to make room for it. */
export function titleWithSuffix(base: string, suffix: string): string {
  const room = TITLE_CAP - suffix.length;
  return (room > 0 ? truncate(base, room) : base) + suffix;
}

/**
 * Build an SEO description from the real product description when available, falling back
 * to the generated template. When the description is short there's room to append the
 * brand + product name for keyword coverage.
 *
 * THE DUPLICATE GUARD IS NORMALISED, AND IT DID NOT USED TO BE. It was
 * `!base.toLowerCase().includes(title.toLowerCase())` -- an exact substring test, which
 * ONE COMMA defeats:
 *
 *     description  "…Sticky Toffee Pudding Shower & Bath Gel, 500ml"
 *     title        "…Sticky Toffee Pudding Shower & Bath Gel 500ml"
 *
 * so the near-identical title was appended and the page served its own name twice.
 * Measured 24 August 2026: 4,567 pages take this append branch and 2,092 of them -- 45.8%
 * -- append a title the description already contains once punctuation is ignored.
 * Comparing on comparisonKey rather than on the raw strings closes all 2,092. Item 283.
 */
export function buildSeoDescription(
  description: string | null,
  title: string,
  fallback: string,
  cap: number,
): string {
  const base = description?.trim();
  if (!base) return truncate(fallback, cap);
  const suffix = ` ${title}`;
  if (base.length + suffix.length <= cap && !comparisonKey(base).includes(comparisonKey(title))) {
    return base + suffix;
  }
  return truncate(base, cap);
}

// FALLBACK LENGTH, STATED RATHER THAN LEFT TO THE TRUNCATOR. The three fallbacks below only
// fire when the catalogue has no usable description -- 27,553 of 99,241 pages, 27.8% -- and
// each one repeats the product name, which is median 52 characters and p90 75. They are
// written to fit the 155-character meta cap at a median-length name; a longer name still
// truncates, and that is the intended degradation rather than an oversight. The brand-hub
// wording below is NOT shortened to match: brand names are short, those templates never
// truncate, and item 279's copy shipped as written.

export interface ProductCopyInput {
  /** Brand + name, already de-duplicated by displayProductTitle. */
  baseTitle: string;
  /** Retailers with an in-stock offer the page will list, counted family-aware. */
  stockists: number;
  /** The retailer's name when there is exactly one; null otherwise. */
  soleRetailer: string | null;
}

export interface MetadataCopy {
  title: string;
  /** Used when the catalogue has no usable description of its own. */
  fallbackDescription: string;
}

/**
 * PRODUCT PAGES: three branches, chosen by how many retailers actually stock the product.
 *
 * The single template these replace said "Compare {product} prices across multiple UK
 * retailers" on all 99,241 pages, and 86.6% of them had nothing to compare. Item 281.
 */
export function productMetadataCopy(input: ProductCopyInput): MetadataCopy {
  const { baseTitle, stockists, soleRetailer } = input;

  if (stockists >= 2) {
    // A: the claim is true, so the count is STATED rather than implied by "multiple".
    return {
      title: titleWithSuffix(baseTitle, ` prices compared across ${stockists} UK retailers | FindMyBasket`),
      fallbackDescription:
        `Compare ${baseTitle} prices across ${stockists} UK retailers, delivery included, ` +
        `so you see what each option costs to your door.`,
    };
  }

  if (stockists === 1 && soleRetailer) {
    // B: one stockist. The honest answer to "where do I buy this" is one place, named --
    // which answers the search rather than dodging it.
    return {
      title: titleWithSuffix(baseTitle, ` | ${soleRetailer} price with delivery | FindMyBasket`),
      fallbackDescription:
        `${baseTitle} is stocked at ${soleRetailer} from our UK retailers. ` +
        `See the price with delivery included before you buy.`,
    };
  }

  // C: nothing in stock, so NOTHING ABOUT PRICE IS CLAIMED. The page still has a reason to
  // exist -- it lists which retailers carry the product and when each was last seen -- and
  // that is what the copy offers instead of a comparison it cannot make.
  //
  // This branch also catches stockists === 1 with a missing retailer name, which the RPC
  // does not currently produce (checked across all 99,241 live pages). Falling here rather
  // than into B is deliberate: an unreadable name must not become a blank claim.
  return {
    title: titleWithSuffix(baseTitle, ` | Not currently in stock | FindMyBasket`),
    fallbackDescription:
      `${baseTitle} is not in stock at any of our UK retailers right now. ` +
      `See who lists it and what delivery adds.`,
  };
}

export interface BrandCopyInput {
  displayName: string;
  /** Distinct retailers with any in-stock product from the range. */
  stockists: number;
  /** Products carried by two or more of them -- the number that can actually be compared. */
  comparable: number;
  soleRetailer: string | null;
}

/**
 * BRAND HUBS: the same three states in the same words. Item 279 wrote the first two;
 * item 282 split the third out of the second's fallback, where 167 hubs with nothing in
 * stock were being told delivery was included in every price.
 */
export function brandMetadataCopy(input: BrandCopyInput): MetadataCopy {
  const { displayName, stockists, comparable, soleRetailer } = input;

  if (comparable > 0) {
    return {
      title: `${displayName} prices compared across ${stockists} UK retailers | FindMyBasket`,
      fallbackDescription:
        `Compare ${displayName} prices across ${stockists} UK retailers with delivery ` +
        `included, so you see what each option costs to get to your door. ` +
        `${comparable} product${comparable === 1 ? '' : 's'} with more than one stockist.`,
    };
  }

  if (stockists === 0) {
    return {
      title: `Where to buy ${displayName} in the UK | FindMyBasket`,
      fallbackDescription:
        `We track ${displayName} across UK retailers. Nothing from the range is in stock ` +
        `right now. See which retailers carry it and what delivery adds when it returns.`,
    };
  }

  return {
    title: `Where to buy ${displayName} in the UK | FindMyBasket`,
    fallbackDescription: soleRetailer
      ? `${displayName} is stocked at ${soleRetailer} from our UK retailers. ` +
        `See the price with delivery included before you buy.`
      : `See where to buy ${displayName} in the UK, with delivery included in every price.`,
  };
}
