import { useEffect, useState } from 'react';

export interface Suggestion {
  text: string;
  icon: string;
}

const STORAGE_KEY = 'zo:suggestions';

const DEFAULTS: Suggestion[] = [
  { text: 'Plan a 3-day Tokyo trip on a budget', icon: 'map' },
  { text: 'iPhone 17 or Pixel 10 for photos?', icon: 'smartphone' },
  { text: 'Dinner ideas with chicken and rice', icon: 'chef-hat' },
  { text: 'Explain how mortgages work', icon: 'graduation-cap' },
  { text: '8-week plan to run my first 10K', icon: 'footprints' },
  { text: 'Is now a good time to buy a TV?', icon: 'tv' },
];

function stored(): Suggestion[] | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Suggestion[] | null;
    return parsed?.length ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Starter prompts: shown instantly from the last generated set (or defaults on a
 * first visit), then refreshed from the server for this and the next visit.
 */
export function useSuggestions(): Suggestion[] {
  const [items, setItems] = useState<Suggestion[]>(() => stored() ?? DEFAULTS);

  useEffect(() => {
    const hadStored = !!stored();
    fetch('/api/suggestions')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(({ suggestions }: { suggestions: Suggestion[] }) => {
        if (!suggestions?.length) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(suggestions));
        // Swap in fresh ideas only on a first visit; returning visitors see them next time instead of a list changing under their cursor.
        if (!hadStored) setItems(suggestions);
      })
      .catch(() => undefined);
  }, []);

  return items;
}
