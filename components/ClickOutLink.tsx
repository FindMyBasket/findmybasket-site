'use client';

import { trackAffiliateClickOut } from '../lib/analytics';

// Affiliate click-out anchor that fires the GA4 click-out event before opening
// the destination. Used on the product detail page (server component) where we
// still need a client onClick handler. Defaults to the safe affiliate rel/target.
export function ClickOutLink({
  href,
  retailer,
  productId,
  className,
  children,
  rel = 'nofollow sponsored noopener',
  target = '_blank',
}: {
  href: string;
  retailer: string;
  productId?: number;
  className?: string;
  children: React.ReactNode;
  rel?: string;
  target?: string;
}) {
  return (
    <a
      href={href}
      target={target}
      rel={rel}
      className={className}
      onClick={() => trackAffiliateClickOut(retailer, productId)}
    >
      {children}
    </a>
  );
}
