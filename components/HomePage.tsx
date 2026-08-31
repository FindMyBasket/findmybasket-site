import Link from 'next/link';
import { SiteLayout } from './SiteLayout';
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
      <div className="fmb-home">
      {/* ── HERO ─────────────────────────────────────────────────────────────
          A PLAIN GET FORM TO /search, NOT SiteSearch. Measured on the preview: SiteSearch
          renders a BUTTON, and its <input> exists only inside a dropdown once `open` is
          true. Mounting it here would have put a second trigger on the first screen — the
          same click-to-reach-the-mechanic the static hero's CTA already was, which is the
          exact thing this change exists to remove.
          
          It would also have collided: the panel is `fixed left-4 right-4 top-16` on mobile,
          anchored to the VIEWPORT rather than its trigger, so two mounts open two panels in
          one place.
          
          A form needs no hydration, works with JavaScript off, and puts a REAL FIELD at the
          top of the page. `from=homepage_hero` so the existing SearchEventTracker can tell
          this entry point apart. The nav's SiteSearch is untouched. Item 513.

          IT SHIPPED UNSTYLED AND THAT WAS NOT AN OMISSION HERE EITHER. public/index.html
          carried a full rule set for this field — pill radius, warm-white fill, gold focus
          ring — and the port dropped it, like everything else without a number attached.
          Item 520. */}
      <section className="relative overflow-hidden">
        <div className="fmb-hero-bg" aria-hidden="true" />
        <div className="relative max-w-site mx-auto px-6 pt-10 pb-12 md:pt-16">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
          Compare across UK retailers · delivery included
        </p>
        {/* THE AMPERSAND IS IN THE h1 AND NOWHERE ELSE. The route's <title> and og:title
            are `Health & Beauty Price Comparison UK | FindMyBasket` — they do not carry
            the tagline at all, so item 495's 78-against-88 measurement is untouched by
            this. That figure belongs to public/index.html's og:title, which has not been
            served since item 515 redirected the file.

            THE ITALIC IS RESTORED AND THE FONT LOADER CHANGED WITH IT. `not-italic` was
            cancelling a style the static page set deliberately; removing it alone would
            have produced a synthesised oblique, because no italic face was being loaded.
            See app/layout.tsx. Item 525. */}
        <h1 className="font-serif text-4xl md:text-6xl text-ink leading-tight mb-4">
          Your health &amp; beauty<br />routine. <em className="text-gold">Optimised.</em>
        </h1>
        <p className="text-base md:text-lg text-ink-light max-w-xl mb-7 leading-relaxed">
          Honest comparison across multiple UK health and beauty retailers, with each
          retailer&rsquo;s own delivery terms in the total.
        </p>

        {/* TWO PILLS AND A GAP, WHICH IS public/index.html's `.hero-form`, NOT A WRAPPER
            WITH A FIELD INSIDE IT. `padding: 16px 24px; border: 1px solid var(--border);
            border-radius: 100px; background: var(--warm-white)` on the input itself, and
            `.btn-primary` beside it. Item 523.

            `font-[inherit]`, NOT `font-sans`. Without Preflight an <input> does not
            inherit font-family — measured: the placeholder rendered in Arial — and
            `font-sans` resolves to the literal "DM Sans", which is NOT what next/font
            loaded it as. `inherit` takes the body's `var(--font-dm-sans)` and cannot drift
            from it.

            `min-w-0` ON THE INPUT SO THE ROW NEVER WRAPS. At 390 the column is 342px and
            a wrapped button costs ~66px of a budget that has 4px in it.

            THE FOCUS RING IS THE POINT, NOT AN EXTRA. `outline-none` on its own removes
            the only keyboard indicator the field has; the static page replaced it with
            `border-color: gold` plus a 4px gold ring, and so does this. */}
        <form action="/search" method="get" className="flex gap-3 max-w-2xl mb-4">
          <input type="hidden" name="from" value="homepage_hero" />
          <input
            type="text"
            name="q"
            required
            minLength={2}
            placeholder="Search products and brands…"
            aria-label="Search products and brands"
            className="flex-1 min-w-0 appearance-none rounded-full border border-border bg-warm-white
                       px-5 md:px-6 py-4 font-[inherit] text-[15px] text-ink outline-none
                       placeholder:text-[#AAA8A4] transition-[border-color,box-shadow] duration-200
                       focus:border-gold focus:shadow-[0_0_0_4px_rgba(201,169,110,0.12)]"
          />
          <button
            type="submit"
            className="shrink-0 appearance-none rounded-full bg-ink px-6 md:px-8 py-4 font-[inherit]
                       text-[15px] font-medium text-cream transition-[background-color,transform]
                       duration-200 hover:bg-gold hover:-translate-y-0.5"
          >
            Search
          </button>
        </form>

        <p className="text-sm text-ink-light">
            or{' '}
            <Link href="/app" className="text-ink underline underline-offset-4 hover:text-gold transition-colors">
              build your whole routine
            </Link>{' '}
            — free, no account needed.
          </p>
        </div>
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

      {/* ── THE DEMO — the only block that shows rather than tells ──────────────
          RESTYLED, NOT REBUILT. Item 520. Same section, same copy, same artefact
          fields — `products[]`, `best`, `worse`, `gap` are all `lib/homepage-demo.json`
          carries and nothing below asks for a field that does not exist.

          THE STYLING IS public/index.html's OWN, TRANSLATED. The static page this
          replaced had `.demo-basket.best` in a gold border over a gold/8% fill with a
          BEST corner tag, `.basket-price` in serif `--gold-text`, and `.basket-saving`
          in sage. The port carried the content and dropped all of it. These are that
          rule set in Tailwind, not a new direction.

          TWO SUB-LABELS RESTORED. "Whole routine, delivery included" and "Each item at
          its best price" are `.basket-items` from the static page, dropped in the same
          port. Without them the block is two numbers; with them it is a comparison.

          `list-none p-0 m-0` IS A SCOPED RESET, AND IT IS LOAD-BEARING. app/globals.css
          has no `@tailwind base`, so Preflight never runs and a bare <ul> keeps the
          user-agent's `list-style: disc` and 40px indent — which is why this block
          rendered as a bullet list. Item 521 carries the site-wide fix; this does not
          depend on it landing.

          AND THE BORDERS ONLY DRAW BECAUSE OF `.fmb-demo`. With no Preflight, Tailwind's
          `.border` sets a width and no style, so all 86 `border-border` classes on this
          site draw NOTHING — the cards that look bordered are warm-white on cream. The
          scoped reset in app/globals.css is what makes this block's borders real, and it
          resets WIDTH AND STYLE TOGETHER on purpose. Read that comment before touching
          this class: the first attempt set the style alone, which turns four sides on
          while a `border-t` sets the width of one, and the footer rule rendered
          `1px 3px 3px 3px` — a box where a hairline was intended. Item 521 is the
          site-wide fix.

          THE ROUTINE ROWS USE `max-md:` RATHER THAN `divide-y`, AND THAT IS NOT A STYLE
          PREFERENCE. `divide-y` compiles to `.divide-y > :not([hidden]) ~ :not([hidden])`
          — two classes, so it outranks the single-class `md:border` on the row, and
          `md:divide-y-0` was zeroing the top and bottom of every tile but the first at
          desktop. Measured `0px 1px 0px 1px`. `max-md:` and `md:` cannot both apply, so
          the two treatments never compete.

          COMPACTED FOR MOBILE, DELIBERATELY, IN TWO PASSES. The first build of this block
          took 390x844 from 3.53 screens to 3.72; the second, to 3.59. The whole
          justification for this route is 11.82 -> 3.53, so padding was cut rather than the
          regression reported. Two levers, in order of size: the routine renders as ONE
          divided container on mobile and only becomes three separate tiles at md, because
          three bordered boxes cost ~70px of vertical that a divided list does not; then
          every mobile padding step went down one notch. EVERY md: VALUE IS UNTOUCHED —
          the screen budget is a mobile constraint and desktop should not pay for it.

          gold-text (#8A6A30) FOR THE PRICE, NOT gold (#C9A96E). gold on warm-white is
          about 2.1:1. The palette already separates the two for exactly this reason. */}
      <section className="max-w-site mx-auto px-6 py-6 md:py-12">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-2 md:mb-3">See it in action</p>
        {demo.kind === 'demo' ? (
          <>
            <h2 className="font-serif text-2xl md:text-3xl text-ink mb-4 md:mb-6">
              A real routine, priced two ways
            </h2>
            <div className="rounded-2xl border border-border bg-warm-white p-3.5 md:p-8">
              <p className="text-[11px] uppercase tracking-widest text-gold font-medium mb-2 md:mb-3">
                Your routine
              </p>
              <ul
                className="list-none p-0 m-0 mb-3 md:mb-6 rounded-xl border border-border bg-cream
                           md:grid md:grid-cols-3 md:gap-3 md:rounded-none md:border-0
                           md:bg-transparent"
              >
                {demo.products.map(p => (
                  <li
                    key={p.name}
                    className="px-3.5 py-2 max-md:border-t max-md:border-border
                               max-md:first:border-t-0 md:px-4 md:py-3 md:rounded-xl
                               md:border md:border-border md:bg-cream"
                  >
                    <div className="text-[13px] font-medium text-ink leading-snug">{p.brand}</div>
                    <div className="text-[11px] text-ink-light leading-tight mt-0.5">{p.name}</div>
                  </li>
                ))}
              </ul>

              {/* THE WINNER. One retailer, so one delivery charge — which is the whole
                  point, and the retailer names carry it without a word of new copy. */}
              <div className="relative overflow-hidden rounded-xl border border-gold/40 bg-gold/[0.08] px-4 py-2.5 md:px-6 md:py-4 mb-1.5">
                <span className="absolute top-0 right-0 bg-gold text-ink text-[10px] font-bold tracking-widest px-3 py-1 rounded-bl-xl">
                  BEST
                </span>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-4 pr-14 sm:pr-0">
                  <div>
                    <div className="text-[15px] font-medium text-ink">{demo.best.retailer}</div>
                    <div className="text-[13px] text-ink-light mt-0.5">Whole routine, delivery included</div>
                  </div>
                  <div className="font-serif text-3xl text-gold-text leading-none shrink-0">
                    {money(demo.best.delivered)}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-cream px-4 py-2.5 md:px-6 md:py-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-4">
                  <div>
                    <div className="text-[15px] font-medium text-ink">{demo.worse.retailer}</div>
                    <div className="text-[13px] text-ink-light mt-0.5">Each item at its best price</div>
                  </div>
                  <div className="sm:text-right shrink-0">
                    <div className="font-serif text-3xl text-ink-light leading-none">
                      {money(demo.worse.delivered)}
                    </div>
                    <div className="text-[12px] text-sage mt-1">{money(demo.gap)} more, delivered</div>
                  </div>
                </div>
              </div>

              <p className="mt-3 pt-2.5 md:mt-5 md:pt-4 border-t border-border text-sm text-ink-light">
                Same products. <strong className="text-ink font-medium">{money(demo.gap)}</strong> apart
                once delivery is counted.
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

      {/* ── THE TRUST PAIR — #why 4 and 5. Neither is a feature. ──────────────
          CARDS, USING THE VOCABULARY THE REST OF THE SITE ALREADY WRITES DOWN:
          `rounded-2xl border border-border` on a tinted band, which is BrandPage,
          CategoryPage, ProductCard and SubcategoryPage verbatim. It renders here
          only because `.fmb-home` resets border-width AND border-style; site-wide
          it still does not, which is item 521 and not this.

          `md:` ONLY, AND THAT IS AN ARGUMENT RATHER THAN A TRIM. A card is a device
          for structuring HORIZONTAL space, and at 390 there is none to structure —
          every block is already full width and the tinted band already separates
          this one. Robbie's complaint was explicitly "from screenshots at desktop":
          584px of text in a 1,200px column. Carding it on mobile buys a border and
          two paddings for no hierarchy, and costs 80px of a screen budget. Same
          reasoning as the routine list's `max-md:` rows. Item 524. */}
      <section className="bg-warm-white border-y border-border">
        <div className="max-w-site mx-auto px-6 py-12 grid gap-8 md:gap-6 md:grid-cols-2">
          <div className="md:rounded-2xl md:border md:border-border md:bg-cream md:p-8">
            <h2 className="font-serif text-xl text-ink mb-2">Completely free to use</h2>
            <p className="text-sm text-ink-light leading-relaxed">
              Free for everyone, always. We earn a small affiliate commission when you click
              through and buy, at no extra cost to you.
            </p>
          </div>
          <div className="md:rounded-2xl md:border md:border-border md:bg-cream md:p-8">
            <h2 className="font-serif text-xl text-ink mb-2">Honest pricing</h2>
            <p className="text-sm text-ink-light leading-relaxed">
              We pull prices directly from each retailer&rsquo;s official feed. Sometimes the
              live page is better still at checkout. We&rsquo;ll never overstate a saving.
            </p>
          </div>
        </div>
      </section>

      {/* ── ONE CTA — the duplicated pair merged ────────────────────────────── */}
      <section className="max-w-site mx-auto px-6 py-12 md:py-14">
        <div className="text-center md:rounded-2xl md:border md:border-border md:bg-warm-white md:px-6 md:py-14">
          <h2 className="font-serif text-2xl md:text-3xl text-ink mb-3">
            Save your routine. We&rsquo;ll find the best price each month.
          </h2>
          <p className="text-ink-light mb-6">Free to use. No account needed.</p>
          <Link
            href="/app"
            className="inline-block bg-ink text-cream px-8 py-4 rounded-full text-sm no-underline transition-[background-color,transform] duration-200 hover:bg-gold hover:-translate-y-0.5"
          >
            Build your routine →
          </Link>
        </div>
      </section>
      </div>
    </SiteLayout>
  );
}
