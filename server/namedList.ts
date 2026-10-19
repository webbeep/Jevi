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

/** Small words inside one name ("Bank of America", "Sergio de Larrea"). "and" and "with" join two names. */
const NAME_PARTICLE = new Set(['of', 'the', 'de', 'van', 'von', 'da', 'del', 'la', 'le', 'di', 'du', 'bin', 'al']);

/** "A.J.", "C.J." and "Jr." belong to a name ("A.J. Dybantsa", "Jabari Smith Jr."). */
const INITIALS = /^(?:[A-Z]\.){1,3}$|^[A-Z]\.?[A-Z]\.?$|^(?:Jr|Sr|II|III|IV)\.?$/;

/**
 * Words a source title or a page's navigation puts in capitals that are never part of a person's or product's name:
 * "Teams Preseason Results", "Related Content How", "Rookies Make Their Preseason Debuts".
 */
const NOT_A_NAME = new Set([
  'top', 'best', 'new', 'how', 'what', 'why', 'who', 'when', 'where', 'related', 'content', 'more', 'video', 'videos', 'watch',
  'highlights', 'plays', 'play', 'scores', 'stats', 'results', 'rankings', 'ranking', 'power', 'teams', 'news', 'latest', 'live',
  'official', 'site', 'action', 'trends', 'tracking', 'ahead', 'make', 'makes', 'their', 'debuts', 'debut', 'moments', 'full',
  'craziest', 'golden', 'hoops', 'recap', 'recaps', 'preview', 'previews', 'schedule', 'standings', 'report', 'reports', 'guide',
  'review', 'reviews', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'tonight',
  'week', 'weekly', 'daily', 'nba', 'nfl', 'mlb', 'nhl', 'wnba', 'league', 'class', 'draft', 'season', 'game', 'games',
]);

/** A name a list can show: two to four words, none of them a heading or navigation word. */
function personLike(name: string): boolean {
  const words = name.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return !words.some((word) => NOT_A_NAME.has(word.toLowerCase().replace(/[^a-z]/g, '')) || /['’]s$/.test(word));
}

/** Title-case names in the text that are not just the question's own words. */
export function citedNames(query: string, texts: readonly string[]): string[] {
  const known = queryWords(query);
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    // "A.J. Dybantsa" is two words: an initial counts as one.
    const words = key.split(/\s+/).map((word) => word.replace(/[^a-z0-9]/g, '')).filter((word) => word && !SMALL.has(word));
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
      if (body.length >= 2 && body.length <= 5 && body.some((word) => word.length >= 3)) add(body.join(' '));
      run = [];
    };
    for (const token of tokens) {
      const bare = token.replace(/^[^A-Za-z]+/, '');
      const initial = INITIALS.test(bare.replace(/[,;:!?)"\]]+$/, ''));
      const word = initial ? bare.replace(/[,;:!?)"\]]+$/, '').replace(/\.$/, '') : token.replace(/^[^A-Za-z]+|[^A-Za-z'’-]+$/g, '');
      if (!word) {
        flush();
        continue;
      }
      if (initial || titleWord(word) || (run.length && NAME_PARTICLE.has(word.toLowerCase()))) run.push(word);
      else {
        flush();
        continue;
      }
      // "Peterson. Top 3 pick" and "Duren, Detroit": a sentence or list break ends the name.
      if (!initial && /[.,;:!?)"]$/.test(token)) flush();
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

/** Every piece of text on the card, one field per entry, so a name never runs into the next field. */
function plainCard(nodes: readonly CardNode[]): string[] {
  const parts: string[] = [];
  const skip = new Set(['type', 'icon', 'tone', 'accent', 'imageSrc', 'imageQuery', 'style', 'kind', 'gap', 'shape', 'url', 'href']);
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      if (value.trim() && !/^https?:/.test(value)) parts.push(value);
      return;
    }
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === 'object') for (const [key, inner] of Object.entries(value)) if (!skip.has(key)) walk(inner);
  };
  nodes.forEach(walk);
  return parts;
}

function sourceTexts(results: readonly { title?: string; snippet?: string; content?: string }[]): string[] {
  return results.map((row) => `${row.title ?? ''}. ${row.snippet ?? ''} ${row.content ?? ''}`);
}

/** A name on the card that a source also states. The question's own words do not count. */
export function cardCitesName(query: string, nodes: readonly CardNode[], results: readonly { title?: string; snippet?: string; content?: string }[]): boolean {
  const onCard = citedNames(query, plainCard(nodes));
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
      if (!personLike(name)) continue;
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
