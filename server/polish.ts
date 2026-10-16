import type { CardNode } from '../shared/card';
import { joinSpacedDecimals } from '../shared/text';

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\[\d+\]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

/**
 * A decimal ("25.5") is one token. A dot ends a sentence only when it is not
 * between digits, so "25.5 ppg" is never split into "25." and "5 ppg".
 */
const SENTENCE_SRC = String.raw`(?:\d+\.\d+|[^.!?]|(?<!\d)[.!?](?=\d))+[.!?]+(?:\s*\[\d+\])*\s*`;

/** Complete sentences that form a prefix of `text`. A fragment after the last period is left out. */
function sentencePrefix(text: string): string[] {
  const joined = joinSpacedDecimals(text);
  const re = new RegExp(SENTENCE_SRC, 'y');
  const out: string[] = [];
  let at = 0;
  while (at < joined.length) {
    re.lastIndex = at;
    const m = re.exec(joined);
    if (!m || m.index !== at) break;
    out.push(m[0]);
    at = re.lastIndex;
  }
  return out;
}

/**
 * A year, count, or name must be a real token. A hole ("In he founded", "[year]", "founded in .")
 * drops the empty clause; the rest of the sentence stays when it still reads.
 */
export function withoutEmptySlots(text: string): string {
  const parts = joinSpacedDecimals(text).split(/(?<=[.!?])\s+(?!\d)/);
  const kept = parts.flatMap((sentence) => {
    const next = repairHole(sentence);
    return next ? [next] : [];
  });
  return kept.join(' ').replace(/\s+/g, ' ').trim();
}

/** A count or year written as Unknown, an em dash, or a [placeholder] is an empty slot. */
export function emptyFigure(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim();
  if (!v) return true;
  return /^(?:unknown|n\/?a|tbd|none|[—–\-?]|\[(?:year|name|count|date|number|amount)\])$/i.test(v);
}

function repairHole(sentence: string): string {
  let s = sentence.replace(/\[(?!\d+\])[^\]]+\]/g, '');
  s = s.replace(/\b(?:in|on|at|during|since|from|by)\s+[—–_]+(?:\s+|$)/gi, ' ');
  // "In he founded" — the year between the preposition and the pronoun never arrived.
  s = s.replace(/\b(?:in|on|at|during|since|from|by)\s+(?=(?:he|she|they|it|we)\b)/gi, '');
  // "EPs in and 2023" — the year between the preposition and "and" was removed.
  s = s.replace(/\b(?:in|on|at|during|since|from|by)\s+(?=and\b)/gi, '');
  s = s.replace(/\s+\b(?:in|on|at|during|since|from|by)\s*([.,;:])/gi, '$1');
  // A citation does not sit between "et al." and the year ("Ahmed et al. [1] 2024").
  s = s.replace(/\b(et al\.?)\s*\[(\d+)\]\s+((?:1[5-9]|20)\d{2})\b/gi, '$1 $3 [$2]');
  s = s.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[,;:\s]+/, '').trim();
  if (!s) return '';
  s = s.replace(/^[a-z]/, (ch) => ch.toUpperCase());
  const bare = s.replace(/\[\d+\]/g, '');
  if (/\[(?!\d+\])[^\]]+\]/.test(s)) return '';
  if (/\b(?:in|on|at|of|by|from|since|during)\s+(?:he|she|they|it|we)\b/i.test(bare)) return '';
  if (/\b(?:in|on|at|by|from)\s*[.,;:]/i.test(bare)) return '';
  if (/\s[—–_]\s/.test(bare)) return '';
  // A count that lost its number: "has about wolves" / "about  people".
  if (!/\d/.test(bare) && /\b(?:about|approximately|around|nearly)\s+[A-Za-z]/i.test(bare)) return '';
  return s;
}

/**
 * Drops a trailing ellipsis and the unfinished words in front of it
 * ("First player in Big 12 …"), keeping the last sentence that actually ended.
 * A short clause with no sentence at all is left out; a longer one is kept without the ellipsis.
 */
export function completeSentences(text: string): string {
  const trimmed = joinSpacedDecimals(text).replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  if (!/(?:\.{3}|…)\s*$/.test(trimmed)) return trimmed;
  const body = trimmed.replace(/(?:\.{3}|…)\s*$/, '').replace(/[\s,;:·•|–—-]+$/g, '').trim();
  const done = sentencePrefix(body).join('').trim();
  if (done) return done;
  return body.length >= 40 ? body : '';
}

