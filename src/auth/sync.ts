import { useSyncExternalStore } from 'react';
import { HISTORY_KEY, categorize, readHistory } from '../../shared/personal';
import { track } from './events';
import { capHistory, mergeHistory } from './logic';
import { getAuth } from './store';

let syncOn = false;
let touched = false;
let mergedFor: string | null = null;
let timer = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSyncEnabled() {
  return useSyncExternalStore(subscribe, () => syncOn, () => false);
}

export function resetSyncLocal() {
  syncOn = false;
  touched = false;
  mergedFor = null;
  window.clearTimeout(timer);
  emit();
}

async function putPrefs(body: { sync_history?: boolean; history?: string[] }) {
  await fetch('/api/account/prefs', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function deviceQueries(): string[] {
  try {
    return capHistory(readHistory(localStorage).map((row) => row.q));
  } catch {
    return [];
  }
}

async function pushDeviceHistory() {
  if (!syncOn || !getAuth().signedIn) return;
  try {
    await putPrefs({ sync_history: true, history: deviceQueries() });
  } catch {
    /* ignore */
  }
}

function writeMerged(rows: { q: string; t: number }[]) {
  const payload = rows.map((row) => ({ q: row.q, t: row.t, cat: categorize(row.q) }));
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(payload));
    window.dispatchEvent(new Event('zo-history'));
  } catch {
    /* quota */
  }
}

/** Pull server history into this device once per signed-in user on this page. */
export async function loadPrefsAndMaybeMerge() {
  if (!getAuth().enabled || !getAuth().signedIn) return;
  try {
    const res = await fetch('/api/account/prefs', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = (await res.json()) as { sync_history?: unknown; history?: unknown };
    if (touched) return;
    const on = data.sync_history === true;
    syncOn = on;
    emit();
    if (!on) return;
    const id = getAuth().user?.id || getAuth().user?.email || 'signed-in';
    if (mergedFor === id) return;
    mergedFor = id;
    const server = Array.isArray(data.history) ? data.history.filter((item): item is string => typeof item === 'string') : [];
    let device: { q: string; t: number }[] = [];
    try {
      device = readHistory(localStorage);
    } catch {
      device = [];
    }
    writeMerged(mergeHistory(device, server));
    await pushDeviceHistory();
  } catch {
    /* prefs stay off */
  }
}

/** Debounced push after a device ask, only while sync is on. */
export function noteDeviceAsk() {
  if (!getAuth().enabled || !getAuth().signedIn || !syncOn) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    void pushDeviceHistory();
  }, 800);
}

export async function setSyncEnabled(on: boolean) {
  if (on === syncOn) return;
  touched = true;
  syncOn = on;
  emit();
  track('sync_toggle', { on });
  window.clearTimeout(timer);
  if (!on) {
    try {
      await putPrefs({ sync_history: false });
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    const res = await fetch('/api/account/prefs', { credentials: 'same-origin' });
    if (res.ok) {
      const data = (await res.json()) as { history?: unknown };
      const server = Array.isArray(data.history) ? data.history.filter((item): item is string => typeof item === 'string') : [];
      const id = getAuth().user?.id || getAuth().user?.email || 'signed-in';
      if (server.length && mergedFor !== id) {
        mergedFor = id;
        let device: { q: string; t: number }[] = [];
        try {
          device = readHistory(localStorage);
        } catch {
          device = [];
        }
        writeMerged(mergeHistory(device, server));
      }
    }
  } catch {
    /* upload the device copy anyway */
  }
  await pushDeviceHistory();
}

/** Clear the server copy while leaving sync on. */
export async function clearSyncedHistory() {
  if (!syncOn || !getAuth().signedIn) return;
  window.clearTimeout(timer);
  try {
    await putPrefs({ sync_history: true, history: [] });
  } catch {
    /* ignore */
  }
}
