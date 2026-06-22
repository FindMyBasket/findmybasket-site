'use client';

import { useState } from 'react';

// "About this product" section. Renders the feed-sourced description below the
// price comparison table. Long copy collapses behind a "Read more" toggle.
// The parent only mounts this when a description exists, so `description` here
// is always non-empty.

// Roughly 3-4 lines of body text. Above this we collapse by default.
const COLLAPSE_THRESHOLD = 280;

export function ProductDescription({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = description.length > COLLAPSE_THRESHOLD;

  return (
    <section className="max-w-site mx-auto px-6 py-12">
      <h2 className="font-serif text-3xl text-ink mb-6">About this product</h2>
      <div className="max-w-3xl">
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
    </section>
  );
}
