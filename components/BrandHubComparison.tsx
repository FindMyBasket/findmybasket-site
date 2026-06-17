import { ProductCard } from './ProductCard';
import { findBrandBySlug, getBrandProducts } from '../lib/brand-queries';

// Independent price-comparison zone for two-zone hubs (show_comparison = true).
// Visually and editorially separated from the Brand Spotlight above: this ranking
// is derived only from live retailer prices and is never influenced by the brand
// partnership. Reuses the existing comparison query + ProductCard.
export async function BrandHubComparison({
  slug,
  displayName,
}: {
  slug: string;
  displayName: string;
}) {
  const brand = await findBrandBySlug(slug);
  if (!brand) return null;

  const { products } = await getBrandProducts(brand.normalised_brand, 1, 12);
  if (products.length === 0) return null;

  return (
    <section className="bh-compare">
      <div className="bh-zone-label">
        <span className="bh-tag bh-tag--compare">Price comparison</span>
        <span className="bh-rule" />
        <span className="bh-note">
          Independent. Ranked on live retailer prices, not influenced by the partnership above.
        </span>
      </div>
      <p className="bh-range-sub">
        Where {displayName} is stocked across multiple UK retailers, here is how current prices compare.
      </p>
      <div className="bh-compare-grid">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
