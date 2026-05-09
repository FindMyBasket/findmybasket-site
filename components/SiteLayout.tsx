import Link from 'next/link';
import { Logo } from './Logo';
import { RoutineIndicator } from './RoutineIndicator';
import { SiteSearch } from './SiteSearch';

export function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      <main>{children}</main>
      <SiteFooter />
      <RoutineIndicator />
    </>
  );
}

function SiteNav() {
  return (
    <nav className="sticky top-0 z-50 bg-cream/90 backdrop-blur-md border-b border-border">
      <div className="max-w-site mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <a href="/index.html" className="flex items-center gap-2.5 no-underline flex-shrink-0">
          <Logo height={32} />
          <span className="font-serif text-[22px] font-semibold text-ink">
            Find<span className="text-gold">My</span>Basket
          </span>
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
          <SiteSearch />
          <a
            href="/app.html"
            className="bg-ink text-cream px-5 py-2.5 rounded-full text-[13px] font-medium hover:bg-gold transition-colors"
          >
            Build a routine
          </a>
        </div>
        {/* Mobile: just show search on the right */}
        <div className="md:hidden flex items-center">
          <SiteSearch />
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
              <li><Link href="/brands" className="hover:text-cream transition-colors">All brands</Link></li>
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
