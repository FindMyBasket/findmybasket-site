'use client';

import { useEffect, useRef } from 'react';
import { trackViewItem } from '../lib/analytics';

// Fires a single GA4 view_item for the product page (a server component, so it needs
// a client child to reach window.gtag). Rendering nothing.
//
// The useRef guard is deliberate: React strict mode in development runs an effect's
// setup, then cleanup, then setup again on the SAME instance (refs persist across
// that), which would otherwise fire view_item twice per view in dev. The ref is not
// reset in cleanup, so the second setup is a no-op. A fresh client navigation to a
// different product mounts a new instance with fired=false, so real re-views still
// fire — this only dedupes the dev double-invoke, never a genuine second view.
export function ProductViewTracker({
  itemId,
  itemBrand,
  itemCategory,
  price,
  numRetailers,
}: {
  itemId: number;
  itemBrand?: string;
  itemCategory?: string;
  price?: number;
  numRetailers?: number;
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackViewItem({ itemId, itemBrand, itemCategory, value: price, numRetailers });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
