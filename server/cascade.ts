import { cleanMarkdown } from '../shared/text';
import type { EngineStatus, Freshness, ImageResult } from '../shared/types';
import { fetchBackup } from './backup';
import { SEARCH_CALL_CAP, type CallLedger, engineDead, failureOf, rememberDead, searchCalls } from './budget';
import { type Env, clip, domainOf, fetchJson } from './util';

const ENGINE_TIMEOUT_MS = 6500;

export interface WebHit {
  title: string;
  url: string;
  snippet: string;
  image?: string;
  date?: string;
  content?: string;
}

export interface CascadeResult {
  engine: string;
  hits: WebHit[];
  images: ImageResult[];
  statuses: EngineStatus[];
}

interface Query {
  q: string;
  freshness: Freshness;
  count: number;
}

const DAYS: Record<Exclude<Freshness, 'any'>, number> = { day: 1, week: 7, month: 30, year: 365 };

async function exaSearch(q: Query, env: Env): Promise<{ hits: WebHit[]; images: ImageResult[] }> {
  const since = q.freshness === 'any' ? undefined : new Date(Date.now() - DAYS[q.freshness] * 86_400_000).toISOString();
  const data = await fetchJson<{
    results?: { title?: string; url: string; publishedDate?: string; image?: string; text?: string; highlights?: string[] }[];
  }>(
    'https://api.exa.ai/search',
    {
      method: 'POST',
      headers: { 'x-api-key': env.EXA_API_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: q.q,
        numResults: 8,
        type: 'fast',
        contents: { text: { maxCharacters: 2000 } },
        ...(since ? { startPublishedDate: since } : {}),
      }),
    },
    ENGINE_TIMEOUT_MS,
  );
  const hits = (data.results ?? []).map((r) => {
    const text = r.text ? cleanMarkdown(r.text) : '';
    return {
      title: r.title || domainOf(r.url),
      url: r.url,
      snippet: clip(r.highlights?.[0] ?? text.replace(/\n/g, ' '), 320),
      date: r.publishedDate,
      image: r.image,
      content: text.length > 300 ? text : undefined,
    };
  });
  return { hits, images: [] };
}

async function tavilySearch(q: Query, env: Env): Promise<{ hits: WebHit[]; images: ImageResult[] }> {
  const data = await fetchJson<{
    results?: { title: string; url: string; content: string; raw_content?: string | null; published_date?: string }[];
    images?: (string | { url: string; description?: string })[];
  }>(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TAVILY_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q.q,
          max_results: 8,
          include_images: true,
          time_range: q.freshness === 'any' ? undefined : q.freshness,
        }),
    },
    ENGINE_TIMEOUT_MS,
  );
  return {
    hits: (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: clip(r.content ?? '', 320),
      date: r.published_date,
      content: r.content && r.content.length > 300 ? r.content : undefined,
    })),
    images: (data.images ?? []).map((img) => {
      const url = typeof img === 'string' ? img : img.url;
      return {
        url,
        thumb: url,
        title: typeof img === 'string' ? '' : img.description ?? '',
        source: domainOf(url),
        license: 'source' as const,
        credit: domainOf(url).replace(/^(cdn|images?|img|static|media|assets)\d*\./, ''),
      };
    }),
  };
}

type StepName = 'exa' | 'tavily' | 'backup';

/**
 * Exa, then Tavily, then the keyless backup. The next engine runs only after a
 * credit, quota, auth, timeout, upstream, or empty failure. Dead engines are
 * skipped without a call. At most SEARCH_CALL_CAP calls.
 */
export async function cascadeWeb(q: Query, env: Env, ledger: CallLedger): Promise<CascadeResult> {
  const statuses: EngineStatus[] = [];
  const steps: { name: StepName; enabled: boolean; run: () => Promise<{ hits: WebHit[]; images: ImageResult[] }> }[] = [
    { name: 'exa', enabled: !!env.EXA_API_KEY, run: () => exaSearch(q, env) },
    { name: 'tavily', enabled: !!env.TAVILY_API_KEY, run: () => tavilySearch(q, env) },
    { name: 'backup', enabled: true, run: async () => ({ hits: await fetchBackup(q.q, q.freshness), images: [] }) },
  ];

  for (const step of steps) {
    if (!step.enabled) continue;
    if (engineDead(step.name)) {
      ledger.fellThrough.push(`${step.name}:skipped`);
      statuses.push({ name: step.name, ok: false, count: 0, ms: 0, error: 'skipped' });
      continue;
    }
    if (searchCalls(ledger) >= SEARCH_CALL_CAP) {
      ledger.fellThrough.push(`${step.name}:cap`);
      break;
    }
    ledger.search[step.name] += 1;
    const started = Date.now();
    try {
      const out = await step.run();
      const hits = out.hits.filter((h) => h.url && h.title);
      if (!hits.length) {
        ledger.fellThrough.push(`${step.name}:empty`);
        statuses.push({ name: step.name, ok: false, count: 0, ms: Date.now() - started, error: 'empty' });
        continue;
      }
      statuses.push({ name: step.name, ok: true, count: hits.length, ms: Date.now() - started });
      return { engine: step.name, hits, images: out.images, statuses };
    } catch (err) {
      const failure = failureOf(err);
      if (failure.dead) rememberDead(step.name);
      ledger.fellThrough.push(`${step.name}:${failure.reason}`);
      statuses.push({ name: step.name, ok: false, count: 0, ms: Date.now() - started, error: failure.reason });
      if (!failure.fall) break;
    }
  }
  return { engine: 'none', hits: [], images: [], statuses };
}
