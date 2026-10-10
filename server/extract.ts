import type { KeyPoint, SearchResponse, Stat, TimelineItem } from '../shared/types';
import { isBlockPage, tidyBibtex } from './blockPage';
import { clip } from './util';

export interface Candidate extends KeyPoint {
  id: string;
}

/** Splits snippets into standalone sentences that can be slotted into a card. */
export function candidates(search: SearchResponse, limit = 40): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const sources = [
    ...(search.knowledge ? [{ text: search.knowledge.extract, url: search.knowledge.url, domain: 'wikipedia' }] : []),
    ...search.results.slice(0, 14).map((r) => ({ text: r.snippet, url: r.url, domain: r.domain })),
    ...search.results.slice(0, 6).filter((r) => r.content).map((r) => ({ text: r.content!.slice(0, 900).replace(/\n/g, ' '), url: r.url, domain: r.domain })),
  ];
  for (const src of sources) {
    if (isBlockPage(src.text)) continue;
    for (const raw of tidyBibtex(src.text).split(/(?<=[.!?])\s+(?=[A-Z0-9"])/)) {
      const text = raw.replace(/^\W*(\w{3} \d{1,2}, \d{4}\s*[-—·]\s*)?/, '').trim();
      const key = text.toLowerCase().slice(0, 60);
      if (text.length < 35 || text.length > 260 || seen.has(key) || (/(\.\.\.|…)$/.test(text) && text.length < 60)) continue;
      seen.add(key);
      out.push({ id: `s${out.length}`, text, url: src.url, domain: src.domain });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

const STAT_RE =
  /(?:[$€£¥]\s?\d[\d,.]*\s?(?:k|m|bn|million|billion|trillion)?|\d[\d,.]*\s?(?:%|percent|million|billion|trillion|thousand|km²?|kg|miles|mph|km\/h|meters|metres|feet|ft|people|users|years old|°[CF]?|GB|TB|hours|minutes))/i;

export function extractStats(cands: Candidate[], limit = 6): Stat[] {
  const stats: Stat[] = [];
  const seenValues = new Set<string>();
  for (const c of cands) {
    const m = c.text.match(STAT_RE);
    if (!m) continue;
    const value = m[0].trim();
    if (seenValues.has(value)) continue;
    seenValues.add(value);
    stats.push({ value, label: clip(c.text, 110), url: c.url });
    if (stats.length >= limit) break;
  }
  return stats;
}

const YEAR_RE = /\b(?:in |since |by |from )?((?:1[0-9]|20)\d{2})\b/;

export function extractTimeline(cands: Candidate[]): TimelineItem[] {
  const byYear = new Map<string, TimelineItem>();
  for (const c of cands) {
    const year = c.text.match(YEAR_RE)?.[1];
    if (!year || Number(year) > new Date().getFullYear() + 1 || byYear.has(year)) continue;
    byYear.set(year, { when: year, text: clip(c.text, 160), url: c.url });
  }
  return [...byYear.values()].sort((a, b) => Number(a.when) - Number(b.when)).slice(0, 8);
}
