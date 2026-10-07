import type { FollowupIntent } from '../../shared/card';
import { ssDel, ssGet, ssSet } from './storage';

const KEY = 'zo_pending_q';

export interface PendingQ {
  q: string;
  kind: 'search' | 'followup';
  fromId?: number;
  intent?: FollowupIntent;
}

function parse(raw: string | null): PendingQ | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as PendingQ;
    if (!data || typeof data.q !== 'string' || (data.kind !== 'search' && data.kind !== 'followup')) return null;
    return data;
  } catch {
    return null;
  }
}

export function savePending(p: PendingQ) {
  ssSet(KEY, JSON.stringify(p));
}

export function peekPending(): PendingQ | null {
  return parse(ssGet(KEY));
}

export function takePending(): PendingQ | null {
  const pending = peekPending();
  ssDel(KEY);
  return pending;
}

export function clearPending() {
  ssDel(KEY);
}
