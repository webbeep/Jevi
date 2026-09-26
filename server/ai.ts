import type {
  AiResult,
  AiTask,
  AskRequest,
  AskResponse,
  GenerateRequest,
  ReadResponse,
  SearchResult,
  SlotKind,
  SlotResponse,
} from '../shared/types';
import { deepseekJson, hasDeepSeek } from './deepseek';
import { askJev, choice, jevKey, noul } from './jev';
import { Env, UA, clip, fetchText, hedge, stripHtml } from './util';

function sourcesBlock(results: SearchResult[]): string {
  return results
    .slice(0, 10)
    .map((r, i) => `[${i + 1}] ${r.title} (${r.domain}): ${clip(r.snippet, 400)}`)
    .join('\n');
}

const LENGTH_HINT = { short: '2-3 sentences', medium: 'one rich paragraph of 4-6 sentences', long: 'two to three short paragraphs' } as const;

function taskSpec(task: AiTask, req: GenerateRequest): string {
  switch (task) {
    case 'summary':
      return `"summary": string — ${LENGTH_HINT[req.length]}. Use **bold** for the key terms. Cite sources inline like [1] or [2][3].`;
    case 'comparison':
      return '"comparison": { "columns": string[] (the 2-4 things compared), "rows": [{ "label": string (attribute), "values": string[] (one short value per column) }] } — 4 to 7 rows.';
    case 'steps':
      return '"steps": [{ "title": string (imperative, max 8 words), "detail": string (one sentence) }] — 3 to 7 steps.';
    case 'pros_cons':
      return '"pros": string[] and "cons": string[] — 3 to 5 short items each.';
    case 'followups':
      return '"followups": string[] — 4 short, curious follow-up questions the searcher might ask next.';
    default: {
      const unreachable: never = task;
      throw new Error(`Unknown task ${unreachable}`);
    }
  }
}

export async function generate(req: GenerateRequest, env: Env): Promise<AiResult> {
  if (!hasDeepSeek(env) || !req.tasks.length) return {};
  const style = req.simple
    ? 'Write for a 10-year-old: plain words, short sentences, a friendly analogy.'
    : 'Write clearly and concisely for a busy reader who prefers scannable content.';
  const system = `You are the writing engine of a visual search engine. Only use facts supported by the numbered sources; if they are insufficient say so briefly. ${style} Reply with a single JSON object containing exactly these keys:\n${req.tasks.map((t) => `- ${taskSpec(t, req)}`).join('\n')}`;
  const knowledge = req.knowledge ? `\nEncyclopedia: ${req.knowledge.title} — ${clip(req.knowledge.extract, 800)}` : '';
  return deepseekJson<AiResult>(env, system, `Query: ${req.query}\n\nSources:\n${sourcesBlock(req.results)}${knowledge}`);
}

export async function ask(req: AskRequest, env: Env): Promise<AskResponse> {
  let needsSearch = 0.5;
  if (jevKey(env)) {
    try {
      const answers = await askJev(env, `Original search: "${req.query}"\nFollow-up: "${req.question}"\n\nAvailable results:\n${sourcesBlock(req.results)}`, {
        needs_search: {
          type: 'noul',
          instructions: 'Answering the follow-up well requires a new web search, because the available results do not cover it.',
        },
      });
      needsSearch = noul(answers, 'needs_search');
    } catch (err) {
      console.error('Jev ask failed', err);
    }
  }

  if (!hasDeepSeek(env)) return { kind: 'search', query: `${req.query} ${req.question}` };

  if (needsSearch >= 0.6) {
    const { query } = await deepseekJson<{ query: string }>(
      env,
      'Rewrite the follow-up into a standalone web search query of at most 10 words. Reply as JSON: {"query": string}.',
      `Original search: ${req.query}\nFollow-up: ${req.question}`,
      80,
    );
    return { kind: 'search', query: query || req.question };
  }

  const { answer } = await deepseekJson<{ answer: string }>(
    env,
    'Answer the follow-up using the numbered sources, in 2-5 sentences, with **bold** key terms and inline citations like [2]. Reply as JSON: {"answer": string}.',
    `Original search: ${req.query}\nFollow-up: ${req.question}\n\nSources:\n${sourcesBlock(req.results)}`,
    600,
  );
  return { kind: 'answer', answer };
}

