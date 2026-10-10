import type { AnswerCard } from './card';

/** A search row kept with a history card so a video, link, or citation can open again. */
export interface HistorySource {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  image?: string;
  date?: string;
}

const MAX_SOURCES = 16;

/**
 * Title, url, and a short snippet, in the same order as the search.
 * A video node points at a source number, so a missing row still keeps its place.
 * Page text is left out so the card still fits.
 */
export function packHistorySources(
  results: readonly ({ title?: string; url?: string; snippet?: string; domain?: string; image?: string; date?: string } | null | undefined)[] | undefined,
): HistorySource[] {
  const out: HistorySource[] = [];
  for (const row of (results ?? []).slice(0, MAX_SOURCES)) {
    const url = row && typeof row.url === 'string' ? row.url.trim() : '';
    const title = row && typeof row.title === 'string' ? row.title.trim().slice(0, 180) : '';
    const source: HistorySource = {
      title,
      url,
      snippet: row && typeof row.snippet === 'string' ? row.snippet.slice(0, 220) : '',
      domain: row && typeof row.domain === 'string' ? row.domain.slice(0, 80) : '',
    };
    if (row && typeof row.image === 'string' && row.image.startsWith('https://')) source.image = row.image.slice(0, 300);
    if (row && typeof row.date === 'string' && row.date) source.date = row.date.slice(0, 40);
    out.push(source);
  }
  return out;
}

function asSources(value: unknown): HistorySource[] {
  if (!Array.isArray(value)) return [];
  return packHistorySources(value.map((row) => (row && typeof row === 'object' ? row as { title?: string; url?: string; snippet?: string; domain?: string; image?: string; date?: string } : {})));
}

/**
 * A stored history card is either an older bare card, or `{ v: 2, card, results }`.
 * `results` is what a video node points at.
 */
export function unpackHistoryPayload(raw: unknown): { card: AnswerCard | null; results: HistorySource[] } {
  if (!raw || typeof raw !== 'object') return { card: null, results: [] };
  const row = raw as { v?: unknown; card?: unknown; body?: unknown; title?: unknown; results?: unknown };
  if (row.v === 2 && row.card && typeof row.card === 'object') {
    const card = row.card as AnswerCard;
    if (!Array.isArray(card.body)) return { card: null, results: [] };
    return { card, results: asSources(row.results) };
  }
  if (typeof row.title === 'string' && Array.isArray(row.body)) return { card: raw as AnswerCard, results: [] };
  return { card: null, results: [] };
}

export function packHistoryPayload(card: AnswerCard, results: HistorySource[]): { v: 2; card: AnswerCard; results: HistorySource[] } {
  return { v: 2, card, results };
}
