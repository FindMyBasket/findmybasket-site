import { ClickOutLink } from './ClickOutLink';

// Amazon Associates outbound link. Amazon requires an affiliate disclosure near
// EVERY Amazon link (the site-wide footer statement alone is not sufficient), so
// the visible "(affiliate link)" marker is baked in here and rendered with every
// instance. Never add the marker per-page: use this component wherever an Amazon
// link appears and the disclosure travels with it automatically.
//
// Text-only and neutral by house rule: no Amazon logo (we don't use it), neutral
// "Check on Amazon" framing, and nothing that implies Amazon endorses or partners
// with us. Retailer 9 = Amazon.
export function AmazonLink({
  href,
  productId,
  source = 'amazon',
  label = 'Check on Amazon',
  className,
  markerClassName = 'text-[11px] text-ink-light',
}: {
  href: string;
  productId?: number;
  source?: string;
  label?: string;
  className?: string;
  markerClassName?: string;
}) {
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <ClickOutLink
        href={href}
        retailer="amazon"
        retailerId={9}
        productId={productId}
        source={source}
        className={className}
      >
        {label}
      </ClickOutLink>
      <span className={markerClassName}>(affiliate link)</span>
    </span>
  );
}