const SLOTS: Record<SlotKind, string> = {
  key_point: 'A self-contained fact worth pinning as a key point',
  stat: 'A number, figure, price or statistic',
  timeline: 'An event tied to a specific date or year',
  search: 'A short name, term or topic worth searching for on its own',
  explain: 'A complex or jargon-heavy passage that needs explaining',
};

export async function slot(query: string, text: string, env: Env): Promise<SlotResponse> {
  const year = text.match(/\b((?:1[0-9]|20)\d{2})\b/)?.[1];
  const number = text.match(/[$€£¥]?\s?\d[\d,.]*\s?(?:%|k|m|bn|million|billion|trillion)?/i)?.[0]?.trim();
  let slotKind: SlotKind = text.split(/\s+/).length <= 4 ? 'search' : 'key_point';
  let confidence = 0.4;

  if (jevKey(env)) {
    const answers = await askJev(env, `Search topic: "${query}"\nText the user highlighted: "${clip(text, 1200)}"`, {
      slot: { type: 'choice', instructions: 'Where does the highlighted text best belong in the results page?', criteria: SLOTS },
    });
    const c = choice(answers, 'slot');
    if (c) {
      slotKind = c.choice as SlotKind;
      confidence = c.confidence;
    }
  }
  if (slotKind === 'stat' && !number) slotKind = 'key_point';
  if (slotKind === 'timeline' && !year) slotKind = 'key_point';

  return {
    slot: slotKind,
    confidence,
    stat: slotKind === 'stat' && number ? { value: number, label: clip(text, 110) } : undefined,
    timeline: slotKind === 'timeline' && year ? { when: year, text: clip(text, 160) } : undefined,
  };
}

async function fetchPage(url: string, env: Env): Promise<{ title: string; text: string }> {
  const viaJina = async () => {
    const headers: Record<string, string> = { 'X-Return-Format': 'text', 'User-Agent': UA };
    if (env.JINA_API_KEY) headers.Authorization = `Bearer ${env.JINA_API_KEY}`;
    const text = await fetchText(`https://r.jina.ai/${url}`, { headers }, 12000);
    return { title: text.match(/^Title:\s*(.+)$/m)?.[1] ?? url, text };
  };
  const viaHtml = (fetchUrl: string) => async () => {
    const html = await fetchText(fetchUrl, { headers: { 'User-Agent': UA } }, 10000);
    const body = html.replace(/<(script|style|nav|footer|header|noscript)[\s\S]*?<\/\1>/gi, ' ');
    return { title: stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? url), text: stripHtml(body) };
  };
  const readable = (task: () => Promise<{ title: string; text: string }>) => async () => {
    const page = await task();
    if (page.text.length < 200) throw new Error('Page had no readable text');
    return page;
  };
  try {
    return await hedge([viaHtml(url), viaJina, viaHtml(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`)].map(readable), 1500);
  } catch {
    throw new Error('Could not read this page (it may block bots)');
  }
}

export async function read(url: string, query: string, env: Env): Promise<ReadResponse> {
  const page = await fetchPage(url, env);
  if (!hasDeepSeek(env)) {
    const sentences = page.text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 50);
    return { url, title: page.title, tldr: clip(sentences.slice(0, 2).join(' '), 400), bullets: sentences.slice(2, 6).map((s) => clip(s, 200)) };
  }
  const out = await deepseekJson<{ tldr: string; bullets: string[] }>(
    env,
    'Digest the web page for a visual reader. Reply as JSON: {"tldr": string (2 sentences), "bullets": string[] (4-6 concrete takeaways, most relevant to the query first)}.',
    `Query: ${query}\nPage title: ${page.title}\n\n${clip(page.text, 12000)}`,
    700,
  );
  return { url, title: page.title, tldr: out.tldr, bullets: out.bullets ?? [] };
}
