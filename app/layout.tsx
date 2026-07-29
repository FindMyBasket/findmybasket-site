import type { Metadata } from 'next';
import Script from 'next/script';
import { Cormorant_Garamond, DM_Sans } from 'next/font/google';
import './globals.css';

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
        {/* FIRST child of <body>, and it must stay first. Defines window.gtag
            and window.dataLayer ahead of everything below it, so an event fired
            from a mount effect has somewhere to go. It loads no gtag.js and sets
            no cookie, so nothing reaches the device before consent and the legal
            position is unchanged.

            A plain <script src>, deliberately, with no async, no defer and no
            next/script wrapper:

            - NOT next/script beforeInteractive. In the App Router that emits a
              preload plus a self.__next_s.push(...) at the end of <body> for
              Next's own runtime to inject, not a blocking script. Whether that
              precedes hydration is a framework internal.
            - NOT inlined via readFileSync. That was tried on 29 July and took
              down every runtime-rendered route on the preview deploy: the read
              happens inside the serverless function, Vercel's tracer cannot see
              a runtime fs call, so public/fmb-gtag-stub.js was absent from the
              bundle and the ROOT LAYOUT threw. Prerendered pages were fine
              because their read happened at build, which is exactly what made
              it invisible: the build was green and only cache MISSes 500'd.

            A plain src tag is parser-blocking, so it executes before the parser
            reaches the RSC flight payload that hydration consumes, and the file
            is served from the CDN rather than the function bundle, so there is
            no tracing question at all. It is also the identical mechanism the 19
            static pages use, which is what "both surfaces on the same rules"
            was supposed to mean.

            See docs/ticket-gtag-hydration-race.md. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/fmb-gtag-stub.js" />
        {children}
        {/* afterInteractive, and it must stay that way: this one DOES load
            gtag.js once consent is given, so loading it any earlier would set
            _ga before consent, which is what PECR Regulation 6 prohibits. */}
        <Script src="/fmb-cookie-banner.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}