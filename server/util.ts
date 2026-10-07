export type Env = Record<string, string | undefined>;

export const UA = 'Mozilla/5.0 (compatible; ZoBot/1.0; +https://zo.page)';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/** Client errors (4xx) explain themselves; server errors are logged, not echoed, since they can carry provider responses. */
export function errorJson(err: unknown, status = 500): Response {
  const message = err instanceof Error ? err.message : String(err);
  if (status >= 500) console.error(message);
  return json({ error: status >= 500 ? 'Something went wrong. Please try again.' : message }, status);
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

/**
 * Resolves with the first task to succeed. The next task starts when the previous one fails or after
 * `staggerMs`, and none start once one has succeeded: every fetch counts against the 50-subrequest cap.
 */
export function hedge<T>(tasks: (() => Promise<T>)[], staggerMs = 700): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!tasks.length) return reject(new AggregateError([], 'nothing to try'));
    const errors: unknown[] = [];
    let next = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const launch = () => {
      clearTimeout(timer);
      if (settled || next >= tasks.length) return;
      const task = tasks[next++];
      if (next < tasks.length) timer = setTimeout(launch, staggerMs);
      task().then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          errors.push(err);
          if (errors.length === tasks.length) {
            settled = true;
            reject(new AggregateError(errors, 'all attempts failed'));
          } else launch();
        },
      );
    };
    launch();
  });
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
