import type { CardNode } from '../shared/card';
import { hostTier } from './sourceQuality';

/**
 * A precise bio fact is a birthplace, an ownership share, or an award.
 * It is shown only when a source about that person states it.
 * It is dropped when those sources disagree, or when a fetched page
 * contradicts the snippet that suggested it. The other value is not filled in.
 * A follow-up does not repeat the fact unless the new question asks for it.
 */

export interface BioSource {
  text: string;
  /** The snippet, when `text` is the fetched page. */
  stated?: string;
  domain?: string;
  url?: string;
  title?: string;
}

type Kind = 'birthplace' | 'ownership' | 'award';

const PLACE = String.raw`[A-Z][A-Za-z.'’-]{2,24}(?:\s+[A-Z][A-Za-z.'’-]{2,24}){0,3}`;
const BORN_IN = new RegExp(String.raw`\b(?:born|birthplace|native)\b[^.\n]{0,60}?\bin\s+(${PLACE})\b`, 'g');
const SHARE = /(?:~|approximately\s+|about\s+|around\s+)?(\d{1,2}(?:\.\d+)?)\s*%/gi;
const AWARD = /\b((?:[A-Z][\w.&'-]*\s+){0,5}(?:Medal|Award|Prize|Honor|Honour)(?:\s+of\s+[A-Z][\w&'-]+){0,4})\b/g;
const BIRTH_LABEL = /^(?:born|birthplace|birth place|place of birth|hometown|native of)$/i;
const OWN_LABEL = /^(?:owns|owned|ownership|stake|holding|share)$/i;
const AWARD_LABEL = /^(?:award|awards|honor|honour|honou?rs|latest honor|latest honour|medal|prize|recognition)$/i;
const PLACE_STOP = new Set(['the', 'age', 'his', 'her', 'their', 'who', 'was', 'near']);
const MONTH = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

export interface BioOpts {
  person?: string;
  question: string;
  followup?: boolean;
}

function kindOfLabel(label: string): Kind | undefined {
  const text = label.trim();
  if (BIRTH_LABEL.test(text)) return 'birthplace';
  if (OWN_LABEL.test(text)) return 'ownership';
  if (AWARD_LABEL.test(text)) return 'award';
  return undefined;
}

