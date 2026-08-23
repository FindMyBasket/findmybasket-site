'use client';

import { useEffect, useState } from 'react';
import { getRoutine, onRoutineChange, buildRoutineUrl } from '../lib/routine-store';

// Floating indicator visible on every Next.js page. Shows current routine
// size and links to the routine builder with current routine pre-loaded.

export function RoutineIndicator() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    // Initial read after mount (avoids SSR/hydration mismatch)
    setCount(getRoutine().length);
    const unsubscribe = onRoutineChange(() => {
      setCount(getRoutine().length);
    });
    return unsubscribe;
  }, []);

  // Hide entirely until we know the count (prevents flash of "0" on load)
  if (count === null || count === 0) return null;

  return (
    <a
      href={buildRoutineUrl()}
      /* MOBILE OFFSET CLEARS THE PRODUCT PAGE'S FIXED BUY BAR.
         That bar is `fixed bottom-0 inset-x-0 z-40 md:hidden`, roughly 80px tall
         plus the safe-area inset. This pill is z-50, so at 390px it sat ON TOP of
         the bar's right-hand side -- directly over the add-to-routine control.
         Two tap targets, one position, the wrong one on top.

         Raised on mobile only, by the bar's height plus the same safe-area inset
         the bar uses, so the two cannot collide whatever the device chrome does.
         From `md` up the bar is hidden and the pill returns to bottom-6.

         Applied globally rather than conditionally: this component is rendered on
         every page and has no knowledge of which one it is on. A pill sitting a
         little higher on a page with no bar is correct-looking; a pill covering a
         button is not. Work-list item 246, phase 0.4. */
      className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] md:bottom-6 right-6 z-50 bg-ink text-cream px-5 py-3 rounded-full text-sm font-medium hover:bg-gold transition-colors shadow-lg flex items-center gap-2"
      aria-label={`Routine has ${count} product${count === 1 ? '' : 's'}`}
    >
      <span className="font-serif">Routine</span>
      <span className="bg-gold text-white text-xs font-medium rounded-full w-6 h-6 flex items-center justify-center">
        {count}
      </span>
    </a>
  );
}
