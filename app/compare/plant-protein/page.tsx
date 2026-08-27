import Link from 'next/link';
import { SiteLayout } from '../../../components/SiteLayout';
import { getTypeByUnitPrice } from '../../../lib/brand-queries';
import { socialTags } from '../../../lib/format/social-tags';

export const revalidate = 3600;

const title = 'Plant protein price per 100g compared | FindMyBasket';
const description =
  'Pea, soy and vegan protein powders ranked by price per 100g across UK retailers. The unit price, not the tub price.';
const canonical = 'https://www.findmybasket.co.uk/compare/plant-protein';

export const metadata = {
  title,
  description,
  alternates: { canonical },
  ...socialTags({ title, description, url: canonical }),
};

// SEPARATE FROM WHEY, DELIBERATELY. Pea and whey are not interchangeable -- different
// amino profiles, different buyers, and the choice between them is not a price
// decision. Ranking them together would invite a comparison nobody is making. Item 447.
//
// THE TYPE PATTERN IS LOOSER THAN IT LOOKS, and reading the names is what showed it.
// `rice` matched "Myprotein Digital Recipe Book: Not Just Chicken & Rice" -- a book, in
// a protein ranking, reachable only because a word in a recipe title is also a protein
// source. A regex over names is a search, not a classification.
const NOT_FUNGIBLE = [
  {
    test: /\b(recipe book|magazine|subscription|ebook)\b/i,
    reason: 'not a protein powder — matched because a word in its title is also a protein source',
  },
  { test: /\b(bars?|cookie|brownie|snack)\b/i, reason: 'a bar rather than powder — not comparable by weight' },
  {
    test: /\bprotein plus\b/i,
    reason: 'a fortified blend rather than plain plant protein — some of the weight is added vitamins',
  },
];

export default async function PlantProteinPage() {
  const { ranked, unranked, median } = await getTypeByUnitPrice('protein', {
    notFungible: [
      // Whey and other animal proteins are excluded before anything else: the pattern
      // has to be broad enough to catch "Impact Vegan Protein" and "Clean Lean Protein",
      // neither of which names its source, so the exclusion does the narrowing.
      { test: /\b(whey|casein|collagen|milk protein|beef)\b/i, reason: 'not a plant protein' },
      ...NOT_FUNGIBLE,
    ],
  });

  // The broad 'protein' fetch plus the whey exclusion leaves plant and unlabelled
  // rows; keep only those that actually name a plant source or vegan claim.
  const isPlant = (n: string) => /\b(pea|soy|rice|hemp|vegan|plant)\b/i.test(n);
  const rankedPlant = ranked.filter(p => isPlant(p.name));
  const unrankedPlant = unranked.filter(p => isPlant(p.name));

  return (
    <SiteLayout>
      <section className="max-w-site mx-auto px-6 py-12">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
          <Link href="/compare" className="hover:text-ink transition-colors">Compare by unit price</Link>
        </p>
        <h1 className="font-serif text-5xl md:text-7xl text-ink mb-6">Plant protein by price per 100g</h1>
        <p className="text-base md:text-lg text-ink-light max-w-2xl mb-4 leading-relaxed">
          Pea, soy and blended vegan powders, ranked by what 100g actually costs.{' '}
          <Link href="/compare/whey-protein" className="text-gold underline hover:no-underline">
            Whey is ranked separately
          </Link>{' '}
          because the two are not interchangeable.
        </p>
        {median !== null && (
          <p className="text-ink-light mb-10">
            {rankedPlant.length} products from {new Set(rankedPlant.map(p => p.brand_slug)).size} brands.
            Median £{median.toFixed(2)} per 100g.
          </p>
        )}

        <ol className="space-y-2 mb-16">
          {rankedPlant.map((p, i) => (
            <li key={p.id}>
              <Link
                href={`/product/${p.id}`}
                className="group flex items-baseline gap-4 py-3 border-b border-border/60 hover:border-gold transition-colors"
              >
                <span className="text-sm text-ink-light tabular-nums w-8 shrink-0">{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="text-ink group-hover:text-gold transition-colors">{p.name}</span>
                  {p.brand && <span className="text-sm text-ink-light"> · {p.brand}</span>}
                </span>
                <span className="text-sm text-ink-light tabular-nums shrink-0">
                  {p.grams ? `${p.grams >= 1000 ? `${p.grams / 1000}kg` : `${p.grams}g`}` : ''}
                </span>
                <span className="text-sm text-ink-light tabular-nums shrink-0">£{p.price.toFixed(2)}</span>
                <span className="font-medium text-ink tabular-nums shrink-0 w-24 text-right">
                  £{(p.per100g as number).toFixed(2)}<span className="text-ink-light text-xs">/100g</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>

        {unrankedPlant.length > 0 && (
          <div className="border-t border-border pt-8">
            <h2 className="font-serif text-2xl text-ink mb-2">Not ranked</h2>
            <p className="text-ink-light mb-6 text-sm max-w-2xl">
              Listed rather than hidden, with the reason.
            </p>
            <ul className="space-y-2">
              {unrankedPlant.map(p => (
                <li key={p.id} className="py-2 border-b border-border/40">
                  <Link href={`/product/${p.id}`} className="text-ink hover:text-gold transition-colors">
                    {p.name}
                  </Link>
                  <span className="block text-sm text-ink-light">{p.excluded}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </SiteLayout>
  );
}