const CUT_LABEL = /\b(?:chapter|section|page|step|item|figure|table|note|version|part|vol)\.?\s+\d+\.?\s*$/i;

/**
 * A quotation that stops on the whole part of a decimal keeps the decimal already stated beside it.
 * The same repair applies when the quote mark was already removed and the sentence is left ending at that integer.
 */
export function completeCutDecimal(text: string, hints: readonly (string | undefined)[]): string {
  const openAt = Math.max(text.lastIndexOf('"'), text.lastIndexOf('“'), text.lastIndexOf('«'));
  const opener = openAt >= 0 ? text[openAt]! : '';
  const closer = opener === '“' ? '”' : opener === '«' ? '»' : '"';
  const inside = openAt >= 0 ? text.slice(openAt + 1) : text;
  const closedAt = openAt >= 0 ? inside.lastIndexOf(closer) : -1;
  const body = closedAt >= 0 ? inside.slice(0, closedAt) : inside;
  const end = closedAt >= 0 ? inside.slice(closedAt) : '';
  if (body.length < 40) return text;
  if (CUT_LABEL.test(body)) return text;
  const cut = body.match(/(\d+)\.?\s*$/);
  if (!cut?.[1]) return text;
  if (new RegExp(`(?:^|\\D)${cut[1]}\\.\\d`).test(body)) return text;
  for (const hint of hints) {
    if (!hint || hint.length > 80) continue;
    const found = hint.match(new RegExp(`(${cut[1]}\\.\\d+)(\\s?°[CF]|\\s?%)?`));
    if (!found?.[1]) continue;
    const prefix = text.slice(0, (openAt >= 0 ? openAt + 1 : 0) + (body.length - cut[0].length));
    const quoteClose = openAt < 0 ? '' : end || closer;
    return `${prefix}${found[1]}${found[2] ?? ''}${quoteClose}`;
  }
  return text;
}

function hintedNumbers(node: CardNode | undefined, hints: string[]): void {
  if (!node) return;
  switch (node.type) {
    case 'hero':
      hints.push(node.value);
      if (node.label) hints.push(node.label);
      break;
    case 'stat':
      hints.push(node.value);
      break;
    case 'tile':
      if (node.value) hints.push(node.value);
      break;
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      node.children.forEach((child) => hintedNumbers(child, hints));
      break;
    case 'tabs':
      node.tabs.forEach((tab) => tab.children.forEach((child) => hintedNumbers(child, hints)));
      break;
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading':
    case 'keyvalue':
    case 'list':
    case 'chart':
    case 'progress':
    case 'rating':
    case 'table':
    case 'timeline':
    case 'steps':
    case 'diagram':
    case 'proscons':
    case 'badges':
    case 'actions':
    case 'choices':
    case 'slider':
    case 'scaler':
    case 'pricing':
    case 'accordion':
    case 'reveal':
    case 'image':
    case 'gallery':
    case 'video':
    case 'code':
    case 'divider':
    case 'citations':
    case 'links':
    case 'profile':
    case 'ticker':
    case 'slot':
      break;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

function withCutDecimals(node: CardNode, hints: readonly string[]): CardNode {
  const fix = (text: string) => completeCutDecimal(text, hints);
  switch (node.type) {
    case 'hero': {
      const caption = node.caption ? fix(node.caption) : node.caption;
      return caption === node.caption ? node : { ...node, caption };
    }
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading': {
      const text = fix(node.text);
      return text === node.text ? node : { ...node, text };
    }
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = node.children.map((child) => withCutDecimals(child, hints));
      return children.every((child, i) => child === node.children[i]) ? node : { ...node, children };
    }
    case 'tabs': {
      const tabs = node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => withCutDecimals(child, hints)) }));
      return tabs.every((tab, i) => tab.children.every((child, j) => child === node.tabs[i]?.children[j])) ? node : { ...node, tabs };
    }
    case 'stat':
    case 'tile':
    case 'keyvalue':
    case 'list':
    case 'chart':
    case 'progress':
    case 'rating':
    case 'table':
    case 'timeline':
    case 'steps':
    case 'diagram':
    case 'proscons':
    case 'badges':
    case 'actions':
    case 'choices':
    case 'slider':
    case 'scaler':
    case 'pricing':
    case 'accordion':
    case 'reveal':
    case 'image':
    case 'gallery':
    case 'video':
    case 'code':
    case 'divider':
    case 'citations':
    case 'links':
    case 'profile':
    case 'ticker':
    case 'slot':
      return node;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

