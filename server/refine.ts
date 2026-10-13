import type { CardNode } from '../shared/card';

const KEEP = /\b(?:keep|show|list)\s+only\b\s+([^?.!]{1,80})/i;
const GENERIC = new Set([
  'only', 'the', 'and', 'for', 'with', 'from', 'that', 'this', 'these', 'those', 'ones', 'one',
  'results', 'items', 'options', 'just', 'all', 'schools', 'school', 'colleges', 'college',
  'universities', 'university', 'jobs', 'job', 'employers', 'employer', 'companies', 'company',
  'roles', 'role', 'teams', 'team', 'clubs', 'club',
]);
const UNDER = /\b(undergrad(?:uate)?|bachelor(?:'s)?|college)\b/i;
const GRAD = /\b(graduate|grad school|master(?:'s)?|mba|ph\.?d|doctorate|doctoral)\b/i;

type Role = 'undergrad' | 'grad';

interface Kind {
  item: (label: string, value: string) => boolean;
}

/** The words a "keep only …" follow-up is filtering on. Undefined when it is not that kind of follow-up. */
export function keepTerms(question: string): string[] | undefined {
  const match = KEEP.exec(question);
  if (!match) return undefined;
  const terms = [...new Set(match[1]!.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !GENERIC.has(word)))];
  return terms.length ? terms : undefined;
}

export function isKeepOnly(question: string): boolean {
  return keepTerms(question) !== undefined;
}

function kindOf(question: string): Kind | undefined {
  if (/\b(schools?|colleges?|universit(?:y|ies))\b/i.test(question)) {
    return { item: (label, value) => roleOf(`${label} ${value}`) !== undefined || /\b(university|college|school|institute|academy)\b/i.test(`${label} ${value}`) };
  }
  if (/\b(jobs?|employers?|compan(?:y|ies)|roles?)\b/i.test(question)) {
    return { item: (label, value) => /\b(employer|company|role|job|worked|ceo|founder|director)\b/i.test(`${label} ${value}`) };
  }
  if (/\b(teams?|clubs?)\b/i.test(question)) {
    return { item: (label, value) => /\b(team|club|played|drafted)\b/i.test(`${label} ${value}`) };
  }
  return undefined;
}

function roleOf(label: string): Role | undefined {
  const grad = GRAD.test(label);
  const under = UNDER.test(label);
  if (grad && !under) return 'grad';
  if (under && !grad) return 'undergrad';
  return undefined;
}

function samePlace(a: string, b: string): boolean {
  const left = a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const right = b.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function matches(text: string, terms: readonly string[]): boolean {
  const low = text.toLowerCase();
  return terms.some((term) => low.includes(term));
}

/** The role word has to sit with this place, not with the next fact in the card JSON. */
function supported(corpus: string, value: string, role: Role): boolean {
  const needle = value.toLowerCase().trim();
  if (needle.length < 3) return false;
  const text = corpus.toLowerCase();
  const re = role === 'grad' ? GRAD : UNDER;
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(needle, from);
    if (at < 0) return false;
    const before = text.slice(Math.max(0, at - 80), at);
    const after = (text.slice(at + needle.length, at + needle.length + 48).split(/"},\{|"label"|<\/li>|•/)[0] ?? '');
    if (re.test(before) || re.test(after)) return true;
    from = at + needle.length;
  }
  return false;
}

function dropUnsupported<T extends { label: string; value: string }>(items: T[], corpus: string): T[] {
  const drop = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const role = roleOf(items[i]!.label);
    if (!role || drop.has(i)) continue;
    const twin = items.findIndex((item, index) => index !== i && !drop.has(index) && roleOf(item.label) && roleOf(item.label) !== role && samePlace(item.value, items[i]!.value));
    if (twin < 0) continue;
    const other = roleOf(items[twin]!.label)!;
    const mine = supported(corpus, items[i]!.value, role);
    const theirs = supported(corpus, items[twin]!.value, other);
    if (mine && !theirs) drop.add(twin);
    else if (!mine && theirs) drop.add(i);
    else if (!mine && !theirs) drop.add(Math.max(i, twin));
  }
  return items.filter((_, index) => !drop.has(index));
}

function keepItem(label: string, value: string, terms: readonly string[] | undefined, kind: Kind | undefined): boolean {
  if (!terms) return true;
  const school = kind?.item(label, value) ?? true;
  if (!school) return true;
  return matches(`${label} ${value}`, terms);
}

/**
 * A "keep only …" follow-up drops the alternatives that do not match, and does not
 * copy one place into a second role the sources never gave it.
 */
export function constrainNode(node: CardNode, question: string, corpus: string): CardNode | undefined {
  const terms = keepTerms(question);
  if (!terms) return node;
  return walk(node, terms, kindOf(question), corpus);
}

function walk(node: CardNode, terms: readonly string[], kind: Kind | undefined, corpus: string): CardNode | undefined {
  switch (node.type) {
    case 'profile': {
      const facts = dropUnsupported((node.facts ?? []).filter((fact) => keepItem(fact.label, fact.value, terms, kind)), corpus);
      return facts.length === (node.facts ?? []).length && facts.every((fact, index) => fact === node.facts![index]) ? node : { ...node, facts };
    }
    case 'keyvalue': {
      const items = dropUnsupported(node.items.filter((item) => keepItem(item.label, item.value, terms, kind)), corpus);
      if (!items.length) return undefined;
      return items.length === node.items.length && items.every((item, index) => item === node.items[index]) ? node : { ...node, items };
    }
    case 'tile':
      return keepItem(node.label, `${node.value ?? ''} ${node.sub ?? ''}`, terms, kind) ? node : undefined;
    case 'list': {
      const items = node.items.filter((item) => keepItem(item.text, item.meta ?? '', terms, kind));
      if (!items.length) return undefined;
      return items.length === node.items.length ? node : { ...node, items };
    }
    case 'table': {
      if (!kind) {
        const rows = node.rows.filter((row) => matches(row.join(' '), terms));
        if (!rows.length) return undefined;
        return rows.length === node.rows.length ? node : { ...node, rows };
      }
      const rows = node.rows.filter((row) => {
        const text = row.join(' ');
        return kind.item(text, text) ? matches(text, terms) : true;
      });
      if (!rows.length) return undefined;
      return rows.length === node.rows.length ? node : { ...node, rows };
    }
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = node.children.flatMap((child) => {
        const next = walk(child, terms, kind, corpus);
        return next ? [next] : [];
      });
      if (!children.length) return undefined;
      return children.length === node.children.length && children.every((child, index) => child === node.children[index]) ? node : { ...node, children };
    }
    case 'tabs': {
      const tabs = node.tabs
        .map((tab) => ({
          ...tab,
          children: tab.children.flatMap((child) => {
            const next = walk(child, terms, kind, corpus);
            return next ? [next] : [];
          }),
        }))
        .filter((tab) => tab.children.length);
      if (!tabs.length) return undefined;
      return { ...node, tabs };
    }
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading':
    case 'hero':
    case 'stat':
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
    case 'timeline':
      return node;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

function collectSources(node: CardNode, into: Set<number>): void {
  const walk = (value: unknown, key?: string): void => {
    if (key === 'source' && typeof value === 'number' && value >= 1) into.add(value);
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\[(\d+)\]/g)) into.add(Number(match[1]));
    } else if (Array.isArray(value)) value.forEach((item) => walk(item));
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (record.type === 'citations' && Array.isArray(record.refs)) {
        for (const ref of record.refs) if (typeof ref === 'number' && ref >= 1) into.add(ref);
      }
      for (const [childKey, child] of Object.entries(record)) walk(child, childKey);
    }
  };
  walk(node);
}

/**
 * A "keep only" follow-up is the previous card with the other rows removed.
 * The sources those rows already cited stay on the card.
 */
export function keptBody(body: readonly CardNode[], question: string, corpus: string): CardNode[] {
  const next = body.flatMap((node) => {
    if (node.type === 'citations') return [];
    const kept = constrainNode(node, question, corpus);
    return kept ? [kept] : [];
  });
  const refs = new Set<number>();
  for (const node of next) collectSources(node, refs);
  if (!refs.size) {
    for (const node of body) if (node.type === 'citations') node.refs.forEach((ref) => refs.add(ref));
  }
  if (!refs.size) return next;
  return [...next, { type: 'citations', refs: [...refs].sort((a, b) => a - b).slice(0, 8) }];
}
