import { useSyncExternalStore } from 'react';
import type { AnswerCard } from '../../shared/card';
import { ssDel, ssGet, ssSet } from './storage';

const PENDING = 'zo_pending_save';

let byQuery = new Map<string, string>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSavedId(query: string): string | undefined {
  return useSyncExternalStore(subscribe, () => byQuery.get(query), () => byQuery.get(query));
}

export function rememberSave(query: string, id: string) {
  const next = new Map(byQuery);
  next.set(query, id);
  byQuery = next;
  emit();
}

export function forgetSave(query: string) {
  if (!byQuery.has(query)) return;
  const next = new Map(byQuery);
  next.delete(query);
  byQuery = next;
  emit();
}

export function rememberPendingSave(payload: { query: string; title: string; card: AnswerCard }) {
  try {
    ssSet(PENDING, JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

export async function flushPendingSave() {
  const raw = ssGet(PENDING);
  if (!raw) return;
  ssDel(PENDING);
  let body: { query?: string; title?: string; card?: AnswerCard };
  try {
    body = JSON.parse(raw) as { query?: string; title?: string; card?: AnswerCard };
  } catch {
    return;
  }
  if (!body.query || !body.card) return;
  try {
    const res = await fetch('/api/saves', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: body.query, title: body.title ?? body.card.title, card: body.card }),
    });
    if (!res.ok) return;
    const data = (await res.json().catch(() => ({}))) as { id?: string | number };
    if (data.id != null) rememberSave(body.query, String(data.id));
  } catch {
    /* ignore */
  }
}

export async function postOptIn(value: boolean) {
  try {
    await fetch('/api/auth/optin', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
  } catch {
    /* 404 until the endpoint exists */
  }
}
