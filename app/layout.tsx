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

export const metadata: Metadata = {
  title: 'FindMyBasket',
  description: 'Find the best price on skincare, makeup and hair across UK retailers.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${cormorant.variable} ${dmSans.variable}`}>
      <body>
        {children}
        <Script src="/fmb-cookie-banner.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}