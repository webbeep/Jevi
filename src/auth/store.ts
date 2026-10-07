import { useSyncExternalStore } from 'react';
import { setUsageListener } from '../sse';
import { lsGet, lsSet } from './storage';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  new_user?: boolean;
}

export interface AuthState {
  enabled: boolean;
  ready: boolean;
  user: AuthUser | null;
  used: number;
  limit: number;
  remaining: number;
  signedIn: boolean;
  day: string;
  arm?: string;
  googleClientId?: string;
  optinAsked: boolean;
  emailOptIn: boolean;
}

const empty: AuthState = {
  enabled: false,
  ready: false,
  user: null,
  used: 0,
  limit: 0,
  remaining: 0,
  signedIn: false,
  day: '',
  optinAsked: false,
  emailOptIn: false,
};

let state: AuthState = empty;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function setState(next: AuthState) {
  state = next;
  emit();
}

export function getAuth() {
  return state;
}

export function useAuth() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getAuth,
    getAuth,
  );
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asUser(value: unknown): AuthUser | null {
  if (!value || typeof value !== 'object') return null;
  const user = value as Record<string, unknown>;
  if (typeof user.email !== 'string' || !user.email) return null;
  return {
    id: typeof user.id === 'string' ? user.id : '',
    email: user.email,
    name: typeof user.name === 'string' ? user.name : null,
    avatar: typeof user.avatar === 'string' ? user.avatar : null,
    new_user: user.new_user === true ? true : user.new_user === false ? false : undefined,
  };
}

export function applyUsage(partial: Partial<Pick<AuthState, 'used' | 'limit' | 'remaining' | 'signedIn'>>) {
  setState({ ...state, ...partial });
}

export function setEmailOptIn(value: boolean) {
  setState({ ...state, emailOptIn: value });
}

export function markOptinAsked() {
  lsSet('zo_optin_asked', '1');
  setState({ ...state, optinAsked: true });
}

export function optInPending() {
  if (!state.enabled || !state.signedIn || state.optinAsked) return false;
  return lsGet('zo_optin_asked') !== '1';
}

/** Flat G-API body or Backend's nested `usage` object. */
export function parseMe(data: Record<string, unknown>): AuthState {
  const usage = data.usage && typeof data.usage === 'object' && !Array.isArray(data.usage) ? (data.usage as Record<string, unknown>) : null;
  const user = asUser(data.user);
  const used = num(data.used ?? usage?.used);
  const limit = num(data.limit ?? usage?.limit);
  const rawRemaining = data.remaining ?? usage?.remaining;
  const remaining = rawRemaining == null ? Math.max(0, limit - used) : num(rawRemaining);
  const day = typeof data.day === 'string' ? data.day : typeof usage?.day === 'string' ? usage.day : '';
  const optinAsked = data.optin_asked === true || (user != null && (data.user as Record<string, unknown>).optin_asked === true);
  if (optinAsked) lsSet('zo_optin_asked', '1');
  const arm = data.arm ?? usage?.arm;
  return {
    enabled: true,
    ready: true,
    user,
    used,
    limit,
    remaining,
    signedIn: typeof data.signedIn === 'boolean' ? data.signedIn : !!user,
    day,
    arm: typeof arm === 'string' || typeof arm === 'number' ? String(arm) : undefined,
    googleClientId: typeof data.google_client_id === 'string' ? data.google_client_id : undefined,
    optinAsked,
    emailOptIn: data.email_optin === true || (user != null && (data.user as Record<string, unknown>).email_optin === true),
  };
}

export async function refresh() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as Record<string, unknown> | null;
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.auth_enabled === false) {
      setState({ ...empty, ready: true });
      return;
    }
    setState(parseMe(data));
  } catch {
    setState({ ...empty, ready: true });
  }
}

setUsageListener((usage) => applyUsage(usage));
