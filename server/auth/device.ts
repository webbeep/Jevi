import { hmacB64url, randomId, safeEqual } from './crypto.ts';

const NAME = 'zo_dev';
const YEAR = 60 * 60 * 24 * 365;

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return null;
}

export function upsertCookie(header: string | null, name: string, value: string): string {
  const kept = (header || '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && s.slice(0, s.indexOf('=')) !== name);
  kept.push(`${name}=${encodeURIComponent(value)}`);
  return kept.join('; ');
}

function secureAttr(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  return proto === 'https' ? '; Secure' : '';
}

export function deviceCookie(value: string, request: Request): string {
  return `${NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR}; HttpOnly; SameSite=Lax${secureAttr(request)}`;
}

export async function signDevice(id: string, secret: string): Promise<string> {
  return `${id}.${await hmacB64url(secret, id)}`;
}

export async function verifyDevice(value: string, secret: string): Promise<string | null> {
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  const expected = await hmacB64url(secret, id);
  return safeEqual(sig, expected) ? id : null;
}

export type Device = { id: string; fresh: boolean; setCookie?: string };

/** Signed zo_dev cookie. Returns null when there is no session secret to sign with. */
export async function ensureDevice(request: Request, secret: string | undefined): Promise<Device | null> {
  if (!secret) return null;
  const existing = readCookie(request.headers.get('cookie'), NAME);
  if (existing) {
    const id = await verifyDevice(existing, secret);
    if (id) return { id, fresh: false };
  }
  const id = randomId();
  const value = await signDevice(id, secret);
  return { id, fresh: true, setCookie: deviceCookie(value, request) };
}

export function withDevice(request: Request, device: Device | null): Request {
  if (!device?.fresh || !device.setCookie) return request;
  const raw = device.setCookie.split(';')[0] ?? '';
  const eq = raw.indexOf('=');
  const value = decodeURIComponent(raw.slice(eq + 1));
  const headers = new Headers(request.headers);
  headers.set('cookie', upsertCookie(request.headers.get('cookie'), NAME, value));
  return new Request(request, { headers });
}

export function stampDevice(response: Response, device: Device | null): Response {
  if (!device?.fresh || !device.setCookie) return response;
  response.headers.append('set-cookie', device.setCookie);
  return response;
}
