// Edits are curated collections of products. Unlike top_category (skincare/
// makeup/hair) which is a strict taxonomy, edits cut across categories
// based on theme, story, or origin. Each edit has its own URL, hero
// content, and product selection criteria.
//
// Adding a new edit: append to the EDITS map. The /edit/[slug] route
// auto-picks it up.

export interface Edit {
  slug: string;
  display_name: string;
  hero_intro: string;
  meta_title: string;
  meta_description: string;

  // Product selection: products match if their normalised_brand is in
  // brand_slugs OR they're stocked at one of include_retailer_ids.
  brand_slugs: string[];
  include_retailer_ids: number[];
}

export const EDITS: Record<string, Edit> = {
  'k-beauty': {
    slug: 'k-beauty',
    display_name: 'Korean beauty',
    hero_intro:
      'The K-beauty edit. Korean skincare and makeup brands stocked across UK retailers. Innisfree, TIRTIR, ANUA, COSRX, Beauty of Joseon and more.',
    meta_title: 'Korean beauty (K-beauty) best prices UK | FindMyBasket',
    meta_description:
      'Compare prices on Korean skincare and makeup across UK retailers. From cult favourites like COSRX, Beauty of Joseon and TIRTIR to emerging brands. Find the best deal.',
    brand_slugs: [
      // Skincare-leaning
      'cosrx', 'beauty of joseon', 'numbuzin', 'anua', 'skin1004',
      'laneige', 'sulwhasoo', 'innisfree', 'some by mi', 'mediheal',
      'pyunkang yul', 'round lab', 'heimish', 'klairs', 'iunik',
      'purito', 'mixsoon', 'jumiso', 'manyo', 'mary and may',
      'isntree', 'banobagi', 'goodal', 'dr jart', 'dr jart+',
      'mizon', 'haruharu wonder', 'biodance', 'ma:nyo',
      'i\'m from', 'medicube', 'bring green', 'frudia', 'centellian24',
      'troiareuke', 'commonlabs', 'parnell', 'nacific', 'skinfood',
      'erborian', 'skin cupid',
      // Makeup-leaning
      'tirtir', 'muzigae mansion', 'fwee', 'rom&nd', 'romand',
      'etude', 'etude house', 'dasique', 'laka', 'vt',
      'peach c', 'judydoll', 'joocyee',
    ],
    include_retailer_ids: [7], // Skin Cupid - 99%+ K-beauty
  },
};

export function getEdit(slug: string): Edit | null {
  return EDITS[slug] ?? null;
}

export function listEdits(): Edit[] {
  return Object.values(EDITS);
}
