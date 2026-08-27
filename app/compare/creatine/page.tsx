import Link from 'next/link';
import { SiteLayout } from '../../../components/SiteLayout';
import { UnitPriceList } from '../../../components/UnitPriceList';
import { getTypeByUnitPrice } from '../../../lib/brand-queries';
import { COMMON_NOT_FUNGIBLE } from '../../../lib/unit-price';
import { socialTags } from '../../../lib/format/social-tags';

export const revalidate = 3600;

const title = 'Creatine price per 100g compared | FindMyBasket';
const description =
  'Every creatine monohydrate we track, ranked by price per 100g across UK retailers. The unit price, not the tub price.';
const canonical = 'https://www.findmybasket.co.uk/compare/creatine';

export const metadata = {
  title,
  description,
  alternates: { canonical },
  ...socialTags({ title, description, url: canonical }),
};

// WHAT THIS PAGE RANKS, AND WHY THE LIST IS NARROWER THAN "PRODUCTS CALLED CREATINE".
//
// Creatine monohydrate is the commodity: 20 of 74 rows say monohydrate outright, 5 say
// Creapure (a monohydrate brand), and the unstated remainder is monohydrate by default
// because it is what the category means. Those are genuinely interchangeable and 100g
// of one is 100g of another.
//
// THREE THINGS CARRY THE WORD AND ARE NOT THAT, and ranking them on price per 100g
// would be arithmetic without a comparison behind it:
//   - Creatine HCl. A different salt, dosed at roughly 1-2g against monohydrate's 3-5g,
//     so per-gram price says the opposite of per-dose price. One row.
//   - Blends -- "Creatine+ Collagen+ Electrolytes", "Creatine And Magnesium". Most of
//     the 100g is not creatine. Four rows.
//   - Gummies. 100g of gummy is mostly sugar and gelatin. Two rows.
// Item 443.
const NOT_FUNGIBLE = [
  ...COMMON_NOT_FUNGIBLE,
  {
    test: /\b(hcl|hydrochloride|ethyl ester|kre-?alkalyn|nitrate|magnapower|gluconate)\b/i,
    reason: 'a different creatine salt, dosed differently from monohydrate — price per 100g is not a like-for-like comparison',
  },
  {
    test: /\b(gummies|gummy|chewable)\b/i,
    reason: 'gummies rather than powder — most of the weight is not creatine',
  },
  {
    test: /(\bcreatine\s*\+|\+\s*creatine|\bcreatine and\b|\bplatinum creatine plus\b|\bcreatine\s*&|&\s*creatine)/i,
    reason: 'a blend rather than pure creatine — most of the weight is other ingredients',
  },
];

export default async function CreatinePage() {
  const { ranked, unranked, median } = await getTypeByUnitPrice('creatine', {
    notFungible: NOT_FUNGIBLE,
  });

  return (
    <SiteLayout>
      <section className="max-w-site mx-auto px-6 py-12">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
          <Link href="/supplements" className="hover:text-ink transition-colors">Supplements</Link>
        </p>
        <h1 className="font-serif text-5xl md:text-7xl text-ink mb-6">Creatine by price per 100g</h1>
        <p className="text-base md:text-lg text-ink-light max-w-2xl mb-4 leading-relaxed">
          Creatine monohydrate is the same substance whoever sells it, and it is sold in tubs
          from 100g to 2.5kg. This ranks every one we track by what 100g actually costs.
        </p>
        {median !== null && (
          <p className="text-ink-light mb-10">
            {ranked.length} products from {new Set(ranked.map(p => p.brand_slug)).size} brands.
            Median £{median.toFixed(2)} per 100g.
          </p>
        )}

        <UnitPriceList
          ranked={ranked}
          unranked={unranked}
          unrankedIntro="These carry the word creatine but do not belong in a price-per-100g ranking against monohydrate powder. They are listed rather than hidden, with the reason."
        />

      </section>
    </SiteLayout>
  );
}
