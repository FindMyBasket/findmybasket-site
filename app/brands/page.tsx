import { SiteLayout } from '../../components/SiteLayout';
import { getAllBrandHubs } from '../../lib/brand-hub-queries';
import '../../components/brand-index.css';

// Keep ISR consistent with the individual hub pages at /brands/[slug].
export const revalidate = 3600;

export const metadata = {
  title: 'Brand Spotlight | FindMyBasket',
  description:
    'A considered selection of brands we partner with, presented in their own words, distinct from our independent price comparison.',
};

const ARROW = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const SHIELD = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

export default async function BrandSpotlightIndexPage() {
  const hubs = await getAllBrandHubs();
  // A single card centres on a constrained grid so the section reads as curated,
  // not sparse. The same grid scales to 3, 6 or more without changes.
  const gridClass = hubs.length === 1 ? 'bi-grid bi-grid--solo' : 'bi-grid';

  return (
    <SiteLayout>
      <div className="brand-index-scope">
        <div className="bi-wrap">
          <div className="bi-crumb">
            <a href="/">Home</a> &nbsp;/&nbsp; Brand Spotlight
          </div>

          <div className="bi-intro">
            <div className="bi-eyebrow">Brand Spotlight</div>
            <h1 className="bi-serif">Brands, in their own words</h1>
            <p className="bi-lede">
              A considered selection of brands we partner with, presented in their own words.
            </p>
          </div>

          {/* Trust firewall: makes clear this is partnered content, kept distinct
              from the independent comparison. Light framing, not legal text. */}
          <div className="bi-firewall">
            {SHIELD}
            <span>
              These are brand partnerships, presented with the brand. They sit
              alongside, and stay separate from, our independent price comparison,
              where rankings are never influenced by a partnership.
            </span>
          </div>

          {hubs.length === 0 ? (
            <p className="bi-empty">New brand features are on the way.</p>
          ) : (
            <div className={gridClass}>
              {hubs.map((hub) => {
                const heroVariant = `bi-hero--${hub.accent_treatment}`;
                return (
                  <a key={hub.slug} href={`/brands/${hub.slug}`} className="bi-card">
                    <div className={`bi-hero ${heroVariant}`}>
                      {hub.logo_path ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="bi-hero-logo" src={hub.logo_path} alt={hub.display_name} />
                      ) : (
                        <span className="bi-hero-name">{hub.display_name}</span>
                      )}
                    </div>
                    <div className="bi-body">
                      {hub.eyebrow && <div className="bi-cat">{hub.eyebrow}</div>}
                      <h2 className="bi-name">{hub.display_name}</h2>
                      {hub.lede && <p className="bi-snippet">{hub.lede}</p>}
                      <span className="bi-discover">
                        Discover {hub.display_name} {ARROW}
                      </span>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </SiteLayout>
  );
}
