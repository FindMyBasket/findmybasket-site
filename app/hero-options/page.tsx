import { supabase } from '../../lib/supabase';

export const revalidate = 0;

export const metadata = {
  title: 'Hero proof options — FindMyBasket',
  robots: { index: false, follow: false },
};

/**
 * A TEMPORARY DECISION AID, NOT A SURFACE. Item 527.
 *
 * The retailer logo strip was cut from the homepage by item 513. It was 243px and 29% of
 * the first screen at 390x844, and cutting it was right on the fold budget. It was also
 * the only proof on the page that the site carries anything, and the demo that answers
 * the question better sits at 1,165px — so the proof moved below the fold rather than
 * being replaced on it.
 *
 * This page renders the four options at their real width so the choice is made from a
 * picture. DELETE IT WITH THE DECISION.
 *
 * THE LIST IS QUERIED, NOT TYPED. public/index.html's strip is hand-maintained and has
 * needed three manual corrections in six weeks — Superdrug removed 27 Jul, Atelier De
 * Glow 19 Aug, Healf added 30 Aug — each one its own copy sweep. Whatever is chosen
 * here should be derived the same way this is, or it inherits that maintenance.
 */

const LOGO: Record<string, string> = {
  'Boots': 'boots.webp',
  'Debenhams': 'debenhams.png',
  'YesStyle': 'yesstyle.png',
  'Stylevana': 'stylevana.webp',
  'Perfume Click': 'perfume-click.webp',
  'Niche Beauty': 'niche-beauty.png',
  'Beauty Flash': 'beauty-flash.png',
  'Gorgeous Shop': 'gorgeous-shop.webp',
  'Beauty Bay': 'beauty-bay.webp',
  'Escentual': 'escentual.webp',
  'Healf': 'healf.png',
  'MyProtein': 'myprotein.png',
  'The Organic Pharmacy': 'the-organic-pharmacy.webp',
};

// Legibility at 14-15px is not the same ordering as catalogue size. Boots, YesStyle and
// Stylevana have marks that disappear at this height; these five do not. Measured by
// looking, which is the only instrument for it.
const LEGIBLE = ['Debenhams', 'Beauty Bay', 'Escentual', 'Perfume Click', 'Healf'];

async function liveRetailers() {
  // active = true AND not unlisted. Both are required: Superdrug is active=false with
  // 9,375 rows still in the table, and Branded Beauty carried an unlisted_reason while
  // still active. Either test alone has a hole.
  const { data } = await supabase
    .from('retailers')
    .select('name, active, unlisted_reason')
    .eq('active', true)
    .is('unlisted_reason', null)
    .order('name');
  return (data ?? []).map(r => r.name as string).filter(n => LOGO[n]);
}

function Frame({ label, cost, children }: { label: string; cost: string; children: React.ReactNode }) {
  return (
    <div className="shrink-0">
      <div className="mb-2">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        <div className="text-[12px] text-ink-light">{cost}</div>
      </div>
      <div className="w-[390px] max-w-full border border-border rounded-xl overflow-hidden bg-cream">
        <div className="px-6 pt-8 pb-8">{children}</div>
      </div>
    </div>
  );
}

function Hero({ proof }: { proof?: React.ReactNode }) {
  return (
    <>
      <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">
        Compare across UK retailers · delivery included
      </p>
      <h1 className="font-serif font-semibold text-4xl text-ink leading-tight mb-4">
        Your health &amp; beauty<br />routine. <em className="text-gold">Optimised.</em>
      </h1>
      <p className="text-base text-ink-light mb-7 leading-relaxed">
        Honest comparison across multiple UK health and beauty retailers, with each
        retailer&rsquo;s own delivery terms in the total.
      </p>
      <div className="flex gap-3 mb-4">
        <div className="flex-1 min-w-0 rounded-full border border-border bg-warm-white px-5 py-4 text-[15px] text-[#AAA8A4]">
          Search products and brands…
        </div>
        <div className="shrink-0 rounded-full bg-ink px-6 py-4 text-[15px] font-medium text-cream">Search</div>
      </div>
      <p className="text-sm text-ink-light">
        or <span className="text-ink underline underline-offset-4">build your whole routine</span> — free, no account needed.
      </p>
      {proof}
    </>
  );
}

function Label({ n }: { n: number }) {
  return (
    <span className="block text-[10px] uppercase tracking-[0.12em] text-gold-text font-medium mb-2">
      Comparing across {n} UK retailers
    </span>
  );
}

export default async function HeroOptions() {
  const names = await liveRetailers();
  const n = names.length;
  const five = LEGIBLE.filter(x => names.includes(x));

  return (
    <main className="fmb-home min-h-screen bg-warm-white px-6 py-10">
      <div className="max-w-site mx-auto mb-8">
        <h2 className="font-serif font-semibold text-3xl text-ink mb-2">Hero proof: four options at 390</h2>
        <p className="text-sm text-ink-light max-w-2xl leading-relaxed">
          The page is <strong className="text-ink font-medium">2,953px / 3.50 screens</strong> at 390×844 today.
          Costs below are measured on the live page, not projected. The old strip was{' '}
          <strong className="text-ink font-medium">+245px</strong> — reproduced and re-measured, which independently
          confirms the 243 on record.
        </p>
      </div>

      <div className="max-w-site mx-auto flex flex-col lg:flex-row gap-8 lg:overflow-x-auto pb-6">
        <Frame label="D · nothing" cost="+0px — 3.50 screens">
          <Hero />
        </Frame>

        <Frame label="A · names, hero type" cost="+80px — 3.59 screens">
          <Hero proof={
            <div className="mt-4">
              <Label n={n} />
              <p className="m-0 text-[12px] leading-[1.7] text-ink-light">{names.join(' · ')}</p>
            </div>
          } />
        </Frame>

        <Frame label="B · logos, one row, no wrap" cost="+55px — 3.56 screens · only 3 of 5 marks fit">
          <Hero proof={
            <div className="mt-4">
              <Label n={n} />
              <div className="flex flex-nowrap items-center gap-1.5 overflow-hidden">
                {five.map(name => (
                  <span key={name} className="shrink-0 inline-flex items-center justify-center h-[30px] px-2 bg-white border border-border rounded-[9px]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/logos/${LOGO[name]}`} alt={name} className="h-[14px] w-auto object-contain block" />
                  </span>
                ))}
                <span className="shrink-0 text-[11px] text-ink-light whitespace-nowrap">+{n - five.length}</span>
              </div>
            </div>
          } />
        </Frame>

        <Frame label="C · a count" cost="+21px — 3.52 screens">
          <Hero proof={
            <p className="mt-4 mb-0 text-[13px] leading-relaxed text-ink-light">
              <strong className="text-ink font-medium">{n} UK retailers</strong>, each one&rsquo;s delivery terms in the total.
            </p>
          } />
        </Frame>

        <Frame label="E · the old strip, for calibration" cost="+245px — 3.79 screens · NOT an option">
          <Hero proof={
            <div className="mt-4">
              <Label n={n} />
              <div className="flex flex-wrap gap-2">
                {names.map(name => (
                  <span key={name} className="inline-flex items-center justify-center h-9 px-3 bg-white border border-border rounded-xl">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/logos/${LOGO[name]}`} alt={name} className="h-[17px] w-auto object-contain block" />
                  </span>
                ))}
              </div>
            </div>
          } />
        </Frame>
      </div>
    </main>
  );
}
