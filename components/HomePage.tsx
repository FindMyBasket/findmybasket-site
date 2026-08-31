import Link from 'next/link';
import { SiteLayout } from './SiteLayout';
import { SiteSearch } from './SiteSearch';
import { homepageDemo as demo } from '../lib/homepage-demo';

const money = (n: number) => `£${n.toFixed(2)}`;

/**
 * THE HOMEPAGE. Item 513.
 *
 * MEASURED BEFORE IT WAS TOUCHED. The static page was 9,978px at 390x844 — 11.82 screens —
 * with the entire first screen taken by the hero and the first functional block at 1,581px.
 * The category roots went from 3.68 screens to 1.19 by demotion; this was three times worse
 * than they were before that work, on the surface a shared link lands on.
 *
 * WHAT SURVIVED THE READ, AND WHY EACH DID:
 *
 *  - HOW IT WORKS was proposed for folding into the hero and is the ONLY place the mechanic
 *    is stated: "the best value 1 or 2 retailer split for your whole routine". Folding it in
 *    would have deleted the proposition to save pixels. It is compressed — 1,502px was too
 *    much for three sentences — and the three sentences are intact.
 *
 *  - THE DEMO shows rather than tells, which was only established by loading production: the
 *    repo carried a generated FALLBACK and the deployed page carried a real solved basket.
 *    It is the one block that demonstrates the mechanism.
 *
 *  - THE TRUST PAIR is #why cards 4 and 5, and neither is a feature. A stranger arriving from
 *    a shared link has no reason to believe the prices; free-with-the-model-stated and
 *    feeds-not-scrapes are the only answer on the page. Cards 1, 3 and 6 restated
 *    how-it-works or stated scope, and the redundancy was BETWEEN blocks rather than inside
 *    either — which is why assessing either alone found each internally coherent.
 *
 * WHAT WENT, AND WHY:
 *  - #roadmap, 2,026px, argued for a positioning item 495 moved into the tagline (item 514).
 *  - #why 1, 3, 6.
 *  - one of two save-routine blocks carrying the SAME headline, 620px and 555px, four
 *    screens apart.
 *
 * THE FIRST SCREEN GETS A SEARCH BOX. The static hero's form was a CTA button to /app — a
 * link to the mechanic, not the mechanic. A builder is a commitment and a search is not, and
 * a shared link lands on a stranger.
 */
