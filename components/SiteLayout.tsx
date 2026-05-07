import Link from 'next/link';

// SiteLayout wraps every Next.js page with the consistent FindMyBasket
// nav and footer. It mirrors the existing static HTML site's nav so
// users moving between Next.js pages and legacy HTML pages don't see
// a visual jump.

export function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}

function SiteNav() {
  return (
    <nav className="sticky top-0 z-50 bg-cream/90 backdrop-blur-md border-b border-border">
      <div className="max-w-site mx-auto px-6 py-4 flex items-center justify-between">
        <a href="/index.html" className="font-serif text-[22px] font-semibold text-ink no-underline flex items-center gap-2.5">
          findmybasket<span className="text-gold">.</span>
        </a>
        <div className="hidden md:flex items-center gap-7">
          <Link href="/skincare" className="text-sm text-ink-light hover:text-ink transition-colors">
            Skincare
          </Link>
          <Link href="/makeup" className="text-sm text-ink-light hover:text-ink transition-colors">
            Makeup
          </Link>
          <Link href="/hair" className="text-sm text-ink-light hover:text-ink transition-colors">
            Hair
          </Link>
          <Link href="/edit/k-beauty" className="text-sm text-ink-light hover:text-ink transition-colors">
            K-Beauty
          </Link>
          <a href="/savings-hub.html" className="text-sm text-ink-light hover:text-ink transition-colors">
            Savings Hub
          </a>
          <a
            href="/app.html"
            className="bg-ink text-cream px-5 py-2.5 rounded-full text-[13px] font-medium hover:bg-gold transition-colors"
          >
            Build a routine
          </a>
        </div>
      </div>
    </nav>
  );
}

function SiteFooter() {
  return (
    <footer className="bg-ink text-cream/80 mt-24">
      <div className="max-w-site mx-auto px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          <div>
            <h4 className="font-serif text-cream text-lg mb-4">Browse</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/skincare" className="hover:text-cream transition-colors">Skincare</Link></li>
              <li><Link href="/makeup" className="hover:text-cream transition-colors">Makeup</Link></li>
              <li><Link href="/hair" className="hover:text-cream transition-colors">Hair</Link></li>
              <li><Link href="/edit/k-beauty" className="hover:text-cream transition-colors">K-Beauty</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-serif text-cream text-lg mb-4">Tools</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="/app.html" className="hover:text-cream transition-colors">Routine builder</a></li>
              <li><a href="/savings-hub.html" className="hover:text-cream transition-colors">Savings hub</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-serif text-cream text-lg mb-4">Company</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="/about.html" className="hover:text-cream transition-colors">About</a></li>
              <li><a href="/partners.html" className="hover:text-cream transition-colors">Partners</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-serif text-cream text-lg mb-4">Legal</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="/privacy-policy.html" className="hover:text-cream transition-colors">Privacy</a></li>
              <li><a href="/terms.html" className="hover:text-cream transition-colors">Terms</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-cream/10 pt-8 text-xs text-cream/60">
          findmybasket. The UK skincare, makeup and hair price comparison.
        </div>
      </div>
    </footer>
  );
}
