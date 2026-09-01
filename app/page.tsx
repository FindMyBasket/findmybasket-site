import { HomePage } from '../components/HomePage';
import { socialTags } from '../lib/format/social-tags';
import { getListedRetailers } from '../lib/retailers';

export const revalidate = 3600;

const title = 'Health & Beauty Price Comparison UK | FindMyBasket';
const description =
  'Build your health and beauty routine and compare prices across multiple UK retailers. Delivery thresholds included. Free to use.';
const canonical = 'https://www.findmybasket.co.uk/';

/**
 * SOCIAL TAGS WIRED FIRST, DELIBERATELY. Item 513.
 *
 * The 21 August snapshot recorded that the static homepage is the ONLY page on the site with
 * complete OpenGraph tags, while being the page due for replacement — and that every Next
 * route replacing a static page had lost them. That was true when written and dissolved when
 * lib/format/social-tags.ts shipped: measured, /compare/creatine emits 9 og + 4 twitter
 * against the static homepage's 8 + 3, so this route GAINS og:image:alt and twitter:image.
 *
 * Wired before any content so it is verified on a preview that does not yet look finished.
 * A tag check at the end is a check on something that already reads as done.
 */
export const metadata = {
  title,
  description,
  alternates: { canonical },
  ...socialTags({ title, description, url: canonical }),
};

// ASYNC SO THE RETAILERS ARE QUERIED, NOT TYPED. `revalidate = 3600` above means
// one extra query an hour, and the number cannot go stale between deploys the way a
// build-time artefact would -- a retailer added on a Tuesday with no deploy until
// Friday is three days of a wrong number in a headline. Item 528.
/*
 * THE WebSite BLOCK, PORTED RATHER THAN REWRITTEN. Item 545.
 *
 * public/index.html:29 carried this and the rebuild dropped it. Item 516 was open the
 * whole time saying the homepage's SearchAction pointed at a disallowed path — so every
 * reading of the work list confirmed there WAS structured data here, with a defect in it.
 * There was none. A stale item answers the question nobody then asks.
 *
 * WHY IT SURVIVED NEITHER INSTRUMENT. Item 524: the screenshot and getComputedStyle
 * answer different questions and do not overlap. Structured data has no number attached
 * and nothing to see in a screenshot, so the height measurement did not miss it and the
 * eye did not miss it — NEITHER WAS LOOKING AT THE PLACE IT LIVES. This is the gap
 * between the two.
 *
 * THE TARGET IS `/search`, WHICH THE STATIC BLOCK ALREADY HAD RIGHT. `/app` is the
 * builder and is Disallow'd in robots.txt; savings-hub.html named it and was the actual
 * defect (item 516). A SearchAction pointing at a disallowed path is the input that
 * produces "indexed though blocked".
 *
 * `description` COMES FROM THE CONSTANT ABOVE, NOT FROM THE STATIC FILE. The static copy
 * predates item 495's tagline change; retyping it would reintroduce a frozen string the
 * route already holds correctly. One value, three uses — metadata, social tags, and here.
 *
 * NO Organization BLOCK, DELIBERATELY. It appears in this codebase only as a nested value
 * (`seller` on offers, `publisher` on articles) and the homepage is the only page where a
 * standalone one would sit correctly — but the honest version is name, url and logo,
 * which is close to what WebSite already says. `sameAs`, contact and a real logo asset are
 * facts about the business rather than the code. Padding a block to justify its own
 * presence is not a reason to ship one.
 */
const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'FindMyBasket',
  url: 'https://www.findmybasket.co.uk',
  description,
  potentialAction: {
    '@type': 'SearchAction',
    target: 'https://www.findmybasket.co.uk/search?q={search_term_string}',
    'query-input': 'required name=search_term_string',
  },
};

export default async function Page() {
  const retailers = await getListedRetailers();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />
      <HomePage retailers={retailers} />
    </>
  );
}
