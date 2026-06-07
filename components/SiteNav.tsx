'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Logo } from './Logo';
import { SiteSearch } from './SiteSearch';

// Single source of truth for the nav links — drives both the desktop row and the
// mobile dropdown (and, in a later step, the active-state styling). Links/labels
// are unchanged from the original SiteNav. `static` = a static *.html page, so it
// uses a plain <a> rather than next/link.
const NAV_LINKS: { href: string; label: string; static?: boolean }[] = [
  { href: '/skincare', label: 'Skincare' },
  { href: '/makeup', label: 'Makeup' },
  { href: '/hair', label: 'Hair' },
  { href: '/edit/k-beauty', label: 'K-Beauty' },
  { href: '/savings-hub.html', label: 'Savings Hub', static: true },
];

function NavLink({
  link,
  className,
  active,
  onClick,
}: {
  link: { href: string; label: string; static?: boolean };
  className: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const ariaCurrent = active ? 'page' : undefined;
  return link.static ? (
    <a href={link.href} className={className} aria-current={ariaCurrent} onClick={onClick}>
      {link.label}
    </a>
  ) : (
    <Link href={link.href} className={className} aria-current={ariaCurrent} onClick={onClick}>
      {link.label}
    </Link>
  );
}

export function SiteNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // Tap-outside closes the menu (matches the homepage's document-click handler).
  useEffect(() => {
    if (!mobileOpen) return;
    function handleClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [mobileOpen]);

  const pathname = usePathname();
  // Active when the path is the link exactly, or a subpath of it (so /skincare/cleanser
  // highlights Skincare, and /edit/k-beauty highlights K-Beauty but other /edit/* don't).
  const isActive = (href: string) =>
    !!pathname && (pathname === href || pathname.startsWith(href + '/'));
  // Active = darker + heavier. No underline change (global link underline handled in Piece 4).
  const stateCls = (active: boolean) =>
    active ? 'text-ink font-medium' : 'text-ink-light hover:text-ink';
  const desktopBase = 'text-sm no-underline transition-colors';
  const mobileBase = 'text-base no-underline py-3 border-b border-border last:border-b-0';

  return (
    <nav
      ref={navRef}
      className="sticky top-0 z-50 bg-cream/90 backdrop-blur-md border-b border-border"
    >
      <div className="px-12 py-5 flex items-center justify-between gap-4">
        <a href="/index.html" className="flex items-center gap-2.5 no-underline flex-shrink-0">
          <Logo height={36} />
          <span className="font-serif text-[22px] font-semibold text-ink">
            Find<span className="text-gold">My</span>Basket
          </span>
        </a>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-7">
          {NAV_LINKS.map((link) => {
            const active = isActive(link.href);
            return (
              <NavLink
                key={link.href}
                link={link}
                active={active}
                className={`${desktopBase} ${stateCls(active)}`}
              />
            );
          })}
          <SiteSearch />
          <a
            href="/app.html"
            className="bg-ink text-cream no-underline px-5 py-2.5 rounded-full text-[13px] font-medium hover:bg-gold transition-colors"
          >
            Build a routine
          </a>
        </div>

        {/* Mobile: search + hamburger (3 static bars, dim to 0.5 when open — homepage parity) */}
        <div className="md:hidden flex items-center gap-3">
          <SiteSearch />
          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
            className="appearance-none border-0 bg-transparent flex flex-col gap-[5px] cursor-pointer p-1"
            style={{ opacity: mobileOpen ? 0.5 : 1 }}
          >
            <span className="block w-[22px] h-0.5 bg-ink rounded-sm" />
            <span className="block w-[22px] h-0.5 bg-ink rounded-sm" />
            <span className="block w-[22px] h-0.5 bg-ink rounded-sm" />
          </button>
        </div>
      </div>

      {/* Mobile dropdown — absolute top-full so it sits flush below the nav at any
          nav height (no hardcoded offset). Full width, cream, instant toggle. */}
      {mobileOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-cream border-b border-border px-6 py-5 flex flex-col gap-1">
          {NAV_LINKS.map((link) => {
            const active = isActive(link.href);
            return (
              <NavLink
                key={link.href}
                link={link}
                active={active}
                className={`${mobileBase} ${stateCls(active)}`}
                onClick={() => setMobileOpen(false)}
              />
            );
          })}
          <a
            href="/app.html"
            onClick={() => setMobileOpen(false)}
            className="mt-3 bg-ink text-cream no-underline text-center px-5 py-3 rounded-full text-sm font-medium hover:bg-gold transition-colors"
          >
            Build a routine
          </a>
        </div>
      )}
    </nav>
  );
}
