import Link from 'next/link';
import type { PerUnitProduct } from '../lib/unit-price';

/**
 * The ranked list for a /compare type page, shared by all of them.
 *
 * ONE COMPONENT, NOT THREE COPIES. Items 406, 407 and 417 were each a second copy of
 * one idea drifting from the first; three type pages each rendering their own row is
 * the same setup. Item 455.
 *
 * MOBILE FIRST, AND NOT AS A PREFERENCE. At 390px the row has 342px of content width.
 * A 56px thumbnail and its gap take 68, the per-100g figure needs ~76 to avoid
 * wrapping, and the rank needs 20 — leaving ~178px for the name. That is the binding
 * constraint, so the row was laid out at 390 first and the desktop row is the same
 * grid with the spare width given to the name. Designing desktop-first and shrinking
 * would have produced a row that only fits by truncating the one field a shopper
 * scans for.
 */
function sizeLabel(grams: number | null): string {
  if (!grams) return '';
  return grams >= 1000 ? `${grams / 1000}kg` : `${grams}g`;
}

function Thumb({ p }: { p: PerUnitProduct }) {
  // FALLBACK IS A BLOCK, NOT A BROKEN IMAGE. A missing image_url renders a neutral tile
  // at the same 56px so the row's grid never shifts between products.
  if (!p.image_url) {
    return (
      <div
        aria-hidden="true"
        className="w-14 h-14 shrink-0 rounded-lg bg-warm-white border border-border"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={p.image_url}
      alt=""
      loading="lazy"
      className="w-14 h-14 shrink-0 rounded-lg object-contain bg-white border border-border"
    />
  );
}

export function UnitPriceList({
  ranked,
  unranked,
  unrankedIntro,
}: {
  ranked: PerUnitProduct[];
  unranked: PerUnitProduct[];
  unrankedIntro: string;
}) {
  return (
    <>
      {/* list-none is set LOCALLY rather than in a global reset: the site's prose styles
          give ol/ul markers elsewhere and are wanted there. Item 455. */}
      <ol className="list-none pl-0 space-y-1 mb-16">
        {ranked.map((p, i) => (
          <li key={p.id} className="list-none">
            <Link
              href={`/product/${p.id}`}
              className="group flex items-center gap-3 py-3 border-b border-border/60 hover:border-gold transition-colors"
            >
              <span className="w-5 shrink-0 text-sm text-ink-light tabular-nums text-right">{i + 1}</span>
              <Thumb p={p} />
              <span className="flex-1 min-w-0">
                <span className="block text-ink group-hover:text-gold transition-colors line-clamp-2 leading-snug">
                  {p.name}
                </span>
                <span className="block text-xs text-ink-light mt-0.5">
                  {sizeLabel(p.grams)}
                  {p.grams ? ' · ' : ''}£{p.price.toFixed(2)}
                  {p.retailer_count > 1 ? ` · ${p.retailer_count} retailers` : ''}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-medium text-ink tabular-nums leading-none">
                  £{(p.per100g as number).toFixed(2)}
                </span>
                <span className="block text-[11px] text-ink-light mt-0.5">per 100g</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>

      {unranked.length > 0 && (
        <div className="border-t border-border pt-8">
          <h2 className="font-serif text-2xl text-ink mb-2">Not ranked</h2>
          <p className="text-ink-light mb-6 text-sm max-w-2xl">{unrankedIntro}</p>
          <ul className="list-none pl-0 space-y-2">
            {unranked.map(p => (
              <li key={p.id} className="list-none py-2 border-b border-border/40">
                <Link href={`/product/${p.id}`} className="text-ink hover:text-gold transition-colors">
                  {p.name}
                </Link>
                <span className="block text-sm text-ink-light">{p.excluded}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
