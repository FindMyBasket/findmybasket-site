import Link from 'next/link';
import { SiteLayout } from '../../../components/SiteLayout';
import { getTypeByUnitPrice } from '../../../lib/brand-queries';
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

export default async function WheyProteinPage() {
  const { ranked, unranked, median } = await getTypeByUnitPrice('whey');

  // A TYPE PAGE IS ONLY HONEST WHERE THE TYPE IS FUNGIBLE. Whey qualifies: 100g of whey
  // is 100g of whey whoever sells it, and the source is stated in the name when it is
  // not whey. Collagen deliberately has no page -- 144 of 190 rows state no source, so
  // ranking marine against unspecified would compare on price alone (item 441).
  return (
    <SiteLayout>
      <section className="max-w-site mx-auto px-6 py-12">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
          <Link href="/supplements" className="hover:text-ink transition-colors">Supplements</Link>
        </p>
        <h1 className="font-serif text-5xl md:text-7xl text-ink mb-6">Whey protein by price per 100g</h1>
        <p className="text-base md:text-lg text-ink-light max-w-2xl mb-4 leading-relaxed">
          Protein powder is sold in tubs of different sizes, so the shelf price says little
          about value. This ranks every whey protein we track by what 100g actually costs.
        </p>
        {median !== null && (
          <p className="text-ink-light mb-10">
            {ranked.length} products from {new Set(ranked.map(p => p.brand_slug)).size} brands.
            Median £{median.toFixed(2)} per 100g.
          </p>
        )}

        <ol className="space-y-2 mb-16">
          {ranked.map((p, i) => (
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

        {/* NOT DROPPED. A page that silently omits what it cannot price is incomplete in a
            way the visitor cannot see -- the argument that rejected a product threshold on
            the brand index. Each carries its own reason. Item 441. */}
        {unranked.length > 0 && (
          <div className="border-t border-border pt-8">
            <h2 className="font-serif text-2xl text-ink mb-2">Not ranked</h2>
            <p className="text-ink-light mb-6 text-sm max-w-2xl">
              These are whey proteins we track but cannot place in the ranking. They are listed
              rather than hidden, with the reason.
            </p>
            <ul className="space-y-2">
              {unranked.map(p => (
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
