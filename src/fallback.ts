import { parseDuckDuckGo } from '../shared/text';
import type { SearchResponse, SearchResult } from '../shared/types';

const MIN_RESULTS = 6;

const PROXIES = [
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u: string) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
];

async function viaProxy(target: string): Promise<SearchResult[]> {
  return Promise.any(
    PROXIES.map(async (proxy, i) => {
      await new Promise((r) => setTimeout(r, i * 800));
      const res = await fetch(proxy(target), { signal: AbortSignal.timeout(7000) });
      const hits = parseDuckDuckGo(await res.text());
      if (!hits.length) throw new Error('no results');
      return hits.map((h) => ({ ...h, domain: new URL(h.url).hostname.replace(/^www\./, ''), engines: ['duckduckgo-proxy'] }));
    }),
  );
}

/** When server-side engines are rate-limited, fetch DuckDuckGo from the browser through public CORS proxies. */
export async function withBrowserFallback(s: SearchResponse): Promise<SearchResponse> {
  if (s.results.length >= MIN_RESULTS) return s;
  try {
    const extra = await viaProxy(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(s.query)}`);
    const seen = new Set(s.results.map((r) => r.url));
    return {
      ...s,
      results: [...s.results, ...extra.filter((r) => !seen.has(r.url))].slice(0, 20),
      engines: [...s.engines, { name: 'browser-proxy', ok: true, count: extra.length, ms: 0 }],
    };
  } catch {
    return s;
  }
}
