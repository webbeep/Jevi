import { useCallback, useEffect, useState } from 'react';
import { ideaBrief, ideasPending, personalizedStarters, readHistory, readIdeaCache, readRelated, relatedSubjects, writeIdeaCache, writeRelated } from '../shared/personal';
import {
  canShuffle,
  pickShown,
  shownCount,
  type Suggestion,
} from '../shared/starters';

export type { Suggestion };

type State = { items: Suggestion[]; personalized: boolean; pending: boolean };

/** Cached ideas, or the template list once we are no longer waiting on the model. */
function settled(width: number): State {
  try {
    if (typeof localStorage === 'undefined') return { items: pickShown(width), personalized: false, pending: false };
    const cached = readIdeaCache(localStorage);
    if (cached?.length) return { items: cached.slice(0, shownCount(width)), personalized: true, pending: false };
    return { ...personalizedStarters(localStorage, width), pending: false };
  } catch {
    return { items: pickShown(width), personalized: false, pending: false };
  }
}

/** History exists and today's ideas are not in yet. The list stays a placeholder until they are. */
function view(width: number): State {
  try {
    if (typeof localStorage !== 'undefined' && ideasPending(localStorage)) {
      return { items: [], personalized: true, pending: true };
    }
  } catch {
    /* storage blocked; show the curated set */
  }
  return settled(width);
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
 * While that call is in flight the rows are a placeholder. The template list appears only if the
 * model fails, times out, or returns nothing usable.
 * Shuffle stays off until the pool rule is met, and stays off once the list is personal.
 */
export function useSuggestions(): {
  items: Suggestion[];
  rows: number;
  shuffle: () => void;
  shuffleEnabled: boolean;
  personalized: boolean;
  pending: boolean;
  refresh: () => void;
} {
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
  const [rev, setRev] = useState(0);
  const [state, setState] = useState(() => view(typeof window !== 'undefined' ? window.innerWidth : 1280));

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setState(view(width));
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
      if (ac.signal.aborted) return;
      setState((prev) => (prev.pending ? prev : settled(width)));
    });
    return () => ac.abort();
  }, [width, rev]);

  useEffect(() => {
    try {
      if (!readHistory(localStorage).length || readIdeaCache(localStorage)) return;
    } catch {
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, 9000);
    const showTemplate = () => {
      if (!cancelled) setState(settled(width));
    };
    const brief = ideaBrief(localStorage);
    void fetch('/api/home-ideas', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ asks: brief.asks, followups: brief.followups, want: 4 }),
      signal: ac.signal,
    })
      .then((res) => res.json() as Promise<{ suggestions?: unknown; source?: unknown }>)
      .then((data) => {
        if (cancelled || (ac.signal.aborted && !timedOut)) return;
        const items = Array.isArray(data.suggestions) ? data.suggestions.filter((row): row is Suggestion => {
          if (!row || typeof row !== 'object') return false;
          const item = row as Suggestion;
          return typeof item.text === 'string' && !!item.text.trim() && typeof item.icon === 'string' && typeof item.id === 'string';
        }) : [];
        if (!items.length) {
          showTemplate();
          return;
        }
        writeIdeaCache(localStorage, items.slice(0, 4).map((item) => ({ ...item, group: item.group === 's1' ? 's1' : 'broad' })), data.source !== 'llm');
        if (!cancelled) setState(settled(width));
      })
      .catch(() => {
        if (cancelled || (ac.signal.aborted && !timedOut)) return;
        showTemplate();
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [width, rev]);

  const refresh = useCallback(() => setRev((n) => n + 1), []);
  const shuffleEnabled = canShuffle() && !state.personalized;

  const shuffle = useCallback(() => {
    if (!shuffleEnabled) return;
    setState((prev) => {
      const exclude = new Set(prev.items.map((p) => p.id));
      const next = pickShown(width, Math.random, exclude);
      return { items: next.length ? next : pickShown(width), personalized: false, pending: false };
    });
  }, [shuffleEnabled, width]);

  return {
    items: state.items,
    rows: shownCount(width),
    shuffle,
    shuffleEnabled,
    personalized: state.personalized,
    pending: state.pending,
    refresh,
  };
}