/** A quotation on the card keeps a decimal some other part of the same card already states. */
export function restoreCutDecimals(nodes: readonly (CardNode | undefined)[]): (CardNode | undefined)[] {
  const hints: string[] = [];
  nodes.forEach((node) => hintedNumbers(node, hints));
  if (!hints.length) return [...nodes];
  return nodes.map((node) => (node ? withCutDecimals(node, hints) : node));
}

function trimToSentences(text: string, max: number): string {
  const clean = completeSentences(text);
  if (!clean || clean.length <= max) return clean;
  const parts = sentencePrefix(clean);
  if (!parts.length) return clean.length <= 600 ? clean : clean.slice(0, 600).replace(/\s+\S*$/, '').trim();
  let out = '';
  for (const s of parts) {
    const next = (out + s).trim();
    if (next.length > max && out) break;
    if (!out && next.length > 600) return next.slice(0, 600).replace(/\s+\S*$/, '').trim();
    out += s;
  }
  return out.trim();
}

/**
 * Card-wide output guardrails, applied to every node as it streams in:
 * drops sentences the card has already said, trims over-long text at a
 * sentence boundary, and removes nodes left empty.
 */
export class Polisher {
  private readonly seen = new Set<string>();
  private readonly usedImages = new Set<number>();

  /** Each picture appears at most once per card; a repeat is dropped rather than shown against the wrong item. */
  private image(ref: number | undefined): number | undefined {
    if (ref === undefined || this.usedImages.has(ref)) return undefined;
    this.usedImages.add(ref);
    return ref;
  }

  private readonly textCap: number;

  constructor(textCap: number) {
    this.textCap = textCap;
  }

  /** Keeps only sentences not seen before; returns '' when nothing new remains. */
  private fresh(text: string): string {
    const joined = joinSpacedDecimals(text);
    const parts = sentencePrefix(joined);
    const rest = joined.slice(parts.join('').length);
    const sentences = rest.trim() ? [...parts, rest] : parts.length ? parts : [joined];
    const kept = sentences.filter((s) => {
      const key = norm(s);
      if (key.length < 12) return true;
      if (this.seen.has(key)) return false;
      this.seen.add(key);
      return true;
    });
    return kept.join('').trim();
  }

