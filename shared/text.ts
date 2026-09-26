const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", hellip: '…', mdash: '—', ndash: '–',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
    const lower = e.toLowerCase();
    if (ENTITIES[lower]) return ENTITIES[lower];
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return m;
  });
}

export function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export interface ParsedHit {
  title: string;
  url: string;
  snippet: string;
}

function unwrapDdgUrl(href: string): string | undefined {
  let url = href.replace(/&amp;/g, '&');
  if (url.includes('uddg=')) {
    const target = new URL(url.startsWith('//') ? `https:${url}` : url, 'https://duckduckgo.com').searchParams.get('uddg');
    if (!target) return undefined;
    url = target;
  }
  if (!/^https?:\/\//.test(url) || url.includes('duckduckgo.com/y.js')) return undefined;
  return url;
}

/** Parses both html.duckduckgo.com and lite.duckduckgo.com result pages. */
export function parseDuckDuckGo(html: string): ParsedHit[] {
  const hits: ParsedHit[] = [];
  for (const chunk of html.split('result__title').slice(1)) {
    const anchor = chunk.match(/<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const href = anchor?.[0].match(/href="([^"]+)"/)?.[1];
    const url = href && unwrapDdgUrl(href);
    if (!anchor || !url) continue;
    const snippet = chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/)?.[1] ?? '';
    hits.push({ title: stripHtml(anchor[1]), url, snippet: stripHtml(snippet) });
  }
  if (hits.length) return hits;

  for (const m of html.matchAll(/<a([^>]*class=['"]result-link['"][^>]*)>([\s\S]*?)<\/a>/g)) {
    const href = m[1].match(/href=["']([^"']+)["']/)?.[1];
    const url = href && unwrapDdgUrl(href);
    if (!url || /^\s*more info\s*$/i.test(stripHtml(m[2]))) continue;
    const after = html.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 3000);
    const snippet = after.match(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/)?.[1] ?? '';
    hits.push({ title: stripHtml(m[2]), url, snippet: stripHtml(snippet) });
  }
  return hits;
}
