import type {
  AiResult,
  AskRequest,
  AskResponse,
  ComponentKind,
  FillResult,
  Freshness,
  GenerateRequest,
  HealthResponse,
  Layout,
  ReadResponse,
  SearchResponse,
  SlotResponse,
} from '../shared/types';

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export const api = {
  search: (q: string, freshness: Freshness) =>
    call<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}&freshness=${freshness}`),
  layout: (query: string) => call<Layout>('/api/layout', { query }),
  fill: (query: string, search: SearchResponse, blocks: ComponentKind[]) =>
    call<FillResult>('/api/fill', { query, search, blocks }),
  generate: (req: GenerateRequest) => call<AiResult>('/api/generate', req),
  ask: (req: AskRequest) => call<AskResponse>('/api/ask', req),
  slot: (query: string, text: string) => call<SlotResponse>('/api/slot', { query, text }),
  read: (url: string, query: string) => call<ReadResponse>('/api/read', { url, query }),
  health: () => call<HealthResponse>('/api/health'),
};