  private short(text: string): boolean {
    const key = norm(text);
    if (key.length < 12) return true;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  apply(node: CardNode): CardNode | undefined {
    switch (node.type) {
      case 'stack':
      case 'grid':
      case 'section':
      case 'scroller': {
        const children = node.children.map((c) => this.apply(c)).filter((c): c is CardNode => !!c);
        return children.length ? { ...node, children } : undefined;
      }
      case 'tabs': {
        const tabs = node.tabs.map((t) => ({ ...t, children: t.children.map((c) => this.apply(c)).filter((c): c is CardNode => !!c) })).filter((t) => t.children.length);
        return tabs.length ? { ...node, tabs } : undefined;
      }
      case 'text': {
        const text = this.fresh(trimToSentences(withoutEmptySlots(node.text), this.textCap));
        return text ? { ...node, text } : undefined;
      }
      case 'callout': {
        const text = this.fresh(trimToSentences(withoutEmptySlots(node.text), Math.min(this.textCap, 280)));
        return text ? { ...node, text } : undefined;
      }
      case 'hero': {
        if (emptyFigure(node.value)) return undefined;
        const hints = [node.value, node.label];
        const started = node.caption ? completeCutDecimal(node.caption, hints) : node.caption;
        const trimmed = started ? this.fresh(trimToSentences(withoutEmptySlots(started), 160)) || undefined : started;
        const caption = trimmed ? completeCutDecimal(trimmed, hints) : trimmed;
        return { ...node, caption };
      }
      case 'stat':
        return emptyFigure(node.value) ? undefined : node;
      case 'tile': {
        if (emptyFigure(node.value) && emptyFigure(node.sub)) return undefined;
        return {
          ...node,
          imageRef: this.image(node.imageRef),
          value: emptyFigure(node.value) ? undefined : node.value,
          sub: emptyFigure(node.sub) ? undefined : node.sub,
        };
      }
      case 'list': {
        const items = node.items.flatMap((i) => {
          const text = withoutEmptySlots(i.text);
          if (!text || !this.short(text)) return [];
          return [{ ...i, text, imageRef: this.image(i.imageRef) }];
        });
        return items.length ? { ...node, items } : undefined;
      }
      case 'profile':
        return { ...node, imageRef: this.image(node.imageRef) };
      case 'image': {
        if (node.query) return node;
        const ref = this.image(node.ref);
        return ref === undefined ? undefined : node;
      }
      case 'gallery': {
        if (node.query) return node;
        const refs = node.refs.map((r) => this.image(r)).filter((r): r is number => r !== undefined);
        return refs.length ? { ...node, refs } : undefined;
      }
      case 'steps':
        return { ...node, items: node.items.map((s) => ({ ...s, detail: s.detail && (trimToSentences(s.detail, 220) || undefined) })) };
      case 'accordion': {
        const items = node.items.map((i) => ({ ...i, text: this.fresh(trimToSentences(i.text, this.textCap)) })).filter((i) => i.text);
        return items.length ? { ...node, items } : undefined;
      }
      case 'quote':
        return this.short(node.text) ? node : undefined;
      default:
        return node;
    }
  }
}

/** Every sentence on the node ends. A text node that was only an unfinished tail is dropped. */
export function withFinishedSentences(node: CardNode): CardNode | undefined {
  if (node.type === 'hero') {
    if (emptyFigure(node.value)) return undefined;
    if (!node.caption) return node;
    const caption = completeSentences(withoutEmptySlots(node.caption));
    return caption === node.caption ? node : { ...node, caption: caption || undefined };
  }
  if (node.type === 'stat' && emptyFigure(node.value)) return undefined;
  if (node.type === 'tile') {
    if (emptyFigure(node.value) && emptyFigure(node.sub)) return undefined;
    const value = emptyFigure(node.value) ? undefined : node.value;
    const sub = emptyFigure(node.sub) ? undefined : node.sub;
    return value === node.value && sub === node.sub ? node : { ...node, value, sub };
  }
  if (node.type === 'text' || node.type === 'callout' || node.type === 'quote') {
    const text = completeSentences(withoutEmptySlots(node.text));
    if (!text) return undefined;
    return text === node.text ? node : { ...node, text };
  }
  if (node.type === 'list') {
    const items = node.items.flatMap((item) => {
      const text = completeSentences(withoutEmptySlots(item.text));
      return text ? [{ ...item, text }] : [];
    });
    if (!items.length) return undefined;
    return items.length === node.items.length && items.every((item, i) => item.text === node.items[i]?.text) ? node : { ...node, items };
  }
  if (node.type === 'steps') {
    const items = node.items.map((step) => {
      const detail = step.detail ? completeSentences(step.detail) || undefined : undefined;
      return detail === step.detail ? step : { ...step, detail };
    });
    return items.every((step, i) => step === node.items[i]) ? node : { ...node, items };
  }
  if (node.type === 'accordion') {
    const items = node.items.flatMap((item) => {
      const text = completeSentences(item.text);
      return text ? [{ ...item, text }] : [];
    });
    if (!items.length) return undefined;
    return { ...node, items };
  }
  if (node.type === 'section' || node.type === 'stack' || node.type === 'grid' || node.type === 'scroller') {
    const children = node.children.flatMap((child) => {
      const next = withFinishedSentences(child);
      return next ? [next] : [];
    });
    if (!children.length) return undefined;
    return children.length === node.children.length && children.every((child, i) => child === node.children[i]) ? node : { ...node, children };
  }
  if (node.type === 'tabs') {
    const tabs = node.tabs
      .map((tab) => ({
        ...tab,
        children: tab.children.flatMap((child) => {
          const next = withFinishedSentences(child);
          return next ? [next] : [];
        }),
      }))
      .filter((tab) => tab.children.length);
    if (!tabs.length) return undefined;
    return { ...node, tabs };
  }
  if (node.type === 'table') {
    const rows = node.rows.map((row) => row.map((cell) => completeSentences(cell) || (/(?:\.{3}|…)\s*$/.test(cell) ? '' : cell)));
    return { ...node, rows };
  }
  return node;
}
