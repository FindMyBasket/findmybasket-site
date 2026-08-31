import { HomePage } from '../../components/HomePage';

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
export const metadata = { robots: { index: false, follow: false } };

export default function Page() {
  return <HomePage />;
}
