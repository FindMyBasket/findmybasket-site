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
export default async function Page() {
  const retailers = await getListedRetailers();
  return <HomePage retailers={retailers} />;
}
