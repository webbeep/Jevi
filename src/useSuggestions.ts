import { useCallback, useEffect, useState } from 'react';
import { ideaBrief, personalizedStarters, readHistory, readIdeaCache, readRelated, relatedSubjects, writeIdeaCache, writeRelated } from '../shared/personal';
import {
  canShuffle,
  pickShown,
  shownCount,
  type Suggestion,
} from '../shared/starters';

export type { Suggestion };

function load(width: number): { items: Suggestion[]; personalized: boolean } {
  try {
    if (typeof localStorage === 'undefined') return { items: pickShown(width), personalized: false };
    const cached = readIdeaCache(localStorage);
    if (cached?.length) return { items: cached.slice(0, shownCount(width)), personalized: true };
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
 * Home starters. Cold start is the curated Strategy set. Once this device has ask history, a model
 * writes the next set from those asks and the follow-ups already shown, and that set lasts a day.
 * Until it answers, and whenever it fails, the rows are the template list (one next ask per subject).
 * Shuffle stays off until the pool rule is met, and stays off once the list is personal.
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

  useEffect(() => {
    let history: { q: string }[] = [];
    try {
      history = readHistory(localStorage);
      if (!history.length || readIdeaCache(localStorage)) return;
    } catch {
      return;
    }
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), 9000);
    const brief = ideaBrief(localStorage);
    void fetch('/api/home-ideas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ asks: brief.asks, followups: brief.followups, want: 4 }),
      signal: ac.signal,
    })
      .then((res) => res.json() as Promise<{ suggestions?: unknown; source?: unknown }>)
      .then((data) => {
        if (ac.signal.aborted) return;
        const items = Array.isArray(data.suggestions) ? data.suggestions.filter((row): row is Suggestion => {
          if (!row || typeof row !== 'object') return false;
          const item = row as Suggestion;
          return typeof item.text === 'string' && !!item.text.trim() && typeof item.icon === 'string' && typeof item.id === 'string';
        }) : [];
        if (!items.length) return;
        writeIdeaCache(localStorage, items.slice(0, 4).map((item) => ({ ...item, group: item.group === 's1' ? 's1' : 'broad' })), data.source !== 'llm');
        setState(load(width));
      })
      .catch(() => undefined)
      .finally(() => window.clearTimeout(timer));
    return () => {
      ac.abort();
      window.clearTimeout(timer);
    };
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
