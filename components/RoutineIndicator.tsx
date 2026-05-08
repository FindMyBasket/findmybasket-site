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
      className="fixed bottom-6 right-6 z-50 bg-ink text-cream px-5 py-3 rounded-full text-sm font-medium hover:bg-gold transition-colors shadow-lg flex items-center gap-2"
      aria-label={`Routine has ${count} product${count === 1 ? '' : 's'}`}
    >
      <span className="font-serif">Routine</span>
      <span className="bg-gold text-white text-xs font-medium rounded-full w-6 h-6 flex items-center justify-center">
        {count}
      </span>
    </a>
  );
}
