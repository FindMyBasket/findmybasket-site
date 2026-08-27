import Link from 'next/link';
import { SiteLayout } from '../../../components/SiteLayout';
import { UnitPriceList } from '../../../components/UnitPriceList';
import { getTypeByUnitPrice } from '../../../lib/brand-queries';
import { COMMON_NOT_FUNGIBLE } from '../../../lib/unit-price';
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
  ...COMMON_NOT_FUNGIBLE,
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

        <UnitPriceList
          ranked={rankedPlant}
          unranked={unrankedPlant}
          unrankedIntro="Listed rather than hidden, with the reason."
        />

      </section>
    </SiteLayout>
  );
}
