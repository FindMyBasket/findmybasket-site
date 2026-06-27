'use client';

import { useState } from 'react';

// "About this product". Embeddable block (no own section wrapper) so the parent
// can place it inside the buy column, below the price comparison. Renders only
// when a description exists, so thin/missing descriptions collapse to nothing
// rather than an empty labelled section. Long copy collapses behind "Read more".

// Roughly 3-4 lines of body text. Above this we collapse by default.
const COLLAPSE_THRESHOLD = 280;

export function ProductDescription({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = description.length > COLLAPSE_THRESHOLD;

  return (
    <div className="mt-8">
      <h2 className="font-serif text-2xl text-ink mb-3">About this product</h2>
      <p
        className={`text-ink-light leading-relaxed whitespace-pre-line ${
          isLong && !expanded ? 'line-clamp-4' : ''
        }`}
      >
        {description}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="mt-3 text-sm font-medium text-gold hover:text-ink transition-colors"
          aria-expanded={expanded}
        >
          {expanded ? 'Read less' : 'Read more'}
        </button>
      )}
    </div>
  );
}
