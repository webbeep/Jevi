import type { CardNode } from '../shared/card';
import type { PageText } from './pages';
import type { SearchResult } from '../shared/types';

/**
 * Before a verdict tile is shown, keep it from saying more than the card and the
 * sources support. Checks are string matches on text already in hand: no extra
 * model call, and a consistent tile is emitted as-is.
 *
 * Official or guideline wording wins over a Yes/Mixed headline. "No evidence"
 * stays "No evidence" rather than No/False/never. A Yes/No tile that the rest
 * of the card contradicts is rewritten to the body's side, or dropped.
 */

const ABSENCE = /\b(no evidence|no proof|no firsthand|not been found|unsubstantiated|cannot be substantiated|can't be substantiated|no record|no documentation)\b/i;
const EXPLICIT = /\b(never said|never wrote|did not say|didn't say)\b/i;
const DISCOURAGE = /\b(discourage|discourages|do not recommend|does not recommend|don't recommend|not recommend|recommend against|advise against|should not start|no safe level|no safe amount|avoid alcohol)\b/i;
const ORG = /\b(AHA|American Heart Association|WHO|World Health Organization|CDC|Centers for Disease Control|NIH|National Institutes of Health|FDA|Food and Drug Administration|Dietary Guidelines)\b/i;
const OFFICIAL_HOST = /(^|\.)(who\.int|cdc\.gov|nih\.gov|fda\.gov|hhs\.gov|heart\.org|medlineplus\.gov|health\.gov|dietaryguidelines\.gov|usda\.gov)$/i;
const MUTUAL = /\b(both|each other|one another|each speeds|speeds the other|speed each)\b/i;
const HARD_NEG = /\b(don't|doesn't|do not|does not|never|didn't|did not)\b/i;

const STOP = new Set('a an the and or of to in for on with by is are was were be this that it as at from what when how does did do if they their would could about into over than then not but any has have had its'.split(' '));

const SYN: Record<string, string[]> = {
  heart: ['cardiovascular', 'cardiac'],
  cardiovascular: ['heart', 'cardiac'],
  cardiac: ['heart', 'cardiovascular'],
  wine: ['alcohol', 'drink'],
  alcohol: ['wine', 'drink'],
  drink: ['alcohol', 'wine'],
  drinking: ['alcohol', 'wine'],
};

function stem(w: string): string {
  let s = w.toLowerCase();
  if (s === 'said' || s === 'says' || s === 'saying') return 'say';
  if (s.endsWith('ies') && s.length > 4) s = `${s.slice(0, -3)}y`;
  else if (s.endsWith('ing') && s.length > 5) s = s.slice(0, -3);
  else if (s.endsWith('ed') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('es') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('s') && s.length > 4) s = s.slice(0, -1);
  return s;
}

function words(s: string): Set<string> {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (STOP.has(raw) || raw.length < 3) continue;
    const w = stem(raw);
    if (!w || STOP.has(w)) continue;
    out.add(w);
    if (Object.hasOwn(SYN, w)) for (const alt of SYN[w]) out.add(alt);
  }
  return out;
}

function shared(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

function sentences(s: string): string[] {
  return s
    .split(/\n+|(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 24);
}

type Pol = 'yes' | 'no' | 'mixed' | 'none';

function polarity(value: string | undefined): Pol {
  const v = (value ?? '').trim();
  if (!v || v.length > 24) return 'none';
  if (/^(mixed|unclear|depends|partly)\b/i.test(v)) return 'mixed';
  if (/^(yes|true)\b/i.test(v)) return 'yes';
  if (/^(no|false)\b/i.test(v)) return 'no';
  return 'none';
}

function yesLead(text: string): boolean {
  return /^(yes|true)\b/i.test(text.trim());
}

interface Flags {
  officialNeg: boolean;
  absence: boolean;
  explicitDenial: boolean;
  queryWords: Set<string>;
}

function scan(hits: { domain: string; text: string }[], query: string): Flags {
  const queryWords = words(query);
  let officialNeg = false;
  let absence = false;
  let explicitDenial = false;
  for (const hit of hits) {
    if (EXPLICIT.test(hit.text)) explicitDenial = true;
    const host = OFFICIAL_HOST.test(hit.domain);
    for (const s of sentences(hit.text)) {
      const overlap = shared(words(s), queryWords);
      if (!absence && ABSENCE.test(s) && overlap >= 2) absence = true;
      if (!officialNeg && DISCOURAGE.test(s) && overlap >= 2 && (host || ORG.test(s) || /\bguidelines?\b/i.test(s))) officialNeg = true;
    }
  }
  return { officialNeg, absence, explicitDenial, queryWords };
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s*\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  // Prefer a clause break (em/en dash, colon, semicolon) so the card never ends on ' —…'.
  const window = t.slice(0, max);
  const at = Math.max(window.lastIndexOf(' — '), window.lastIndexOf(' – '), window.lastIndexOf(': '), window.lastIndexOf('; '), window.lastIndexOf('. '), window.lastIndexOf(', '));
  if (at >= Math.floor(max * 0.4)) return `${window.slice(0, at).trim()}…`;
  return `${window.replace(/\s+\S*$/, '').trim()}…`;
}

/** ≤ ~4 words so the hero label is not truncated on the card (Lead: bananas label). */
function shortLabel(s: string, maxWords = 4): string {
  const parts = s.replace(/\s*\[\d+\]/g, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return parts.slice(0, maxWords).join(' ');
}

/** The short mutual claim inside a sentence, so the tile states the same thing the body does. */
function claimLabel(s: string): string {
  const clean = s.replace(/\s*\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
  const mutual = clean.match(/\b((?:each|both) (?:speeds?|ripens?)[^.]{0,32}|\b(?:speeds?|ripens?) (?:each other|the other)[^.]{0,24})/i);
  return shortLabel(mutual?.[0] ?? clean, 4);
}

function mutualSentence(body: string, label: string, side: 'yes' | 'no'): string | undefined {
  const labelWords = words(label);
  for (const s of sentences(body)) {
    if (!MUTUAL.test(s)) continue;
    if (shared(words(s), labelWords) < 2) continue;
    const negated = HARD_NEG.test(s);
    if (side === 'yes' && !negated) return s;
    if (side === 'no' && negated) return s;
  }
  return undefined;
}

type Face = Extract<CardNode, { type: 'hero' }> | Extract<CardNode, { type: 'tile' }>;

function paint(node: Face, value: string, tone: 'warning' | 'negative' | 'positive', label?: string): CardNode {
  if (node.type === 'hero') return label === undefined ? { ...node, value, tone } : { ...node, value, label, tone };
  return label === undefined ? { ...node, value } : { ...node, value, label };
}

function fixFace(node: Face, flags: Flags, body: string): CardNode {
  const pol = polarity(node.value);
  if (pol === 'none') return node;
  const own = `${node.type === 'hero' ? node.caption ?? '' : node.sub ?? ''}`;
  const absenceHere = flags.absence || (ABSENCE.test(own) && shared(words(own), flags.queryWords) >= 1);
  // Soften a hard No when sources only say "no proof", and always align the label with the
  // softened polarity (Lead live: value No proof / No evidence, label still "never said it").
  if (pol === 'no' && (absenceHere || flags.explicitDenial)) {
    if (flags.explicitDenial && !absenceHere) return paint(node, 'No', 'negative', 'No');
    return paint(node, 'No evidence', 'warning', 'No');
  }
  if ((pol === 'yes' || pol === 'mixed') && flags.officialNeg) return paint(node, 'No', 'negative');
  if (pol === 'no') {
    const s = mutualSentence(body, node.label ?? '', 'yes');
    if (s) return paint(node, 'Yes', 'positive', claimLabel(s));
  }
  if (pol === 'yes') {
    const s = mutualSentence(body, node.label ?? '', 'no');
    if (s) return paint(node, 'No', 'negative', claimLabel(s));
  }
  // Unchanged tiles can still carry a long designer label (live bananas when no rewrite fires). Cap at ~120 on a clause break so the FE 2-line wrap never shows a mid-word '…'.
  if (node.label && (node.label.length > 120 || /…$/.test(node.label))) return { ...node, label: clip(node.label, 120) };
  return node;
}

function mapNode(node: CardNode, flags: Flags, body: string): CardNode | undefined {
  if (node.type === 'stack' || node.type === 'grid' || node.type === 'section' || node.type === 'scroller') {
    const children = node.children.map((c) => mapNode(c, flags, body)).filter((c): c is CardNode => !!c);
    return children.length ? { ...node, children } : undefined;
  }
  if (node.type === 'tabs') {
    const tabs = node.tabs
      .map((t) => ({ ...t, children: t.children.map((c) => mapNode(c, flags, body)).filter((c): c is CardNode => !!c) }))
      .filter((t) => t.children.length);
    return tabs.length ? { ...node, tabs } : undefined;
  }
  if ((node.type === 'hero' || node.type === 'tile') && polarity(node.value) !== 'none') return fixFace(node, flags, body);
  if (node.type === 'text' && flags.officialNeg && yesLead(node.text)) return undefined;
  return node;
}

function pushProse(node: CardNode, out: string[]): void {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      node.children.forEach((c) => pushProse(c, out));
      return;
    case 'tabs':
      node.tabs.forEach((t) => t.children.forEach((c) => pushProse(c, out)));
      return;
    case 'hero':
      if (node.caption) out.push(node.caption);
      return;
    case 'tile':
      if (node.sub) out.push(node.sub);
      return;
    case 'text':
    case 'callout':
    case 'quote':
    case 'heading':
      out.push('text' in node ? node.text : '');
      return;
    case 'list':
      node.items.forEach((i) => out.push(i.text));
      return;
    case 'accordion':
      node.items.forEach((i) => out.push(`${i.title} ${i.text}`));
      return;
    default:
      return;
  }
}

export interface VerdictInput {
  query: string;
  results: SearchResult[];
  pages?: PageText[];
}

/** One card. `offer` is synchronous; call it again when a later region arrives and apply `revisions`. */
export class VerdictSession {
  private readonly flags: Flags;
  private readonly raw = new Map<number, CardNode>();
  private readonly sent = new Map<number, string>();

  constructor(input: VerdictInput) {
    const hits = [
      ...input.results.slice(0, 12).map((r) => ({ domain: r.domain, text: `${r.title} ${r.snippet} ${(r.content ?? '').slice(0, 2500)}` })),
      ...(input.pages ?? []).map((p) => ({ domain: '', text: p.text.slice(0, 2500) })),
    ];
    this.flags = scan(hits, input.query);
  }

  /** Aligns `node` with sources and with body text already offered. Earlier tiles come back in `revisions` when new body text conflicts. */
  offer(node: CardNode, index: number): { node: CardNode; revisions: { index: number; node: CardNode }[] } {
    this.raw.set(index, node);
    const body = this.bodyText();
    const revisions: { index: number; node: CardNode }[] = [];
    for (const [i, raw] of this.raw) {
      if (i === index) continue;
      const next = mapNode(raw, this.flags, body) ?? raw;
      const key = JSON.stringify(next);
      if (key !== this.sent.get(i)) {
        this.sent.set(i, key);
        revisions.push({ index: i, node: next });
      }
    }
    const current = mapNode(node, this.flags, body) ?? node;
    this.sent.set(index, JSON.stringify(current));
    return { node: current, revisions };
  }

  private bodyText(): string {
    const parts: string[] = [];
    for (const raw of this.raw.values()) pushProse(raw, parts);
    return parts.join('\n');
  }
}
