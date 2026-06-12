'use client';

import { useEffect, useRef, useState } from 'react';

interface BrandMatch {
  display_name: string;
  slug: string;
  product_count: number;
}

interface ProductMatch {
  id: number;
  name: string;
  brand: string | null;
  product_type: string | null;
  image_url: string | null;
}

interface SearchResults {
  brands: BrandMatch[];
  products: ProductMatch[];
  query: string;
}

const DEBOUNCE_MS = 250;
const MIN_QUERY_LEN = 2;

export function SiteSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Open: focus the input
  useEffect(() => {
    if (open) {
      // Small delay to allow CSS transition then focus
      setTimeout(() => inputRef.current?.focus(), 20);
    } else {
      setQuery('');
      setResults(null);
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Debounced fetch
  useEffect(() => {
    if (query.trim().length < MIN_QUERY_LEN) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (!res.ok) {
          setResults(null);
          return;
        }
        const data: SearchResults = await res.json();
        // Only apply results if query hasn't changed since fetch started
        setResults(data);
      } catch {
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const hasResults = results && (results.brands.length > 0 || results.products.length > 0);
  const showEmpty = results && !loading && !hasResults && query.trim().length >= MIN_QUERY_LEN;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="appearance-none border-0 bg-transparent text-ink-light hover:text-ink transition-colors p-2"
        aria-label="Search"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>

      {/*
        Search panel positioning. Mobile: pin to the viewport (fixed) with 1rem
        gutters on both sides, so the panel always spans the screen with breathing
        room. The previous `absolute right-0` anchored the panel to the search
        button, which on mobile sits ~84px from the right edge (hamburger + nav
        px-12), pushing a 361px panel's left edge ~52px off-screen and clipping
        the placeholder. Desktop (md+): restore the original right-anchored 420px
        dropdown — the wide viewport has room for it.
      */}
      {open && (
        <div className="fixed left-4 right-4 top-16 md:absolute md:left-auto md:right-0 md:top-full md:mt-2 md:w-[min(420px,calc(100vw-2rem))] bg-warm-white border border-border rounded-2xl shadow-xl overflow-hidden z-50">
          <div className="p-4 border-b border-border">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search products and brands..."
              className="w-full text-sm text-ink placeholder:text-ink-light bg-transparent outline-none"
            />
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {query.trim().length < MIN_QUERY_LEN && (
              <div className="p-6 text-center text-sm text-ink-light">
                Type at least {MIN_QUERY_LEN} characters to search.
              </div>
            )}

            {loading && (
              <div className="p-6 text-center text-sm text-ink-light">
                Searching...
              </div>
            )}

            {showEmpty && (
              <div className="p-6 text-center text-sm text-ink-light">
                No matches for &quot;{query.trim()}&quot;.
              </div>
            )}

            {hasResults && results && (
              <>
                {results.brands.length > 0 && (
                  <div className="p-2">
                    <p className="text-xs uppercase tracking-widest text-ink-light px-3 py-2 font-medium">
                      Brands
                    </p>
                    {results.brands.map(brand => (
                      <a
                        key={brand.slug}
                        href={`/brands/${brand.slug}`}
                        className="flex items-center justify-between px-3 py-2 hover:bg-cream rounded-lg transition-colors"
                        onClick={() => setOpen(false)}
                      >
                        <span className="text-sm text-ink">{brand.display_name}</span>
                        <span className="text-xs text-ink-light">{brand.product_count} products</span>
                      </a>
                    ))}
                  </div>
                )}

                {results.products.length > 0 && (
                  <div className="p-2 border-t border-border">
                    <p className="text-xs uppercase tracking-widest text-ink-light px-3 py-2 font-medium">
                      Products
                    </p>
                    {results.products.map(product => (
                      <a
                        key={product.id}
                        href={`/product/${product.id}`}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-cream rounded-lg transition-colors"
                        onClick={() => setOpen(false)}
                      >
                        <div className="w-10 h-10 bg-cream rounded-lg flex-shrink-0 flex items-center justify-center overflow-hidden">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={product.image_url || '/placeholder-product.svg'}
                            alt=""
                           className="w-full h-full object-contain"
                            loading="lazy"
                            onError={(e) => {
                             e.currentTarget.src = '/placeholder-product.svg';
                              e.currentTarget.onerror = null;
                             }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          {product.brand && (
                            <p className="text-xs uppercase tracking-wider text-ink-light truncate">
                              {product.brand}
                            </p>
                          )}
                          <p className="text-sm text-ink truncate">{product.name}</p>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
