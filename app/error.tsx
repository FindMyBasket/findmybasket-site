'use client';

import Link from 'next/link';
import { SiteLayout } from '../components/SiteLayout';

/**
 * THE ERROR PAGE, AND IT IS A BROWSING PAGE RATHER THAN AN APOLOGY.
 *
 * WHY IT EXISTS AT ALL. Until today this repository had no error.tsx and no global-error.tsx, so
 * every unhandled server error rendered Next's built-in default: "Application error: a server-side
 * exception has occurred", unstyled, no nav, no branding. That was tolerable only while nothing
 * deliberately threw. Item 596 changes that -- getActiveRetailerIds now throws rather than returning
 * an empty set -- so this page had to exist BEFORE that landed, not alongside it.
 *
 * ── IT CARRIES THE FULL LAYOUT, WHICH IS THE WHOLE DESIGN ────────────────────
 *
 * `error.tsx` must be a Client Component, which usually costs you the site chrome. It does not here:
 * SiteLayout is a plain non-async composer and every child is client-safe already -- SiteNav,
 * SiteSearch, RoutineIndicator and CookieSettingsButton all carry 'use client', SiteFooter and Logo
 * fetch nothing. So the visitor keeps the nav, the six categories and THE SEARCH BOX.
 *
 * A COMPARISON SITE'S ERROR PAGE THAT SAYS "TRY AGAIN" IS WORSE THAN ONE THAT LETS THEM KEEP
 * BROWSING. Someone arrives looking for a price. The useful response is a route to the price, not an
 * invitation to reload a page that has already failed once.
 *
 * ── AND IT DOES NOT LIST THE CATEGORIES ITSELF ───────────────────────────────
 *
 * DELIBERATELY. SiteNav already carries them and is parity-tested against SiteNav's own NAV_LINKS.
 * A second hand-written list here would be the TWENTIETH frozen nav (item 567: nineteen static navs
 * still on the Stage-1 triple, and about.html's list wrong for five retailers in a row). The
 * affordance is the nav and the search that are already correct; adding a copy would buy a moment's
 * convenience and a permanent drift surface.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────
 *
 * No console.error. The server error is already captured by Vercel's runtime logs and reaches
 * get_runtime_errors -- which is item 596's centre, and the entire reason throwing beats returning
 * empty. Re-logging it in the browser adds a line nobody reads to a signal that already works.
 *
 * `reset()` is offered and is SECONDARY. It re-renders the segment, which helps a transient failure
 * and does nothing for a broken query, and a visitor cannot tell which they have.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SiteLayout>
      <section className="max-w-site mx-auto px-6 py-20 md:py-28 text-center">
        <p className="text-xs uppercase tracking-widest text-gold font-medium mb-4">Something broke</p>
        <h1 className="font-serif text-4xl md:text-6xl text-ink mb-6">
          We couldn&rsquo;t load this page.
        </h1>
        <p className="text-base md:text-lg text-ink-light max-w-xl mx-auto mb-10 leading-relaxed">
          This one is ours, not yours &mdash; the page failed on our side, so nothing you did caused
          it and nothing you try will fix it. The rest of the site is working, and the search above
          will take you straight to a product or a brand.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="rounded-full px-6 py-3 text-sm bg-ink text-cream border border-ink hover:bg-gold hover:border-gold transition-colors"
          >
            Back to the homepage
          </Link>
          <button
            type="button"
            onClick={reset}
            className="rounded-full px-6 py-3 text-sm bg-warm-white text-ink border border-border hover:border-gold hover:bg-cream transition-colors"
          >
            Try this page again
          </button>
        </div>

        {error.digest && (
          <p className="mt-10 text-xs text-ink-light/70">
            If you report this, quote <code className="font-mono">{error.digest}</code>.
          </p>
        )}
      </section>
    </SiteLayout>
  );
}