function asks(question: string, kind: Kind): boolean {
  switch (kind) {
    case 'birthplace':
      return /\b(?:born|birthplace|birth place|hometown|native|where\b[^?]{0,24}\bfrom)\b/i.test(question);
    case 'ownership':
      return /\b(?:owns?|owned|ownership|stake|shares? of|percent of)\b/i.test(question);
    case 'award':
      return /\b(?:awards?|medals?|honou?rs?|prizes?)\b/i.test(question);
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function cue(kind: Kind): RegExp {
  switch (kind) {
    case 'birthplace':
      return /\b(?:born|birthplace|native)\b/i;
    case 'ownership':
      return /\b(?:owns?|owned|ownership|stake|holds|holding)\b/i;
    case 'award':
      return /\b(?:award|medal|honou?r|prize)\b/i;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function placeKey(place: string): string {
  const cleaned = place.replace(MONTH, ' ');
  const first = cleaned.split(/[,/]/)[0]?.replace(/[^A-Za-z\s]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase() ?? '';
  if (first.length < 3 || PLACE_STOP.has(first)) return '';
  return first;
}

function placesIn(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(BORN_IN)) {
    const key = placeKey(match[1] ?? '');
    if (key) out.push(key);
  }
  return [...new Set(out)];
}

function placesInValue(value: string): string[] {
  const parts = value.split(',').map((part) => placeKey(part)).filter((key) => key.length >= 3);
  if (parts.length) return [...new Set(parts)];
  return placesIn(value);
}

function sharesIn(text: string): string[] {
  if (!cue('ownership').test(text)) return [];
  const out: string[] = [];
  for (const match of text.matchAll(SHARE)) {
    const n = Number(match[1]);
    if (n > 0 && n < 100) out.push(String(n));
  }
  return [...new Set(out)];
}

function awardKey(name: string): string {
  return name.toLowerCase().replace(/\b(?:19|20)\d{2}\b/g, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function awardsIn(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(AWARD)) {
    const key = awardKey(match[1] ?? '');
    if (key.length >= 6) out.push(key);
  }
  return [...new Set(out)];
}

function valuesIn(text: string, kind: Kind): string[] {
  switch (kind) {
    case 'birthplace':
      return placesIn(text);
    case 'ownership':
      return sharesIn(text);
    case 'award':
      return awardsIn(text);
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function claimValues(label: string, value: string): { kind: Kind; key: string }[] {
  const kind = kindOfLabel(label);
  if (!kind) return [];
  switch (kind) {
    case 'birthplace':
      return placesInValue(value).map((key) => ({ kind, key }));
    case 'ownership':
      return sharesIn(`${label} ${value}`).map((key) => ({ kind, key }));
    case 'award':
      return (awardsIn(value).length ? awardsIn(value) : [awardKey(value)].filter((key) => key.length >= 6)).map((key) => ({ kind, key }));
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function personIn(nodes: readonly (CardNode | undefined)[], given?: string): string {
  const named = given?.trim();
  if (named && named.split(/\s+/).length >= 2) return named;
  let found = '';
  const walk = (node: CardNode) => {
    if (found) return;
    switch (node.type) {
      case 'profile':
        if (node.name.split(/\s+/).length >= 2) found = node.name;
        return;
      case 'stack':
      case 'grid':
      case 'section':
      case 'scroller':
        node.children.forEach(walk);
        return;
      case 'tabs':
        node.tabs.forEach((tab) => tab.children.forEach(walk));
        return;
      default:
        return;
    }
  };
  for (const node of nodes) if (node) walk(node);
  return found;
}

function aboutPerson(source: BioSource, person: string): boolean {
  const words = person.toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 3);
  const first = words[0];
  const last = words[words.length - 1];
  if (!first || !last) return false;
  const blob = `${source.title ?? ''} ${source.url ?? ''} ${source.text} ${source.stated ?? ''}`.toLowerCase();
  return blob.includes(first) && blob.includes(last);
}

function usable(source: BioSource): boolean {
  return hostTier(source.domain ?? '') <= 2;
}

interface Heard {
  /** Values the fetched page states. Empty when the source is only a snippet. */
  page: string[];
  /** Values the snippet states. */
  snippet: string[];
}

function heard(source: BioSource, kind: Kind): Heard {
  if (!source.stated) return { page: [], snippet: valuesIn(source.text, kind) };
  return { page: valuesIn(source.text, kind), snippet: valuesIn(source.stated, kind) };
}

/**
 * Keys of this kind that must not be shown.
 * A page that states a different value than its snippet, or than another
 * source about the person, disputes the fact. Nothing is substituted.
 */
function droppedKeys(sources: readonly BioSource[], person: string, kind: Kind, claimed: readonly string[], followup: boolean, question: string): Set<string> {
  const drop = new Set<string>();
  if (followup && !asks(question, kind)) {
    claimed.forEach((key) => drop.add(key));
    return drop;
  }
  const stated = new Set<string>();
  let conflict = false;
  for (const source of sources) {
    if (!usable(source) || !aboutPerson(source, person)) continue;
    const found = heard(source, kind);
    const page = new Set(found.page);
    const snippet = new Set(found.snippet);
    for (const key of snippet) {
      if (page.size && !page.has(key)) conflict = true;
    }
    const keys = page.size ? page : snippet;
    for (const key of keys) {
      if (stated.size && !stated.has(key)) conflict = true;
      stated.add(key);
    }
    if (stated.size > 1) conflict = true;
  }
  for (const key of claimed) {
    if (conflict || !stated.has(key)) drop.add(key);
  }
  return drop;
}

function claimsIn(nodes: readonly (CardNode | undefined)[]): { kind: Kind; key: string }[] {
  const out: { kind: Kind; key: string }[] = [];
  const take = (label: string, value: string) => { out.push(...claimValues(label, value)); };
  const walk = (node: CardNode) => {
    switch (node.type) {
      case 'profile':
        node.facts?.forEach((fact) => take(fact.label, fact.value));
        return;
      case 'keyvalue':
        node.items.forEach((item) => take(item.label, item.value));
        return;
      case 'tile':
      case 'stat':
        take(node.label, `${node.value ?? ''} ${node.type === 'tile' ? node.sub ?? '' : ''}`);
        return;
      case 'hero':
        if (node.label) take(node.label, `${node.value} ${node.caption ?? ''}`);
        out.push(...proseClaims(`${node.value} ${node.caption ?? ''}`));
        return;
      case 'text':
      case 'heading':
      case 'callout':
      case 'quote':
      case 'draft':
        out.push(...proseClaims(node.text));
        return;
      case 'list':
        node.items.forEach((item) => out.push(...proseClaims(`${item.text} ${item.meta ?? ''}`)));
        return;
      case 'timeline':
        node.items.forEach((item) => out.push(...proseClaims(`${item.title} ${item.text ?? ''}`)));
        return;
      case 'stack':
      case 'grid':
      case 'section':
      case 'scroller':
        node.children.forEach(walk);
        return;
      case 'tabs':
        node.tabs.forEach((tab) => tab.children.forEach(walk));
        return;
      case 'table':
      case 'steps':
      case 'accordion':
      case 'proscons':
      case 'badges':
      case 'actions':
      case 'choices':
      case 'links':
      case 'citations':
      case 'chart':
      case 'pricing':
      case 'scaler':
      case 'slider':
      case 'reveal':
      case 'image':
      case 'gallery':
      case 'video':
      case 'code':
      case 'divider':
      case 'progress':
      case 'rating':
      case 'diagram':
      case 'ticker':
      case 'slot':
        return;
      default: {
        const unreachable: never = node;
        return unreachable;
      }
    }
  };
  for (const node of nodes) if (node) walk(node);
  return out;
}

function proseClaims(text: string): { kind: Kind; key: string }[] {
  return [
    ...placesIn(text).map((key) => ({ kind: 'birthplace' as const, key })),
    ...sharesIn(text).map((key) => ({ kind: 'ownership' as const, key })),
    ...awardsIn(text).map((key) => ({ kind: 'award' as const, key })),
  ];
}

function mentions(text: string, kind: Kind, key: string): boolean {
  switch (kind) {
    case 'birthplace':
      return placesInValue(text).includes(key) || placesIn(text).includes(key);
    case 'ownership':
      return sharesIn(text).includes(key) || sharesIn(`owns ${text}`).includes(key);
    case 'award':
      return awardsIn(text).includes(key) || awardKey(text) === key;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function withoutKey(value: string, kind: Kind, key: string): string {
  if (kind === 'birthplace') {
    const parts = value.split(',').map((part) => part.trim()).filter((part) => placeKey(part) !== key && part !== key);
    return parts.join(', ').replace(/\s+,/g, ',').trim();
  }
  if (!mentions(value, kind, key)) return value;
  return '';
}

function scrubText(text: string, drop: Map<Kind, Set<string>>): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence) => {
    for (const [kind, keys] of drop) {
      if (!cue(kind).test(sentence) && kind !== 'award') continue;
      for (const key of keys) if (mentions(sentence, kind, key)) return false;
    }
    return true;
  });
  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

function keepLabeled(label: string, value: string, drop: Map<Kind, Set<string>>): string | undefined {
  const kind = kindOfLabel(label);
  if (!kind) return value;
  const keys = drop.get(kind);
  if (!keys?.size) return value;
  let next = value;
  for (const key of keys) next = withoutKey(next, kind, key);
  if (!next || !/[A-Za-z0-9]/.test(next)) return undefined;
  if (kind !== 'birthplace') return next === value ? value : undefined;
  return next;
}

function scrubNode(node: CardNode, drop: Map<Kind, Set<string>>): CardNode | undefined {
  switch (node.type) {
    case 'profile': {
      const facts = (node.facts ?? []).flatMap((fact) => {
        const value = keepLabeled(fact.label, fact.value, drop);
        return value ? [{ ...fact, value }] : [];
      });
      return facts.length === (node.facts ?? []).length && facts.every((fact, index) => fact.value === node.facts![index]?.value) ? node : { ...node, facts };
    }
    case 'keyvalue': {
      const items = node.items.flatMap((item) => {
        const value = keepLabeled(item.label, item.value, drop);
        return value ? [{ ...item, value }] : [];
      });
      if (!items.length) return undefined;
      return items.length === node.items.length && items.every((item, index) => item.value === node.items[index]?.value) ? node : { ...node, items };
    }
    case 'tile':
    case 'stat': {
      const value = keepLabeled(node.label, `${node.value ?? ''}`, drop);
      if (value === undefined) return undefined;
      return value === (node.value ?? '') ? node : { ...node, value };
    }
    case 'hero': {
      const value = node.label ? keepLabeled(node.label, node.value, drop) : node.value;
      if (value === undefined) return undefined;
      const caption = node.caption ? scrubText(node.caption, drop) : node.caption;
      const prose = scrubText(value, drop);
      return prose === node.value && caption === node.caption ? node : { ...node, value: prose || value, caption };
    }
    case 'text':
    case 'heading':
    case 'callout':
    case 'quote':
    case 'draft': {
      const text = scrubText(node.text, drop);
      if (!text) return undefined;
      return text === node.text ? node : { ...node, text };
    }
    case 'list': {
      const items = node.items.flatMap((item) => {
        const text = scrubText(`${item.text} ${item.meta ?? ''}`, drop);
        if (!text) return [];
        return text === `${item.text} ${item.meta ?? ''}`.trim() ? [item] : [{ ...item, text }];
      });
      if (!items.length) return undefined;
      return items.length === node.items.length ? node : { ...node, items };
    }
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = node.children.flatMap((child) => {
        const next = scrubNode(child, drop);
        return next ? [next] : [];
      });
      if (!children.length) return undefined;
      return children.length === node.children.length && children.every((child, index) => child === node.children[index]) ? node : { ...node, children };
    }
    case 'tabs': {
      const tabs = node.tabs.map((tab) => ({ ...tab, children: tab.children.flatMap((child) => {
        const next = scrubNode(child, drop);
        return next ? [next] : [];
      }) })).filter((tab) => tab.children.length);
      if (!tabs.length) return undefined;
      return { ...node, tabs };
    }
    case 'timeline':
    case 'table':
    case 'steps':
    case 'accordion':
    case 'proscons':
    case 'badges':
    case 'actions':
    case 'choices':
    case 'links':
    case 'citations':
    case 'chart':
    case 'pricing':
    case 'scaler':
    case 'slider':
    case 'reveal':
    case 'image':
    case 'gallery':
    case 'video':
    case 'code':
    case 'divider':
    case 'progress':
    case 'rating':
    case 'diagram':
    case 'ticker':
    case 'slot':
      return node;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

/** Drops a precise bio fact the sources do not agree on. A follow-up does not repeat one the new question did not ask for. */
export function dropDisputedBio(nodes: readonly (CardNode | undefined)[], sources: readonly BioSource[], opts: BioOpts): (CardNode | undefined)[] {
  const person = personIn(nodes, opts.person);
  if (!person) return [...nodes];
  const claims = claimsIn(nodes);
  if (!claims.length) return [...nodes];
  const drop = new Map<Kind, Set<string>>();
  for (const kind of ['birthplace', 'ownership', 'award'] as const) {
    const claimed = [...new Set(claims.filter((claim) => claim.kind === kind).map((claim) => claim.key))];
    if (!claimed.length) continue;
    const keys = droppedKeys(sources, person, kind, claimed, !!opts.followup, opts.question);
    if (keys.size) drop.set(kind, keys);
  }
  if (!drop.size) return [...nodes];
  return nodes.map((node) => (node ? scrubNode(node, drop) : node));
}
