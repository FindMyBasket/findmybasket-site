import { SiteLayout } from './SiteLayout';
import { BrandHubRange } from './BrandHubRange';
import { BrandHubComparison } from './BrandHubComparison';
import { liveOffer, type BrandHubData } from '../lib/brand-hub-queries';
import { sanitizeBrandHubBody } from '../lib/brand-hub-body';
import './brand-hub.css';

const ARROW = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export async function BrandHub({ data }: { data: BrandHubData }) {
  const { hub, products } = data;
  const offer = liveOffer(hub.offer);
  const heroVariant = `bh-hero--${hub.accent_treatment}`;
  // Sanitised here rather than at write time, so the allowlist applies to
  // whatever is in the row today. Empty string for hubs with no body.
  const bodyHtml = sanitizeBrandHubBody(hub.body_html);

  return (
    <SiteLayout>
      <div className="brand-hub-scope">
        <div className="bh-wrap">
          <div className="bh-crumb">
            <a href="/">Home</a> &nbsp;/&nbsp; Brands &nbsp;/&nbsp; {hub.display_name}
          </div>

          {/* Brand Spotlight zone label (brand-partnered, clearly disclosed) */}
          <div className="bh-zone-label">
            <span className="bh-tag bh-tag--brand">Brand Spotlight</span>
            <span className="bh-rule" />
            {hub.zone_note && <span className="bh-note">{hub.zone_note}</span>}
          </div>

          <section className="bh-spotlight">
            <div className={`bh-hero ${heroVariant}`}>
              {hub.logo_path && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="bh-hero-logo" src={hub.logo_path} alt={hub.display_name} />
              )}
              {hub.eyebrow && <div className="bh-eyebrow">{hub.eyebrow}</div>}
              {/* display_name still drives the breadcrumb, index card and
                  creative flag; only the H1 takes the editorial headline. */}
              <h1 className="bh-serif">{hub.headline ?? hub.display_name}</h1>
              {hub.lede && <p className="bh-lede">{hub.lede}</p>}
              <div className="bh-actions">
                <a href="#range" className="bh-btn bh-btn-gold">
                  Explore the range {ARROW}
                </a>
                {offer && (
                  <a href="#offer" className="bh-btn bh-btn-line">
                    See the exclusive offer
                  </a>
                )}
              </div>
              <span className="bh-creative-flag">
                Brand creative · supplied by {hub.display_name}
              </span>
            </div>

            {hub.pillars.length > 0 && (
              <div className="bh-pillars">
                {hub.pillars.map((pillar, i) => (
                  <div className="bh-cell" key={i}>
                    <h3>{pillar.title}</h3>
                    <p>{pillar.body}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Long-form brand story. Sanitised above with a tag/attribute
                allowlist that deliberately preserves rel and target on
                affiliate anchors. */}
            {bodyHtml && (
              <div
                className="bh-article"
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            )}

            <BrandHubRange
              products={products}
              rangeSub={hub.range_sub}
              rangeTitle={hub.range_title}
              rangeCtaLabel={hub.range_cta_label}
              rangeCtaUrl={hub.range_cta_url}
              offer={offer}
            />

            {!hub.show_comparison && hub.single_path_note && (
              <div className="bh-single-path">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                {hub.single_path_note}
              </div>
            )}
          </section>

          {hub.disclosure && (
            <div className="bh-disclosure">
              <b>About this page.</b> {hub.disclosure}
            </div>
          )}

          {/* Two-zone hubs: independent, clearly separated price comparison.
              Ranking here is never influenced by the brand partnership. */}
          {hub.show_comparison && (
            <BrandHubComparison slug={hub.slug} displayName={hub.display_name} />
          )}
        </div>
      </div>
    </SiteLayout>
  );
}
