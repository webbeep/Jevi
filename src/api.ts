import type { LayoutPlan } from '../shared/card';
import type { HealthResponse, ReadResponse, SlotResponse } from '../shared/types';

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
  plan: (query: string, original?: string, cards?: { id: number; title: string }[]) => call<LayoutPlan>('/api/plan', { query, original, cards }),
  rewrite: (original: string, question: string) => call<{ query: string }>('/api/rewrite', { original, question }),
  slot: (query: string, text: string) => call<SlotResponse>('/api/slot', { query, text }),
  read: (url: string, query: string, content?: string, textOnly = false) => call<ReadResponse>('/api/read', { url, query, content, textOnly }),
  health: () => call<HealthResponse>('/api/health'),
};
