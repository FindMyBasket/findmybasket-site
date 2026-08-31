import { HomePage } from '../../components/HomePage';
import { socialTags } from '../../lib/format/social-tags';

const title = 'Health & Beauty Price Comparison UK | FindMyBasket';
const description =
  'Build your health and beauty routine and compare prices across multiple UK retailers. Delivery thresholds included. Free to use.';
const canonical = 'https://www.findmybasket.co.uk/';

/**
 * TEMPORARY. Item 513, step 1.
 *
 * `/` is still served by public/index.html through the beforeFiles rewrite in
 * next.config.js, so app/page.tsx is unreachable until that rewrite is removed. This path
 * exists ONLY so the route can be measured on a preview deploy while the static page keeps
 * serving visitors.
 *
 * DELETE THIS DIRECTORY when the rewrite flips. It is noindex'd so a preview cannot be
 * indexed as a second homepage — item 515 records what happens when two URLs serve one page.
 */
/**
 * THE SAME metadata AS app/page.tsx, PLUS noindex.
 *
 * Without this the preview path emits no og/twitter tags at all — it would have made step 2
 * of the plan (verify socialTags BEFORE the page looks finished) unverifiable, because the
 * only route carrying them is the one the rewrite makes unreachable. Checking the tags on
 * the surface that cannot serve them is not a check.
 */
export const metadata = {
  title,
  description,
  robots: { index: false, follow: false },
  ...socialTags({ title, description, url: canonical }),
};

export default function Page() {
  return <HomePage />;
}
