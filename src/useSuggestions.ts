import { useCallback, useEffect, useState } from 'react';
import { personalizedStarters } from '../shared/personal';
import {
  canShuffle,
  pickShown,
  type Suggestion,
} from '../shared/starters';

export type { Suggestion };

function load(width: number): { items: Suggestion[]; personalized: boolean } {
  try {
    if (typeof localStorage === 'undefined') return { items: pickShown(width), personalized: false };
    return personalizedStarters(localStorage, width);
  } catch {
    return { items: pickShown(width), personalized: false };
  }
}

/**
 * Home starters. Cold start is the curated Strategy set. Once this device has
 * ask history, the list is the on-device ranking (no network). Shuffle stays
 * off until the pool rule is met.
 */
export function useSuggestions(): {
  items: Suggestion[];
  shuffle: () => void;
  shuffleEnabled: boolean;
  personalized: boolean;
  refresh: () => void;
} {
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  const [rev, setRev] = useState(0);
  const [state, setState] = useState(() => load(typeof window !== 'undefined' ? window.innerWidth : 1280));

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setState(load(width));
  }, [width, rev]);

  const refresh = useCallback(() => setRev((n) => n + 1), []);
  const shuffleEnabled = canShuffle() && !state.personalized;

  const shuffle = useCallback(() => {
    if (!shuffleEnabled) return;
    setState((prev) => {
      const exclude = new Set(prev.items.map((p) => p.id));
      const next = pickShown(width, Math.random, exclude);
      return { items: next.length ? next : pickShown(width), personalized: false };
    });
  }, [shuffleEnabled, width]);

  return { items: state.items, shuffle, shuffleEnabled, personalized: state.personalized, refresh };
}
