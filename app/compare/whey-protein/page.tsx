import Link from 'next/link';
import { SiteLayout } from '../../../components/SiteLayout';
import { UnitPriceList } from '../../../components/UnitPriceList';
import { getTypeByUnitPrice } from '../../../lib/brand-queries';
import { COMMON_NOT_FUNGIBLE } from '../../../lib/unit-price';
import { socialTags } from '../../../lib/format/social-tags';

export const revalidate = 3600;

const title = 'Whey protein price per 100g compared | FindMyBasket';
const description =
  'Every whey protein we track, ranked by price per 100g across UK retailers. The unit price, not the tub price.';
const canonical = 'https://www.findmybasket.co.uk/compare/whey-protein';

export const metadata = {
  title,
  description,
  alternates: { canonical },
  ...socialTags({ title, description, url: canonical }),
};

// A — THE FUNGIBILITY EXCLUSIONS WHEY NEVER RECEIVED (item 455).
// Creatine got these at item 443 and whey did not, so nine rows that are not plain whey
// powder were ranked against it on weight.
//
// B — MASS GAINERS, AND THEY WERE RANKS 1 AND 2. Carbohydrate is most of a gainer's
// weight, so its price per 100g falls while its price per 100g OF PROTEIN does not.
// The page's own unit misreads them, and it misread them at the very top of the list.
const NOT_FUNGIBLE = COMMON_NOT_FUNGIBLE;

// C — FACETS, AND THE ARGUMENT IS THE SPREAD RATHER THAN THE LABELLING.
// Isolate spans 1.3x (£4.90–£6.60) and the plain whey bucket spans 4.7x (£1.88–£8.90).
// On one combined list the isolate buyer cannot see that their real choice is narrow.
// Filtering here is not tidying, it is the only way either spread is visible.
//
// THE RESIDUE IS CALLED "WHEY", NOT "SOURCE NOT STATED" (item 457). The first label was
// chosen to avoid claiming "concentrate", which no product says — and it avoided that
// correctly while introducing a different problem: it named the bucket after what our
// metadata lacks rather than after what the product is, and implied something is
// missing when for most of the 33 nothing is.
//
// On a page titled Whey Protein, a product that is not isolate and not clear whey is
// whey. That is still not a claim of concentrate; it is the page's own subject.
//
// > Naming a residue after what it LACKS describes the catalogue. Naming it after what
// > it IS describes the product. Both can be honest and only one is useful to a shopper.
const FACETS = [
  { slug: 'isolate', label: 'Isolate', test: (n: string) => /\bisolate\b/i.test(n) && !/\bclear whey\b/i.test(n) },
  { slug: 'clear', label: 'Clear whey', test: (n: string) => /\bclear whey\b/i.test(n) },
  { slug: 'unstated', label: 'Whey', test: (n: string) => !/\bisolate\b/i.test(n) && !/\bclear whey\b/i.test(n) },
];

export default async function WheyProteinPage({
  searchParams,
}: {
  searchParams: { type?: string };
}) {
  const { ranked, unranked, median } = await getTypeByUnitPrice('whey', { notFungible: NOT_FUNGIBLE });

  const active = FACETS.find(f => f.slug === searchParams.type) ?? null;
  // ITEM 271: THE CHIP COUNTS WHAT ITS DESTINATION RENDERS, and this rule has broken
  // three times (items 423, 429, 441). Both the chip count and the list come from the
  // SAME filter applied to the SAME array, so they cannot disagree.
  const shown = active ? ranked.filter(p => active.test(p.name)) : ranked;

  return (
    <SiteLayout>
      <section className="max-w-site mx-auto px-6 py-12">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
          <Link href="/compare" className="hover:text-ink transition-colors">Compare by unit price</Link>
        </p>
        <h1 className="font-serif text-5xl md:text-7xl text-ink mb-6">Whey protein by price per 100g</h1>
        <p className="text-base md:text-lg text-ink-light max-w-2xl mb-4 leading-relaxed">
          Protein powder is sold in tubs from 250g to 5kg, so the shelf price says little about
          value. This ranks every whey we track by what 100g actually costs.{' '}
          <Link href="/compare/plant-protein" className="text-gold underline hover:no-underline">
            Plant protein is ranked separately
          </Link>.
        </p>

        <div className="flex flex-wrap gap-2 mb-6">
          <Link
            href="/compare/whey-protein"
            className={`px-4 py-2 rounded-full text-sm border transition-colors ${
              active ? 'border-border text-ink-light hover:border-gold hover:text-ink' : 'border-gold bg-gold text-white'
            }`}
          >
            All <span className="opacity-60">{ranked.length}</span>
          </Link>
          {FACETS.map(f => {
            const n = ranked.filter(p => f.test(p.name)).length;
            if (n === 0) return null;
            return (
              <Link
                key={f.slug}
                href={`/compare/whey-protein?type=${f.slug}`}
                className={`px-4 py-2 rounded-full text-sm border transition-colors ${
                  active?.slug === f.slug
                    ? 'border-gold bg-gold text-white'
                    : 'border-border text-ink-light hover:border-gold hover:text-ink'
                }`}
              >
                {f.label} <span className="opacity-60">{n}</span>
              </Link>
            );
          })}
        </div>

        {median !== null && shown.length > 0 && (
          <p className="text-ink-light mb-8">
            {shown.length} products from {new Set(shown.map(p => p.brand_slug)).size} brands ·
            £{(shown[0].per100g as number).toFixed(2)} to
            £{(shown[shown.length - 1].per100g as number).toFixed(2)} per 100g
          </p>
        )}

        <UnitPriceList
          ranked={shown}
          unranked={active ? [] : unranked}
          unrankedIntro="These are whey products we track but cannot rank against plain whey powder by weight. They are listed rather than hidden, with the reason."
        />
      </section>
    </SiteLayout>
  );
}
