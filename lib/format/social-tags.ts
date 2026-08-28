// OPENGRAPH AND TWITTER TAGS, IN ONE PLACE FOR THE SAME REASON THE SIX TEMPLATES ARE.
//
// Twelve category routes plus the brand hub would otherwise each carry their own copy of
// the same five constants, and twelve copies of one decision is twelve places for it to
// drift. Item 296.
//
// MEASURED BEFORE IT WAS WRITTEN (24 Aug 2026): brand hubs, category roots and
// subcategories emitted NO og: or twitter: tags at all, so a hub shared to social produced
// no title, no description and no image. Only /product/[id], /app and the static homepage
// emitted any.

/** The site share card. 2500x1312 (1.905:1, the same ratio as the recommended 1200x630). */
export const SITE_OG_IMAGE = {
  url: 'https://www.findmybasket.co.uk/og-image.jpg',
  // DECLARED FROM THE FILE, NOT FROM THE RECOMMENDATION. public/index.html declared
  // 1200x630 for this same 2500x1312 file -- the right aspect ratio and the wrong numbers.
  // Facebook lays the card out from the declared values before it fetches, so a mismatch
  // reflows. Fixed there in the same pass; stated here so the next copy starts correct.
  width: 2500,
  height: 1312,
  alt: 'FindMyBasket — compare health and beauty prices across UK retailers, delivery included',
};

/**
 * WHY EVERY BRAND HUB AND CATEGORY GETS THE SAME IMAGE, AND NOT A PRODUCT FROM THE BRAND.
 *
 * A representative product image is AVAILABLE -- every row in products_active has one, zero
 * nulls -- and none of them is representative. getBrandProducts orders by `id` for
 * pagination stability, so "the first product" means "the oldest row":
 *
 *     Maybelline (595 live products)  ->  "Lifter Glaze Berry Haze", one lip gloss shade
 *     No7        (679 live products)  ->  "Naturally Sun Kissed Gradual Body Tan"
 *
 * A share card showing one lip gloss shade for a 595-product brand MAKES A CLAIM ABOUT THE
 * BRAND THAT THE ORDERING NEVER INTENDED TO MAKE. The `.order('id')` is correct -- it exists
 * because LIMIT/OFFSET without a unique sort has no guaranteed row order -- and it is
 * correct for pagination, which is the only thing it was chosen for. A decision that is
 * right where it was made can produce a wrong-looking result somewhere else entirely, and
 * the second surface is where you find out.
 *
 * Brand logos would answer it and do not exist: brand_hubs.logo_path is set on both rows of
 * a two-row table, against 2,640 hubs, and public/logos holds RETAILER logos.
 *
 * So: the site card, which is at least true. A card with no image is better than a broken
 * one, and a card with the wrong image is worse than either.
 */
export function socialTags(input: { title: string; description: string; url: string }) {
  const { title, description, url } = input;
  return {
    openGraph: {
      title,
      description,
      url,
      // type and siteName were MISSING from /product/[id] and present on the static
      // homepage. Following the richer of the two working examples.
      type: 'website' as const,
      siteName: 'FindMyBasket',
      images: [SITE_OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image' as const,
      title,
      description,
      images: [SITE_OG_IMAGE.url],
    },
  };
}
