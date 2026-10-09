import { useCallback, useEffect, useState } from 'react';
import { personalizedStarters, readHistory, readRelated, relatedSubjects, writeRelated } from '../shared/personal';
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

/** Subjects of the newest asks that have no fresh related searches yet. */
function missingRelated(): { key: string; query: string }[] {
  try {
    return relatedSubjects(readHistory(localStorage), readRelated(localStorage));
  } catch {
    return [];
  }
}

/**
 * Home starters. Cold start is the curated Strategy set. Once this device has ask history, the list
 * is built on-device from the newest asks, then enriched with popular related searches for those
 * subjects (the free suggest endpoint, cached 6h). Shuffle stays off until the pool rule is met.
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

  useEffect(() => {
    const subjects = missingRelated();
    if (!subjects.length) return;
    const ac = new AbortController();
    void Promise.all(subjects.map(({ key, query }) =>
      fetch(`/api/suggest-typeahead?q=${encodeURIComponent(query)}`, { signal: ac.signal })
        .then((res) => res.json() as Promise<{ suggestions?: unknown }>)
        .then((data) => {
          const list = Array.isArray(data.suggestions) ? data.suggestions.filter((s): s is string => typeof s === 'string') : [];
          writeRelated(localStorage, key, list);
        })
        .catch(() => undefined),
    )).then(() => {
      if (!ac.signal.aborted) setState(load(width));
    });
    return () => ac.abort();
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
