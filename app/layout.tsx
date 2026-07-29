import type { Metadata } from 'next';
import Script from 'next/script';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cormorant_Garamond, DM_Sans } from 'next/font/google';
import './globals.css';

// The GA4 queue stub, read from the SAME file the static pages load with a
// <script src> tag and the same file scripts/gtag-stub.test.mjs tests, then
// inlined into the server-rendered HTML. One source of truth, three consumers.
//
// Inlined rather than loaded with <Script strategy="beforeInteractive">, and
// this is not a style preference. In the App Router, beforeInteractive does not
// emit a blocking <script> in the head: it emits a preload link plus a
// `self.__next_s.push(...)` at the end of <body>, which Next's own client
// runtime then injects. Whether that lands before hydration is a framework
// internal, and the entire point of this file is to exist BEFORE the first
// mount effect runs. Verified against the emitted HTML on 29 July, which is why
// this is inlined instead: an inline script in the server HTML provably
// executes during parsing, ahead of every bundle below it. No framework
// semantics to trust and nothing to re-verify after a Next.js upgrade.
//
// Read at module scope so it happens once per server process, not per request.
// See docs/ticket-gtag-hydration-race.md.
// The escape is not optional. An HTML parser ends a script element at the first
// closing-script sequence it sees, regardless of JavaScript context, so one
// appearing anywhere in the file (even inside a comment) truncates the inlined
// block and dumps the remainder into the page as text. That shipped once, on
// 29 July, and was caught only by reading the emitted HTML: the block was cut
// before `window.gtag` was ever assigned, which silently restored the exact bug
// this file exists to fix. scripts/gtag-stub.test.mjs also fails if the sequence
// reappears in the source; this line is the second line of defence.
const GTAG_STUB = readFileSync(join(process.cwd(), 'public', 'fmb-gtag-stub.js'), 'utf8').replace(
  /<\/script/gi,
  '<\\/script',
);

// Self-hosted, optimised, zero render-blocking.
// CSS variables are exposed so they can be referenced from globals.css and
// from the routine-builder.css module.
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-cormorant',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-dm-sans',
  display: 'swap',
});

// Default metadata for any Next-rendered page that doesn't set its own. Pages
// like /product/[id] and /brands/[slug] override these via generateMetadata.
export const metadata: Metadata = {
  metadataBase: new URL('https://www.findmybasket.co.uk'),
  title: 'Compare Beauty Prices Across UK Retailers | FindMyBasket',
  description:
    'Build your beauty routine and compare prices across multiple UK retailers. Delivery thresholds included. Free to use.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${cormorant.variable} ${dmSans.variable}`}>
      <body>
        {/* FIRST child of <body>, before {children}, and it must stay first:
            this defines window.gtag and window.dataLayer ahead of every bundle
            below it, so an event fired from a mount effect has somewhere to go.
            It loads no gtag.js and sets no cookie, so nothing reaches the device
            before consent and the legal position is unchanged.
            See docs/ticket-gtag-hydration-race.md. */}
        <script dangerouslySetInnerHTML={{ __html: GTAG_STUB }} />
        {children}
        {/* afterInteractive, and it must stay that way: this one DOES load
            gtag.js once consent is given, so loading it any earlier would set
            _ga before consent, which is what PECR Regulation 6 prohibits. */}
        <Script src="/fmb-cookie-banner.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}