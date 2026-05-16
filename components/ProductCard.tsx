import Link from 'next/link';
import type { FeaturedProduct } from '../lib/queries';

interface Props {
  product: FeaturedProduct;
}

export function ProductCard({ product }: Props) {
  return (
    <Link
      href={`/product/${product.id}`}
      className="group block bg-warm-white border border-border rounded-2xl overflow-hidden hover:border-gold transition-colors"
    >
      <div className="aspect-square bg-cream relative overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
         src={product.image_url || '/placeholder-product.svg'}
         alt={product.name}
         className="w-full h-full object-contain p-4 group-hover:scale-105 transition-transform duration-300"
         loading="lazy"
          onError={(e) => {
           e.currentTarget.src = '/placeholder-product.svg';
           e.currentTarget.onerror = null;
         }}
        />
        {product.saving_pct >= 10 && (
          <span className="absolute top-3 right-3 bg-gold text-white text-xs font-medium px-2 py-1 rounded-full">
            Save {product.saving_pct}%
          </span>
        )}
      </div>
      <div className="p-4">
        {product.brand && (
          <p className="text-xs uppercase tracking-wider text-ink-light mb-1.5 font-medium">
            {product.brand}
          </p>
        )}
        <h3 className="text-sm text-ink mb-3 line-clamp-2 leading-snug">
          {product.name}
        </h3>
        <div className="flex items-baseline justify-between">
          <div>
            <span className="text-base font-medium text-ink">
              £{product.min_price.toFixed(2)}
            </span>
            {product.max_price > product.min_price && (
              <span className="text-xs text-ink-light line-through ml-2">
                £{product.max_price.toFixed(2)}
              </span>
            )}
          </div>
          <span className="text-xs text-ink-light">
            {product.retailer_count} retailers
          </span>
        </div>
      </div>
    </Link>
  );
}
