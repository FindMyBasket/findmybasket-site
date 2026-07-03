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

// Canonical site footer — visually mirrors the static footer in public/*.html
// (savings-hub style, no tagline). Same logo, wordmark, link set/order, Cookie
// Settings button, affiliate disclosure and copyright line.
const footerLinkCls =
  'font-sans text-[13px] text-cream/40 hover:text-cream transition-colors no-underline';

function FooterLogo() {
  // All-white mark, fill inherited on <svg> (no per-path class — avoids the
  // global .nl7 collision the static logos hit).
  return (
    <svg height={32} viewBox="0 0 160 160" fill="#ffffff" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g>
        <g>
          <path d="M115.6,99.5v.2s-3,13.9-3,13.9c-1.4,6.8-7.5,11.8-14.5,11.8h-60.9c-7,0-13.1-4.9-14.5-11.8l-8.2-39h66.2c-.3-.9-.5-1.9-.7-2.9-.4-1.9-.5-3.9-.5-6v-.3H10.6c-3.8,0-6.6,3.5-5.8,7.2l9,42.8c2.3,11.1,12.1,19.1,23.5,19.1h60.9c11.3,0,21.1-8,23.5-19.1l3.8-18v-.2c-3,1.2-6.3,2-9.8,2.2Z" />
          <path d="M88.8,42.5c-.4.4-.7.7-1,1.1-.7.8-1.4,1.6-2,2.5-.9,1.3-1.7,2.6-2.4,3.9-3.1-1.4-6.3-2.1-9.7-2.1h-11.8c-6.4,0-12.4,2.5-17,7-2.9,2.9-5,6.5-6.1,10.4-.1.3-.2.7-.3,1-.2.8-.3,1.6-.5,2.6l-.6,4.5-9.1-1.2.6-4.5c.1-.9.2-1.7.4-2.4,0-.4.2-.7.2-1.1,1.4-5.9,4.4-11.4,8.8-15.8,6.3-6.3,14.6-9.7,23.5-9.7h11.8c4.9,0,9.7,1.1,14.1,3.1l1.1.5Z" />
          <path d="M40.4,116.6c-1.3,0-2.5-.9-2.8-2.2l-7.5-29.5c-.4-1.5.5-3.1,2.1-3.5,1.5-.4,3.1.5,3.5,2.1l7.5,29.5c.4,1.5-.5,3.1-2.1,3.5-.2,0-.5,0-.7,0Z" />
          <path d="M59,117c-1.4,0-2.6-1-2.8-2.5l-4.4-30.2c-.2-1.6.9-3,2.4-3.3,1.6-.2,3,.9,3.3,2.4l4.4,30.2c.2,1.6-.9,3-2.4,3.3-.1,0-.3,0-.4,0Z" />
          <path d="M100.4,97l-4.8,17.5c-.3,1.3-1.5,2.1-2.8,2.1s-.5,0-.7-.1c-1.5-.4-2.4-2-2-3.5l5-18.5c0,0,0-.1,0-.2.1,0,.2.2.4.2.7.4,1.4.9,2.2,1.3.8.4,1.7.9,2.6,1.2Z" />
          <path d="M76.4,117c-.1,0-.3,0-.4,0-1.6-.2-2.7-1.7-2.4-3.3l4.4-30.2c.2-1.6,1.7-2.7,3.3-2.4,1.6.2,2.7,1.7,2.4,3.3l-4.4,30.2c-.2,1.4-1.4,2.5-2.8,2.5Z" />
        </g>
        <g>
          <path d="M92.5,70.2h-9.8c1.6,8.7,6.8,16.1,14,20.6l2.7-9.8c-3.3-2.7-5.8-6.5-6.9-10.8ZM112.8,34.3c-9.2,0-17.5,4.1-23.1,10.6-3.9,4.5-6.5,10.1-7.2,16.3-.2,1.2-.2,2.5-.2,3.7,0,1.9.2,3.7.5,5.4,1.6,8.7,6.8,16.1,14,20.6,4.7,2.9,10.2,4.5,16,4.5s1.1,0,1.7,0c3.5-.2,6.7-.9,9.8-2.2.8-.3,1.7-.7,2.5-1.2,3.4-1.8,6.5-4.1,9-7,4.7-5.4,7.6-12.4,7.6-20.1,0-16.8-13.7-30.5-30.6-30.5ZM116.5,85.5c-1.2.2-2.5.3-3.8.3-5.1,0-9.7-1.8-13.3-4.8-3.3-2.7-5.8-6.5-6.9-10.8-.5-1.7-.7-3.6-.7-5.4s.1-2.5.3-3.7c.6-3.5,2.1-6.6,4.2-9.3,3.8-4.9,9.8-8,16.5-8,11.6,0,21,9.4,21,21s-2.6,11.6-6.8,15.5c-2.9,2.6-6.5,4.5-10.4,5.2Z" />
          <path d="M153,114.9l-.8.6c-2.9,2.3-7.2,1.7-9.3-1.3l-16.2-22.5,8.9-7.1,18.3,20.9c2.4,2.8,2.1,7-.8,9.3Z" />
          <path d="M131.8,63.2c0,.3-.2.5-.5.5s-.5-.2-.5-.5c0-9-8-16.9-17-16.9s-.5-.2-.5-.5.2-.5.5-.5c9.6,0,18,8.3,18,17.8Z" />
        </g>
      </g>
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-ink mt-20 px-5 py-8 md:p-12">
      <div className="max-w-[1100px] mx-auto">
        <div className="flex items-center gap-2.5 mb-7">
          <FooterLogo />
          <span className="font-serif text-[20px] font-semibold text-cream">
            Find<span className="text-gold">My</span>Basket
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-6 mb-6">
          <a href="/savings-hub.html" className={footerLinkCls}>Savings Hub</a>
          <a href="/app" className={footerLinkCls}>Try it now</a>
          <a href="/about" className={footerLinkCls}>About</a>
          <a href="/work-with-us" className={footerLinkCls}>Work with us</a>
          <a href="/privacy" className={footerLinkCls}>Privacy Policy</a>
          <a href="/terms" className={footerLinkCls}>Terms of Use</a>
          <a href="mailto:hello@findmybasket.co.uk" className={footerLinkCls}>Contact</a>
          <CookieSettingsButton className={footerLinkCls} />
        </div>
        <p className="text-[12px] text-cream/25 max-w-[640px] leading-relaxed mb-3">
          FindMyBasket may earn a small affiliate commission when you shop through our links, at no extra cost to you. As an Amazon Associate I earn from qualifying purchases.
        </p>
        <p className="text-[12px] text-cream/20">© 2026 FindMyBasket. All rights reserved.</p>
      </div>
    </footer>
  );
}
