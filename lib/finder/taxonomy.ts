import { supabase } from '../supabase';

// Curated Product Finder taxonomy (Stage 1). Hand-picked concerns + ingredients
// rather than LLM-extracted tags: predictable, defensible, and each term is a
// query into the existing full-text search (fmb_search_products). The chips on
// /finder link to /search?q={searchQuery}; the /search page reuses this list to
// show a "Find by ingredient/concern" framing when a query matches.

export type FinderConcern = {
  slug: string;        // 'anti-ageing'
  label: string;       // 'Anti-ageing'
  searchQuery: string; // term passed to /search
  description?: string;
};

export type FinderIngredient = {
  slug: string;        // 'niacinamide'
  label: string;       // 'Niacinamide'
  searchQuery: string; // primary search term
  aliases?: string[];  // synonyms for matching (not searched directly) - Stage 2
  description?: string;
};

export const FINDER_CONCERNS: FinderConcern[] = [
  { slug: 'anti-ageing', label: 'Anti-ageing', searchQuery: 'anti-ageing' },
  { slug: 'hydration', label: 'Hydration', searchQuery: 'hydration' },
  { slug: 'brightening', label: 'Brightening', searchQuery: 'brightening' },
  { slug: 'acne', label: 'Acne & blemishes', searchQuery: 'acne' },
  { slug: 'sensitive', label: 'Sensitive skin', searchQuery: 'sensitive' },
  { slug: 'dry-skin', label: 'Dry skin', searchQuery: 'dry skin' },
  { slug: 'oily-skin', label: 'Oily skin', searchQuery: 'oily skin' },
  { slug: 'combination-skin', label: 'Combination skin', searchQuery: 'combination skin' },
  { slug: 'pores', label: 'Large pores', searchQuery: 'pores' },
  { slug: 'dullness', label: 'Dullness', searchQuery: 'dullness' },
  { slug: 'dark-spots', label: 'Dark spots', searchQuery: 'dark spots' },
  { slug: 'fine-lines', label: 'Fine lines & wrinkles', searchQuery: 'fine lines wrinkles' },
  { slug: 'soothing', label: 'Redness & soothing', searchQuery: 'soothing' },
  { slug: 'sun-protection', label: 'Sun protection', searchQuery: 'sun protection' },
  { slug: 'exfoliation', label: 'Exfoliation', searchQuery: 'exfoliation' },
];

export const FINDER_INGREDIENTS: FinderIngredient[] = [
  // Tier 1: high awareness
  { slug: 'niacinamide', label: 'Niacinamide', searchQuery: 'niacinamide' },
  { slug: 'hyaluronic-acid', label: 'Hyaluronic acid', searchQuery: 'hyaluronic acid' },
  { slug: 'retinol', label: 'Retinol', searchQuery: 'retinol' },
  { slug: 'vitamin-c', label: 'Vitamin C', searchQuery: 'vitamin c' },
  { slug: 'salicylic-acid', label: 'Salicylic acid', searchQuery: 'salicylic acid' },
  { slug: 'aha', label: 'AHA', searchQuery: 'aha' },
  { slug: 'bha', label: 'BHA', searchQuery: 'bha' },
  { slug: 'peptides', label: 'Peptides', searchQuery: 'peptides' },
  { slug: 'ceramides', label: 'Ceramides', searchQuery: 'ceramides' },
  { slug: 'glycolic-acid', label: 'Glycolic acid', searchQuery: 'glycolic acid' },
  // Tier 2: medium awareness
  { slug: 'lactic-acid', label: 'Lactic acid', searchQuery: 'lactic acid' },
  { slug: 'squalane', label: 'Squalane', searchQuery: 'squalane' },
  { slug: 'snail-mucin', label: 'Snail mucin', searchQuery: 'snail mucin' },
  { slug: 'centella', label: 'Centella', searchQuery: 'centella' },
  { slug: 'azelaic-acid', label: 'Azelaic acid', searchQuery: 'azelaic acid' },
  { slug: 'bakuchiol', label: 'Bakuchiol', searchQuery: 'bakuchiol' },
  { slug: 'vitamin-e', label: 'Vitamin E', searchQuery: 'vitamin e' },
  { slug: 'panthenol', label: 'Panthenol', searchQuery: 'panthenol' },
  { slug: 'collagen', label: 'Collagen', searchQuery: 'collagen' },
  { slug: 'tranexamic-acid', label: 'Tranexamic acid', searchQuery: 'tranexamic acid' },
  // Tier 3: niche/premium
  { slug: 'alpha-arbutin', label: 'Alpha arbutin', searchQuery: 'alpha arbutin' },
  { slug: 'kojic-acid', label: 'Kojic acid', searchQuery: 'kojic acid' },
  { slug: 'rosehip', label: 'Rosehip oil', searchQuery: 'rosehip oil' },
  { slug: 'jojoba', label: 'Jojoba oil', searchQuery: 'jojoba oil' },
  { slug: 'mandelic-acid', label: 'Mandelic acid', searchQuery: 'mandelic acid' },
];

// Total match count for a term via the existing full-text RPC (limit 1, we only
// want total_count). Used by /finder to label each chip. Cached by the page's ISR.
export async function getFinderCount(term: string): Promise<number> {
  const { data, error } = await supabase.rpc('fmb_search_products', {
    search_query: term,
    category_filter: null,
    limit_count: 1,
  });
  if (error || !data || !data[0]) return 0;
  return Number((data[0] as { total_count: number | null }).total_count ?? 0);
}

export type TaxonomyMatch = { kind: 'ingredient' | 'concern'; label: string };

// Does a free-text query correspond to a curated taxonomy term? Matches on
// searchQuery, slug, or label (case-insensitive) so /search can show the
// "Find by ingredient/concern" framing whether the visitor arrives from a chip
// or types the term directly. Ingredients win ties (more specific intent).
export function matchTaxonomy(query: string): TaxonomyMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const hit = (i: { slug: string; label: string; searchQuery: string }) =>
    i.searchQuery.toLowerCase() === q || i.slug.toLowerCase() === q || i.label.toLowerCase() === q;

  const ingredient = FINDER_INGREDIENTS.find(hit);
  if (ingredient) return { kind: 'ingredient', label: ingredient.label };

  const concern = FINDER_CONCERNS.find(hit);
  if (concern) return { kind: 'concern', label: concern.label };

  return null;
}
