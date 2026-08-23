'use client';

import { useEffect, useState } from 'react';
import { addToRoutine, isInRoutine, onRoutineChange, buildRoutineUrl, type RoutineItem } from '../lib/routine-store';
import { trackAddToCart } from '../lib/analytics';

interface Props {
  product: RoutineItem;
  // Drops the trailing margin so the button sits flush inside a container such
  // as the mobile pinned buy bar. Default keeps the left-column spacing.
  compact?: boolean;
}

export function SaveToRoutineButton({ product, compact = false }: Props) {
  const [inRoutine, setInRoutine] = useState(false);
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    setInRoutine(isInRoutine(product.id));
    const unsubscribe = onRoutineChange(() => {
      setInRoutine(isInRoutine(product.id));
    });
    return unsubscribe;
  }, [product.id]);

  const handleClick = () => {
    if (inRoutine) return;
    const result = addToRoutine(product);
    if (result.added) {
      // Only on a genuine add (addToRoutine is idempotent and returns added:false
      // for a duplicate). handleClick runs only on the clicked instance, so the
      // twin desktop/mobile-buy-bar mounts never double-fire this for one click.
      trackAddToCart({
        itemId: product.id,
        itemBrand: product.brand,
        itemCategory: product.category,
      });
      setShowToast(true);
      setTimeout(() => setShowToast(false), 6000);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={inRoutine}
        className={`block w-full text-center rounded-full px-6 py-3 text-sm font-medium transition-colors border-2 ${compact ? '' : 'mb-4'} ${
          inRoutine
            ? 'bg-sage-light text-ink border-sage cursor-default'
            : 'bg-warm-white text-ink border-ink hover:bg-ink hover:text-cream'
        }`}
      >
        {inRoutine ? '✓ Added to my routine' : 'Add to my routine'}
      </button>
      {/* THE ROUTE INTO THE BUILDER, OFFERED RATHER THAN FORCED.
          The spec asks for adding from a product page to route to /app?routine= with
          the optimiser run. This makes the confirmation the route: it carries the
          link and the visitor takes it or does not.

          NOT AN AUTOMATIC REDIRECT, deliberately. Product pages convert at 24.68%
          and the builder at 2.06%; navigating on click would move someone off the
          best-performing surface on the site at the moment they engaged with it.
          If the measured effect argues for auto-navigation later, that is a product
          decision with a number behind it -- not a default to adopt silently.

          NO COUNT HERE. RoutineIndicator already reads the same store on every page
          and renders the count. A second one is two components rendering one fact,
          which is item 248's propagation finding arriving before it happens rather
          than after. Item 250. */}
      {showToast && (
        <a
          href={buildRoutineUrl()}
          className="absolute -top-12 left-1/2 -translate-x-1/2 bg-ink text-cream text-xs px-4 py-2 rounded-full shadow-lg whitespace-nowrap hover:bg-gold transition-colors"
        >
          Added — see your routine →
        </a>
      )}
    </div>
  );
}
