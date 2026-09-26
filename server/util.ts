export type Env = Record<string, string | undefined>;

export const UA = 'Mozilla/5.0 (compatible; JeviSearch/1.0; +https://jevi.pages.dev)';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function errorJson(err: unknown, status = 500): Response {
  return json({ error: err instanceof Error ? err.message : String(err) }, status);
}

export async function fetchJson<T>(url: string, init: RequestInit = {}, ms = 5000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchText(url: string, init: RequestInit = {}, ms = 5000): Promise<string> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Starts each task after a stagger and resolves with the first success. */
export function hedge<T>(tasks: (() => Promise<T>)[], staggerMs = 700): Promise<T> {
  return Promise.any(
    tasks.map((task, i) => new Promise<void>((r) => setTimeout(r, i * staggerMs)).then(task)),
  );
}

export { decodeEntities, stripHtml } from '../shared/text';

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error('Invalid JSON body');
  }
}
