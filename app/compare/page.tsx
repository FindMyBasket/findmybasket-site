import Link from 'next/link';
import { SiteLayout } from '../../components/SiteLayout';
import { getTypeByUnitPrice } from '../../lib/brand-queries';
import { socialTags } from '../../lib/format/social-tags';

export const revalidate = 3600;

const title = 'Compare supplements by unit price | FindMyBasket';
const description =
  'Supplements sold in tubs of different sizes, ranked by what the powder actually costs per 100g rather than by the shelf price.';
const canonical = 'https://www.findmybasket.co.uk/compare';

export const metadata = {
  title,
  description,
  alternates: { canonical },
  ...socialTags({ title, description, url: canonical }),
};

// AN INDEX FOR TWO PAGES, BUILT FOR FIVE (item 445).
//
// Two entries would normally be worse than two links from /supplements. The pipeline is
// what justifies it: collagen has 96 sized and priced products pending the source
// question, electrolytes 57, plant protein 23 and buildable today. Five types with two
// shipped, and the ones that follow need a parent that already exists rather than one
// added later once the orphaning is noticed again.
//
// The list is built from the pages that EXIST, not from the pipeline -- a promise of
// pages is not a page, and an index listing things that are not there is the
// incompleteness argument in reverse.
const TYPES = [
  { slug: 'whey-protein', pattern: 'whey', label: 'Whey protein',
    blurb: 'Sold in tubs from 250g to 2.5kg. The same protein at very different unit prices.' },
  { slug: 'creatine', pattern: 'creatine', label: 'Creatine',
    blurb: 'Monohydrate is the same substance whoever sells it, so only the price per gram differs.' },
];

export default async function ComparePage() {
  const rows = await Promise.all(
    TYPES.map(async t => {
      const { ranked, median } = await getTypeByUnitPrice(t.pattern);
      const cheapest = ranked[0]?.per100g ?? null;
      const dearest = ranked[ranked.length - 1]?.per100g ?? null;
      return {
        ...t,
        count: ranked.length,
        brands: new Set(ranked.map(p => p.brand_slug)).size,
        median, cheapest, dearest,
      };
    }),
  );

  return (
    <SiteLayout>
      <section className="max-w-site mx-auto px-6 py-12">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
          <Link href="/supplements" className="hover:text-ink transition-colors">Supplements</Link>
        </p>
        <h1 className="font-serif text-5xl md:text-7xl text-ink mb-6">Compare by unit price</h1>
        <p className="text-base md:text-lg text-ink-light max-w-2xl mb-12 leading-relaxed">
          A 250g tub and a 2.5kg tub are not comparable on the shelf price. These pages rank
          each type by what 100g actually costs, across every UK retailer we track.
        </p>

        <ul className="space-y-4">
          {rows.map(r => (
            <li key={r.slug}>
              <Link
                href={`/compare/${r.slug}`}
                className="group block bg-warm-white border border-border rounded-2xl p-6 hover:border-gold transition-colors"
              >
                <div className="font-serif text-2xl text-ink group-hover:text-gold transition-colors mb-1">
                  {r.label}
                </div>
                <p className="text-ink-light mb-3">{r.blurb}</p>
                {r.cheapest !== null && r.dearest !== null && (
                  <p className="text-sm text-ink-light">
                    {r.count} products from {r.brands} brands · £{r.cheapest.toFixed(2)} to
                    £{r.dearest.toFixed(2)} per 100g
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </SiteLayout>
  );
}
