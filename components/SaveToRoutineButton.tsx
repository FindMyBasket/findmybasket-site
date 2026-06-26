'use client';

import { useEffect, useState } from 'react';
import { addToRoutine, isInRoutine, onRoutineChange, type RoutineItem } from '../lib/routine-store';

interface Props {
  product: RoutineItem;
}

export function SaveToRoutineButton({ product }: Props) {
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
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2000);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={inRoutine}
        className={`block w-full text-center rounded-full px-6 py-3 text-sm font-medium transition-colors mb-4 border-2 ${
          inRoutine
            ? 'bg-sage-light text-ink border-sage cursor-default'
            : 'bg-warm-white text-ink border-ink hover:bg-ink hover:text-cream'
        }`}
      >
        {inRoutine ? '✓ Added to basket' : 'Add to basket'}
      </button>
      {showToast && (
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-ink text-cream text-xs px-4 py-2 rounded-full shadow-lg whitespace-nowrap pointer-events-none">
          Added to your basket
        </div>
      )}
    </div>
  );
}
