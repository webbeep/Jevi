import type {
  ReadResponse,
  SlotKind,
  SlotResponse,
} from '../shared/types';
import { deepseekJson, hasDeepSeek } from './deepseek';
import { askJev, choice, jevKey } from './jev';
import { pageText } from './pages';
import { Env, clip } from './util';

export async function rewriteQuery(original: string, question: string, env: Env): Promise<string> {
  if (!hasDeepSeek(env)) return `${original} ${question}`;
  const { query } = await deepseekJson<{ query: string }>(
    env,
    'Rewrite the follow-up into a standalone web search query of at most 10 words. Reply as JSON: {"query": string}.',
    `Original search: ${original}\nFollow-up: ${question}`,
    80,
  );
  return query?.trim() || question;
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

export async function read(url: string, query: string, env: Env, known?: string, textOnly = false): Promise<ReadResponse> {
  const text = known && known.length > 300 ? known : await pageText(url, env, 9000, 12000);
  const title = text.split('\n')[0].slice(0, 120);
  if (textOnly) return { url, title, text, tldr: '', bullets: [] };
  if (!hasDeepSeek(env)) {
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 50);
    return { url, title, text, tldr: clip(sentences.slice(0, 2).join(' '), 400), bullets: sentences.slice(2, 6).map((s) => clip(s, 200)) };
  }
  const out = await deepseekJson<{ title?: string; tldr: string; bullets: string[] }>(
    env,
    'Digest the web page for a visual reader. Reply as JSON: {"title": string (the page title), "tldr": string (2 sentences), "bullets": string[] (4-6 concrete takeaways, most relevant to the query first)}.',
    `Query: ${query}\n\n${clip(text, 12000)}`,
    700,
  );
  return { url, title: out.title || title, text, tldr: out.tldr, bullets: out.bullets ?? [] };
}
