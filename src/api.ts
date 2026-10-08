import type { LayoutPlan } from '../shared/card';
import type { HealthResponse, SlotResponse } from '../shared/types';

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export const api = {
  plan: (query: string, original?: string, cards?: { id: number; title: string }[], context?: string) => call<LayoutPlan>('/api/plan', { query, original, cards, context }),
  rewrite: (original: string, question: string, context?: string) => call<{ query: string }>('/api/rewrite', { original, question, context }),
  slot: (query: string, text: string) => call<SlotResponse>('/api/slot', { query, text }),
  health: () => call<HealthResponse>('/api/health'),
};
