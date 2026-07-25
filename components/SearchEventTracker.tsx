'use client';

import { useEffect, useRef } from 'react';
import { trackSearch } from '../lib/analytics';

// Fires a single GA4 `search` for a committed search on the /search results page.
// Rendering nothing. Only mounted for real committed searches (the server page
// gates on query length), never for the per-keystroke typeahead.
//
// The ref is keyed on the query string, not a plain boolean: it fires once per
// distinct query and skips a re-render whose query is unchanged. That covers React
// strict-mode's dev double-invoke, back/forward navigation that lands on the same
// query, and any pagination or filter change that alters other params but not `q`.
// A genuinely new query differs from firedFor.current, so it fires. Effect depends
// on `query` alone so unchanged-query re-renders don't even re-run it.
export function SearchEventTracker({
  query,
  resultCount,
  source,
}: {
  query: string;
  resultCount: number;
  source?: string;
}) {
  const firedFor = useRef<string | null>(null);

  useEffect(() => {
    if (firedFor.current === query) return;
    firedFor.current = query;
    trackSearch({ searchTerm: query, resultCount, searchSource: source });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return null;
}
