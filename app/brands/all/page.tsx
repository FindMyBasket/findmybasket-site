import Link from 'next/link';
import { SiteLayout } from '../../../components/SiteLayout';
import { getBrandIndex } from '../../../lib/brand-queries';
import { socialTags } from '../../../lib/format/social-tags';

export const revalidate = 3600;

const title = 'All brands | FindMyBasket';
const description =
  'Every brand we compare prices for, A to Z, with the number of products stocked for each.';
const canonical = 'https://www.findmybasket.co.uk/brands/all';

export const metadata = {
  title,
  description,
  alternates: { canonical },
  ...socialTags({ title, description, url: canonical }),
};

// A-Z plus '#'. THE '#' BUCKET IS NOT DECORATIVE: 13 brand names begin with a digit or
// symbol -- '2btanned', '& honey', "o.p.i" -- and without it they would be rendered in
// no section, which is the failure a threshold was rejected for. Item 419.
const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

function bucketOf(name: string): string {
  const c = name.trim().charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
}

export default async function AllBrandsPage() {
  const brands = await getBrandIndex();

  // A SHORT INDEX LOOKS EXACTLY LIKE A COMPLETE ONE (item 420). The first build of this
  // page rendered 934 brands and ended at "I" because the RPC hit PostgREST's row cap,
  // and nothing reported it: an alphabetical list that stops early still reads as an
  // alphabetical list. The same failure shape as the sitemap's, which is why
  // lib/sitemap-brands.ts throws rather than emitting a brandless sitemap.
  //
  // The floor is deliberately far below today's 2,451 -- it is a truncation detector,
  // not a count assertion, and a count assertion would be the frozen-catalogue-state
  // mistake.
  if (brands.length < 1500) {
    throw new Error(
      `Brand index looks truncated: ${brands.length} brands. Expected thousands. ` +
        'Check fmb_brand_index() and the PostgREST row cap.',
    );
  }

  const buckets = new Map<string, typeof brands>();
  for (const b of brands) {
    const k = bucketOf(b.name);
    const arr = buckets.get(k) ?? [];
    arr.push(b);
    buckets.set(k, arr);
  }
  const present = LETTERS.filter(l => (buckets.get(l)?.length ?? 0) > 0);

  return (
    <SiteLayout>
      <section className="max-w-site mx-auto px-6 py-12">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
          <Link href="/brands" className="hover:text-ink transition-colors">Brands</Link>
        </p>
        <h1 className="font-serif text-5xl md:text-7xl text-ink mb-6">All brands</h1>
        <p className="text-base md:text-lg text-ink-light max-w-2xl mb-10 leading-relaxed">
          Every brand we compare prices for, with the number of products stocked. Counts
          are products currently in stock at one of our retailers.
        </p>

        {/* Letter jump. Anchors rather than pages: one URL, one crawl, and every brand
            stays on it -- which a per-letter paging scheme would also achieve, but at
            27 URLs for a page whose markup measures ~230 kB. Item 419. */}
        <nav aria-label="Jump to letter" className="flex flex-wrap gap-2 mb-12">
          {present.map(l => (
            <a
              key={l}
              href={`#letter-${l === '#' ? 'other' : l}`}
              className="px-3 py-1.5 rounded-full text-sm border border-border text-ink-light hover:border-gold hover:text-ink transition-colors"
            >
              {l}
            </a>
          ))}
        </nav>

        {present.map(l => (
          <div key={l} className="mb-12">
            <h2
              id={`letter-${l === '#' ? 'other' : l}`}
              className="font-serif text-3xl text-ink mb-6 scroll-mt-24"
            >
              {l}
            </h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2">
              {(buckets.get(l) ?? []).map(b => (
                <li key={b.slug}>
                  <Link
                    href={`/brands/${b.slug}`}
                    className="group flex items-baseline justify-between gap-3 py-1 border-b border-border/60 hover:border-gold transition-colors"
                  >
                    <span className="text-ink group-hover:text-gold transition-colors">
                      {b.name}
                    </span>
                    <span className="text-sm text-ink-light tabular-nums">{b.count.toLocaleString()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </SiteLayout>
  );
}
