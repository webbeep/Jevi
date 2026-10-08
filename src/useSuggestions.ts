import { useCallback, useEffect, useState } from 'react';
import {
  canShuffle,
  pickShown,
  type Suggestion,
} from '../shared/starters';

export type { Suggestion };

/**
 * Home starters from the curated passing pool. No LLM refresh, no network call
 * on shuffle. Count: 3 on phones (≤640px), 4 on desktop. Shuffle stays off
 * until the pool rule is met (≥9 S1 and ≥6 broad).
 */
export function useSuggestions(): {
  items: Suggestion[];
  shuffle: () => void;
  shuffleEnabled: boolean;
} {
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  const [items, setItems] = useState<Suggestion[]>(() => pickShown(typeof window !== 'undefined' ? window.innerWidth : 1280));

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setItems((prev) => {
      const next = pickShown(width);
      // Keep current ids when only the count changes and they still fit.
      if (prev.length === next.length && prev.every((p) => next.some((n) => n.id === p.id))) return prev;
      return next;
    });
  }, [width]);

  const shuffleEnabled = canShuffle();

  const shuffle = useCallback(() => {
    if (!shuffleEnabled) return;
    setItems((prev) => {
      const exclude = new Set(prev.map((p) => p.id));
      const next = pickShown(width, Math.random, exclude);
      // If exclusion emptied a group, fall back to a fresh draw.
      return next.length ? next : pickShown(width);
    });
  }, [shuffleEnabled, width]);

  return { items, shuffle, shuffleEnabled };
}
