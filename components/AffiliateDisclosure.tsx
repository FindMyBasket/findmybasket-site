export function AffiliateDisclosure({ variant = 'inline' }: { variant?: 'inline' | 'banner' }) {
  if (variant === 'banner') {
    return (
      <div className="rounded-lg border border-border bg-cream/60 p-4 mb-6">
        <div className="flex items-start gap-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="flex-shrink-0 mt-0.5 text-gold-text" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M12 8V13M12 16.5V16.51" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <div className="text-sm leading-relaxed">
            <strong className="text-ink font-semibold">Heads up on how we make money: </strong>
            <span className="text-ink-light">
              FindMyBasket earns a commission when you click through and buy at a partner retailer. The commission does not affect the price you pay, and it does not influence which retailer we recommend. The &ldquo;best basket&rdquo; is genuinely the best value option across our partner retailers.
              {' '}
              <a href="/privacy" className="text-gold-text underline">Full details</a>.
            </span>
          </div>
        </div>
      </div>
    );
  }
  // 'inline' variant for compact placements
  return (
    <p className="text-xs text-ink-light leading-relaxed">
      We earn a commission when you click through and buy. Prices and recommendations aren&apos;t affected. <a href="/privacy" className="text-gold-text underline">More info</a>.
    </p>
  );
}
