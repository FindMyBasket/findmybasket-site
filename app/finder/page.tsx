import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteLayout } from '../../components/SiteLayout';
import {
  FINDER_CONCERNS,
  FINDER_INGREDIENTS,
  getFinderCount,
} from '../../lib/finder/taxonomy';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Find products by ingredient or concern | FindMyBasket',
  description:
    'Discover skincare and beauty products by skin concern or active ingredient across multiple UK retailers. From niacinamide to retinol, hydration to anti-ageing.',
  alternates: { canonical: 'https://www.findmybasket.co.uk/finder' },
};

function FinderChip({
  href,
  label,
  count,
}: {
  href: string;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-2 bg-warm-white border border-border rounded-full pl-5 pr-4 py-2.5 text-sm text-ink hover:border-gold hover:bg-cream transition-colors"
    >
      <span className="font-medium group-hover:text-gold transition-colors">{label}</span>
      <span className="text-ink-light text-xs">{count.toLocaleString()}</span>
    </Link>
  );
}

export default async function FinderPage() {
  // One full-text count per term. 40 calls at ISR/build time, in two parallel
  // batches. If this ever slows the build, collapse to a single fmb_finder_counts
  // RPC (one CTE round-trip) - not needed at this volume.
  const [concernCounts, ingredientCounts] = await Promise.all([
    Promise.all(FINDER_CONCERNS.map(c => getFinderCount(c.searchQuery))),
    Promise.all(FINDER_INGREDIENTS.map(i => getFinderCount(i.searchQuery))),
  ]);

  return (
    <SiteLayout>
      <section className="max-w-site mx-auto px-6 py-16 md:py-24 text-center">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
          Product Finder
        </p>
        <h1 className="font-serif text-5xl md:text-7xl text-ink mb-6">
          Find your products
        </h1>
        <p className="text-base md:text-lg text-ink-light max-w-2xl mx-auto leading-relaxed">
          Discover products by skin concern or active ingredient, compared across multiple
          UK retailers. Pick a starting point and we will show you what is out there.
        </p>
      </section>

      <section className="max-w-site mx-auto px-6 pb-12">
        <h2 className="font-serif text-3xl text-ink mb-2">Find by skin concern</h2>
        <p className="text-ink-light mb-8">
          What are you looking to address?
        </p>
        <div className="flex flex-wrap gap-2.5">
          {FINDER_CONCERNS.map((c, i) => (
            <FinderChip
              key={c.slug}
              href={`/search?q=${encodeURIComponent(c.searchQuery)}&from=finder`}
              label={c.label}
              count={concernCounts[i]}
            />
          ))}
        </div>
      </section>

      <section className="max-w-site mx-auto px-6 py-12">
        <h2 className="font-serif text-3xl text-ink mb-2">Find by active ingredient</h2>
        <p className="text-ink-light mb-8">
          Search the catalogue by the actives you care about.
        </p>
        <div className="flex flex-wrap gap-2.5">
          {FINDER_INGREDIENTS.map((ing, i) => (
            <FinderChip
              key={ing.slug}
              href={`/search?q=${encodeURIComponent(ing.searchQuery)}&from=finder`}
              label={ing.label}
              count={ingredientCounts[i]}
            />
          ))}
        </div>
      </section>
    </SiteLayout>
  );
}
