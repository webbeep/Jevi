import type { CardNode } from '../shared/card';

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
  const re = new RegExp(SENTENCE_SRC, 'y');
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    re.lastIndex = at;
    const m = re.exec(text);
    if (!m || m.index !== at) break;
    out.push(m[0]);
    at = re.lastIndex;
  }
  return out;
}

/**
 * Drops a trailing ellipsis and the unfinished words in front of it
 * ("First player in Big 12 …"), keeping the last sentence that actually ended.
 * A short clause with no sentence at all is left out; a longer one is kept without the ellipsis.
 */
export function completeSentences(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  if (!/(?:\.{3}|…)\s*$/.test(trimmed)) return trimmed;
  const body = trimmed.replace(/(?:\.{3}|…)\s*$/, '').replace(/[\s,;:·•|–—-]+$/g, '').trim();
  const done = sentencePrefix(body).join('').trim();
  if (done) return done;
  return body.length >= 40 ? body : '';
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
    const parts = sentencePrefix(text);
    const rest = text.slice(parts.join('').length);
    const sentences = rest.trim() ? [...parts, rest] : parts.length ? parts : [text];
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
        const text = this.fresh(trimToSentences(node.text, this.textCap));
        return text ? { ...node, text } : undefined;
      }
      case 'callout': {
        const text = this.fresh(trimToSentences(node.text, Math.min(this.textCap, 280)));
        return text ? { ...node, text } : undefined;
      }
      case 'hero':
        return { ...node, caption: node.caption && (this.fresh(trimToSentences(node.caption, 160)) || undefined) };
      case 'list': {
        const items = node.items.filter((i) => this.short(i.text)).map((i) => ({ ...i, imageRef: this.image(i.imageRef) }));
        return items.length ? { ...node, items } : undefined;
      }
      case 'tile':
        return { ...node, imageRef: this.image(node.imageRef) };
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
  if (node.type === 'text' || node.type === 'callout' || node.type === 'quote') {
    const text = completeSentences(node.text);
    if (!text) return undefined;
    return text === node.text ? node : { ...node, text };
  }
  if (node.type === 'hero') {
    if (!node.caption) return node;
    const caption = completeSentences(node.caption);
    return caption === node.caption ? node : { ...node, caption: caption || undefined };
  }
  if (node.type === 'list') {
    const items = node.items.flatMap((item) => {
      const text = completeSentences(item.text);
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
