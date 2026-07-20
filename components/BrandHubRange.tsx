'use client';

import { useMemo, useState } from 'react';
import type { BrandHubOffer, BrandHubProduct } from '../lib/brand-hub-queries';

interface Props {
  products: BrandHubProduct[];
  rangeSub: string | null;
  offer: BrandHubOffer | null; // already filtered to a live offer (or null)
}

const ALL = 'All';

// Pull a "15%"-style figure out of the offer copy for the seal. Falls back to no
// seal when there is no percentage to show (the offer copy still renders).
function offerPercent(offer: BrandHubOffer): string | null {
  const m = `${offer.headline} ${offer.body}`.match(/(\d{1,2})\s*%/);
  return m ? `${m[1]}%` : null;
}

const ARROW = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export function BrandHubRange({ products, rangeSub, offer }: Props) {
  // Category tabs in first-appearance order (products are already sort_order'd).
  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const p of products) {
      if (p.category && !seen.includes(p.category)) seen.push(p.category);
    }
    return [ALL, ...seen];
  }, [products]);

  const [active, setActive] = useState(ALL);

  const visible = active === ALL ? products : products.filter((p) => p.category === active);
  const seal = offer ? offerPercent(offer) : null;

  return (
    <div className="bh-range" id="range">
      <div className="bh-range-head">
        <h2 className="bh-serif">The range</h2>
      </div>
      {rangeSub && <p className="bh-range-sub">{rangeSub}</p>}

      {categories.length > 1 && (
        <div className="bh-concerns" role="tablist" aria-label="Filter the range">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={active === c}
              className={`bh-concern${active === c ? ' is-on' : ''}`}
              onClick={() => setActive(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="bh-grid">
        {visible.map((p) => (
          <article className="bh-card" key={p.id}>
            <div className="bh-thumb">
              {p.image_path && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image_path} alt={p.name} loading="lazy" />
              )}
            </div>
            <div className="bh-body">
              {p.category && <span className="bh-cat">{p.category}</span>}
              <h4>{p.name}</h4>
              {p.benefit_tags && <span className="bh-tags">{p.benefit_tags}</span>}
              {p.volume && <span className="bh-vol">{p.volume}</span>}
              {p.description && <p className="bh-desc">{p.description}</p>}
              <div className="bh-foot">
                {p.price != null && <span className="bh-price">£{p.price.toFixed(2)}</span>}
                {/* A card can point either at the brand (outbound, affiliate)
                    or at our own comparison page for that product, depending on
                    whether we carry the brand for comparison. Internal
                    destinations must never get sponsored/nofollow: that would
                    mark our own comparison pages as paid placement and drop the
                    internal link equity. */}
                {p.buy_url &&
                  (p.buy_url.startsWith('/') ? (
                    <a className="bh-go" href={p.buy_url}>
                      Compare prices →
                    </a>
                  ) : (
                    <a
                      className="bh-go"
                      href={p.buy_url}
                      target="_blank"
                      rel="sponsored nofollow noopener"
                    >
                      Buy direct →
                    </a>
                  ))}
              </div>
            </div>
          </article>
        ))}
      </div>

      {offer && (
        <div className="bh-offer" id="offer">
          <div className="bh-offer-txt">
            {seal && (
              <div className="bh-seal">
                {seal}
                <small>OFF</small>
              </div>
            )}
            <div>
              <h3 className="bh-serif">{offer.headline}</h3>
              <p>
                Use code <span className="bh-code">{offer.code}</span> {offer.body}
              </p>
            </div>
          </div>
          {offer.cta_url && (
            <a className="bh-btn bh-btn-gold" href={offer.cta_url} target="_blank" rel="sponsored nofollow noopener">
              Shop with {offer.code} {ARROW}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
