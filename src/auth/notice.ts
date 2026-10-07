import { useSyncExternalStore } from 'react';

export type AuthNotice = { kind: 'cancelled' } | { kind: 'error'; outOfFree: boolean } | { kind: 'cap' };

let notice: AuthNotice | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function setAuthNotice(next: AuthNotice | null) {
  notice = next;
  emit();
}

export function getAuthNotice() {
  return notice;
}

export function useAuthNotice() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getAuthNotice,
    getAuthNotice,
  );
}