export function HomePage() {
  return (
    <SiteLayout>
      {/* ── HERO ─────────────────────────────────────────────────────────────
          SiteSearch is mounted HERE and the nav's instance is untouched. Two mounts
          rather than a lifted shared instance: the second is simpler and the cost is a
          duplicate typeahead request, which only occurs if someone types in both. */}
      <section className="max-w-site mx-auto px-6 pt-10 pb-12 md:pt-16">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
          Compare across UK retailers · delivery included
        </p>
        <h1 className="font-serif text-4xl md:text-6xl text-ink leading-tight mb-4">
          Your health and beauty<br />routine. <em className="text-gold not-italic">Optimised.</em>
        </h1>
        <p className="text-base md:text-lg text-ink-light max-w-xl mb-7 leading-relaxed">
          Honest comparison across multiple UK health and beauty retailers, with each
          retailer&rsquo;s own delivery terms in the total.
        </p>

        <div className="max-w-xl mb-4">
          <SiteSearch />
        </div>

        <p className="text-sm text-ink-light">
          or{' '}
          <Link href="/app" className="text-ink underline underline-offset-4 hover:text-gold transition-colors">
            build your whole routine
          </Link>{' '}
          — free, no account needed.
        </p>
      </section>

      {/* ── HOW IT WORKS — compressed, three sentences intact ───────────────── */}
      <section className="bg-warm-white border-y border-border">
        <div className="max-w-site mx-auto px-6 py-12">
          <div className="grid gap-8 md:grid-cols-3">
            {[
              ['Build your routine', 'Search and add the products you actually buy — skincare, makeup, hair, fragrance, bath & body, supplements.'],
              ['We compare the prices', 'Live prices across multiple UK retailers, including each one’s delivery thresholds.'],
              ['Shop your optimal basket', 'We work out the best value one or two retailer split for the whole routine, and show what it saves.'],
            ].map(([h, p], i) => (
              <div key={h}>
                <div className="text-xs font-medium text-gold mb-2">0{i + 1}</div>
                <h2 className="font-serif text-xl text-ink mb-2">{h}</h2>
                <p className="text-sm text-ink-light leading-relaxed">{p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── THE DEMO — the only block that shows rather than tells ──────────── */}
      <section className="max-w-site mx-auto px-6 py-12">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-3">See it in action</p>
        {demo.kind === 'demo' ? (
          <>
            <h2 className="font-serif text-2xl md:text-3xl text-ink mb-6">
              A real routine, priced two ways
            </h2>
            <div className="rounded-2xl border border-border bg-warm-white p-6">
              <ul className="mb-6 space-y-1">
                {demo.products.map(p => (
                  <li key={p.name} className="text-sm text-ink-light">
                    <span className="text-ink">{p.brand}</span> — {p.name}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-6">
                <div>
                  <div className="text-xs uppercase tracking-widest text-gold mb-1">Best value, delivered</div>
                  <div className="font-serif text-2xl text-ink">{money(demo.best.delivered)}</div>
                  <div className="text-sm text-ink-light">{demo.best.retailer}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-ink-light mb-1">Cheapest goods, delivered</div>
                  <div className="font-serif text-2xl text-ink-light">{money(demo.worse.delivered)}</div>
                  <div className="text-sm text-ink-light">{demo.worse.retailer}</div>
                </div>
              </div>
              <p className="mt-5 text-sm text-ink-light">
                Same products. <strong className="text-ink">{money(demo.gap)}</strong> apart once
                delivery is counted.
              </p>
            </div>
          </>
        ) : (
          /* THE FALLBACK, CARRIED ACROSS UNCHANGED. A hero showing a "best" basket that is no
             longer best is worse than one that is merely stale — the decision recorded in
             scripts/generate-homepage-demo.mjs, and not reopened by this layout change. */
          <>
            <h2 className="font-serif text-2xl md:text-3xl text-ink mb-4">
              Your whole routine, priced properly
            </h2>
            <p className="text-base text-ink-light max-w-2xl leading-relaxed mb-3">
              Most comparison tools answer one question: where is this one product at its best
              price? A routine is not one product. It is a basket, and a basket has a delivery
              cost that depends on how you group it.
            </p>
            <p className="text-base text-ink-light max-w-2xl leading-relaxed">
              FindMyBasket works out the best value way to buy your whole routine across
              multiple UK retailers, with delivery charges and free delivery thresholds
              included in the answer. Sometimes that means one retailer. Sometimes two. It is
              the delivered total that decides.
            </p>
          </>
        )}
      </section>

      {/* ── THE TRUST PAIR — #why 4 and 5. Neither is a feature. ────────────── */}
      <section className="bg-warm-white border-y border-border">
        <div className="max-w-site mx-auto px-6 py-12 grid gap-8 md:grid-cols-2">
          <div>
            <h2 className="font-serif text-xl text-ink mb-2">Completely free to use</h2>
            <p className="text-sm text-ink-light leading-relaxed">
              Free for everyone, always. We earn a small affiliate commission when you click
              through and buy, at no extra cost to you.
            </p>
          </div>
          <div>
            <h2 className="font-serif text-xl text-ink mb-2">Honest pricing</h2>
            <p className="text-sm text-ink-light leading-relaxed">
              We pull prices directly from each retailer&rsquo;s official feed. Sometimes the
              live page is better still at checkout. We&rsquo;ll never overstate a saving.
            </p>
          </div>
        </div>
      </section>

      {/* ── ONE CTA — the duplicated pair merged ────────────────────────────── */}
      <section className="max-w-site mx-auto px-6 py-14 text-center">
        <h2 className="font-serif text-2xl md:text-3xl text-ink mb-3">
          Save your routine. We&rsquo;ll find the best price each month.
        </h2>
        <p className="text-ink-light mb-6">Free to use. No account needed.</p>
        <Link
          href="/app"
          className="inline-block bg-ink text-cream px-8 py-4 rounded-full font-sans text-sm no-underline hover:bg-gold transition-colors"
        >
          Build your routine →
        </Link>
      </section>
    </SiteLayout>
  );
}
