import type { CardNode } from '../shared/card';

const LIST_SHAPE = /\b(?:standouts?|sleepers?|breakouts?|rookies|nominees|candidates)\b|\bwho(?:'re| are| were| should)\b|\bwhich\b[^?.!]{0,80}\b(?:players?|people|persons?|athletes?|products?|models?|teams?|companies|artists?|albums?|movies?|books?|shows?|songs?)\b/i;
const WHO_IS = /\bwho is\b/i;
const VERSUS = /\b(?:vs\.?|versus)\b/i;
const TIP_SEARCH = /\b(?:what to look for|how to (?:find|spot|pick)|tips|checklist|criteria)\b/i;
const SMALL = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'with', 'in', 'on', 'at', 'to', 'from', 'by', 'vs', 'versus', 'de', 'van', 'da']);
const GENERIC = new Set([
  'standout', 'standouts', 'sleeper', 'sleepers', 'breakout', 'breakouts', 'rookie', 'rookies',
  'nominee', 'nominees', 'candidate', 'candidates', 'preseason', 'season', 'fantasy', 'score',
  'upside', 'usage', 'volume', 'high', 'low', 'flagged', 'before', 'picks', 'pick', 'list', 'names',
  'player', 'players', 'people', 'team', 'teams',
]);

/** The question wants a list of people, products, or other named things it does not already name. */
export function wantsNamedList(query: string): boolean {
  const text = query.trim();
  if (!text || VERSUS.test(text) || WHO_IS.test(text)) return false;
  return LIST_SHAPE.test(text);
}

function queryWords(query: string): Set<string> {
  return new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 2));
}

function titleWord(word: string): boolean {
  return /^[A-Z][a-z]/.test(word) || /^[A-Z][a-z]+(?:-[A-Z][a-z]+)+$/.test(word);
}

/** Title-case names in the text that are not just the question's own words. */
export function citedNames(query: string, texts: readonly string[]): string[] {
  const known = queryWords(query);
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    const words = key.split(/[^a-z0-9]+/).filter((word) => word.length >= 2 && !SMALL.has(word));
    if (words.length < 2) return;
    if (words.every((word) => known.has(word) || GENERIC.has(word))) return;
    seen.add(key);
    found.push(name);
  };
  for (const text of texts) {
    const tokens = text.split(/\s+/);
    let run: string[] = [];
    const flush = () => {
      const kept = run.map((word) => word.replace(/^[^A-Za-z]+|[^A-Za-z.'’-]+$/g, '')).filter(Boolean);
      const body = kept.filter((word) => !SMALL.has(word.toLowerCase()));
      if (body.length >= 2 && body.some((word) => word.length >= 3)) add(body.join(' '));
      run = [];
    };
    for (const token of tokens) {
      const word = token.replace(/^[^A-Za-z]+|[^A-Za-z'’-]+$/g, '');
      if (!word) {
        flush();
        continue;
      }
      if (titleWord(word) || (run.length && SMALL.has(word.toLowerCase()))) run.push(word);
      else flush();
    }
    flush();
  }
  return found;
}

/** One search for the names. A paraphrase of what to look for is not that search. */
export function nameSeekingQuery(question: string, suggested?: string): string {
  const tip = suggested?.trim() ?? '';
  if (tip.length > 2 && !TIP_SEARCH.test(tip) && tip.toLowerCase() !== question.trim().toLowerCase()) return tip.replace(/\s+/g, ' ').trim();
  const base = question.replace(TIP_SEARCH, ' ').replace(/\s+/g, ' ').trim();
  return `${base} names`.replace(/\s+/g, ' ').trim();
}

function plainCard(nodes: readonly CardNode[]): string {
  const parts: string[] = [];
  const walk = (node: CardNode) => {
    if (node.type === 'tile') parts.push(node.label, node.value ?? '', node.sub ?? '');
    if (node.type === 'list') for (const item of node.items) parts.push(item.text, item.meta ?? '');
    if (node.type === 'table') for (const row of node.rows) parts.push(...row);
    if (node.type === 'heading' || node.type === 'text' || node.type === 'callout') parts.push(node.text);
    if (node.type === 'profile') parts.push(node.name);
    if ('children' in node && Array.isArray(node.children)) node.children.forEach(walk);
    if (node.type === 'tabs') for (const tab of node.tabs) tab.children.forEach(walk);
  };
  nodes.forEach(walk);
  return parts.filter(Boolean).join('. ');
}

function sourceTexts(results: readonly { title?: string; snippet?: string }[]): string[] {
  return results.map((row) => `${row.title ?? ''}. ${row.snippet ?? ''}`);
}

/** A name on the card that a source also states. The question's own words do not count. */
export function cardCitesName(query: string, nodes: readonly CardNode[], results: readonly { title?: string; snippet?: string }[]): boolean {
  const onCard = citedNames(query, [plainCard(nodes)]);
  if (!onCard.length) return false;
  const hay = sourceTexts(results).join('\n').toLowerCase();
  return onCard.some((name) => hay.includes(name.toLowerCase()));
}

export interface NamedPick {
  name: string;
  reason: string;
  source: number;
}

function reasonFor(name: string, text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const hit = sentences.find((sentence) => sentence.toLowerCase().includes(name.toLowerCase())) ?? text;
  const reason = hit.replace(/\s+/g, ' ').trim();
  return reason.length > 180 ? `${reason.slice(0, 177).trim()}…` : reason;
}

/** Names the sources state, each with the sentence that names it. */
export function namedPicks(query: string, results: readonly { title?: string; snippet?: string }[]): NamedPick[] {
  const picks: NamedPick[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < results.length && picks.length < 6; index++) {
    const row = results[index]!;
    const text = `${row.title ?? ''}. ${row.snippet ?? ''}`;
    for (const name of citedNames(query, [text])) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push({ name, reason: reasonFor(name, text), source: index + 1 });
      if (picks.length === 6) break;
    }
  }
  return picks;
}

/** The list the card should show when it never cited a name. */
export function namedListNode(query: string, results: readonly { title?: string; snippet?: string }[]): CardNode {
  const picks = namedPicks(query, results);
  if (!picks.length) return { type: 'callout', tone: 'muted', text: 'The sources named none.' };
  return {
    type: 'list',
    style: 'number',
    items: picks.map((pick) => ({ text: pick.name, meta: pick.reason, source: pick.source })),
  };
}
