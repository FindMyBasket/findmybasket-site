import Link from 'next/link';
import { RoutineIndicator } from './RoutineIndicator';
import { SiteNav } from './SiteNav';
import { CookieSettingsButton } from './CookieSettingsButton';

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
              <li><a href="/privacy" className="hover:text-cream transition-colors">Privacy</a></li>
              <li><a href="/terms.html" className="hover:text-cream transition-colors">Terms</a></li>
              <li><CookieSettingsButton className="hover:text-cream transition-colors" /></li>
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
