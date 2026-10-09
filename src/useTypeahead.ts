import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { STARTERS } from '../shared/starters';
import { readHistory } from '../shared/personal';
import {
  MIN_PREFIX,
  createDebouncer,
  matchLocal,
  mergeSuggestions,
  normalizePrefix,
} from '../shared/typeahead';

const FALLBACK = STARTERS.map((s) => s.text);
const LIST_ID = 'home-typeahead';
const DEBOUNCE_MS = 120;

const clientCache = new Map<string, string[]>();

export function clearTypeaheadClientCache(): void {
  clientCache.clear();
}

export function useTypeahead(input: string, onFill: (text: string) => void, revision: number) {
  const [remote, setRemote] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);
  const onFillRef = useRef(onFill);
  const skipOpen = useRef(false);
  onFillRef.current = onFill;

  const history = useMemo(() => {
    try {
      return readHistory(localStorage).map((h) => h.q);
    } catch {
      return [];
    }
  }, [revision]);

  const rows = useMemo(() => {
    if (normalizePrefix(input).length < MIN_PREFIX) return [];
    return mergeSuggestions(matchLocal(history, input), remote, matchLocal(FALLBACK, input), input);
  }, [history, input, remote]);

  useEffect(() => {
    setActive(-1);
    if (skipOpen.current) {
      skipOpen.current = false;
      setDismissed(true);
      return;
    }
    setDismissed(false);
  }, [input]);

  useEffect(() => {
    const prefix = normalizePrefix(input);
    if (prefix.length < MIN_PREFIX) {
      abortRef.current?.abort();
      setRemote([]);
      return;
    }
    let alive = true;
    const debounced = createDebouncer(() => {
      const hit = clientCache.get(prefix);
      if (hit) {
        if (alive) setRemote(hit);
        return;
      }
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      fetch(`/api/suggest-typeahead?q=${encodeURIComponent(prefix)}`, { signal: ac.signal })
        .then((res) => res.json() as Promise<{ suggestions?: unknown }>)
        .then((data) => {
          const list = Array.isArray(data.suggestions) ? data.suggestions.filter((s): s is string => typeof s === 'string') : [];
          clientCache.set(prefix, list);
          if (alive) setRemote(list);
        })
        .catch(() => {
          if (alive && !ac.signal.aborted) setRemote([]);
        });
    }, DEBOUNCE_MS);
    debounced();
    return () => {
      alive = false;
      debounced.cancel();
      abortRef.current?.abort();
    };
  }, [input]);

  const open = !dismissed && rows.length > 0;

  const close = () => {
    setDismissed(true);
    setActive(-1);
  };

  const pick = (text: string) => {
    skipOpen.current = true;
    onFillRef.current(text);
    setDismissed(true);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        close();
      }
      return;
    }
    if (!rows.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setDismissed(false);
      setActive((i) => (i + 1) % rows.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setDismissed(false);
      setActive((i) => (i <= 0 ? rows.length - 1 : i - 1));
      return;
    }
    if (e.key === 'Enter' && open && active >= 0 && rows[active]) {
      e.preventDefault();
      pick(rows[active].text);
    }
  };

  return {
    rows,
    open,
    active,
    listId: LIST_ID,
    activeId: open && active >= 0 ? `${LIST_ID}-opt-${active}` : undefined,
    onKeyDown,
    onFocus: () => setDismissed(false),
    onBlur: () => {
      window.setTimeout(() => setDismissed(true), 120);
    },
    close,
    pick,
  };
}

export type { TypeaheadSuggestion } from '../shared/typeahead';
