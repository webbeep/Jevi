import type { CardNode } from '../shared/card';

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\[\d+\]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

function trimToSentences(text: string, max: number): string {
  if (text.length <= max) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(\s*\[\d+\])*\s*/g) ?? [text];
  let out = '';
  for (const s of sentences) {
    if ((out + s).length > max && out) break;
    out += s;
  }
  return out.trim() || `${text.slice(0, max - 1)}…`;
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

  constructor(private readonly textCap: number) {}

  /** Keeps only sentences not seen before; returns '' when nothing new remains. */
  private fresh(text: string): string {
    const sentences = text.match(/[^.!?]+[.!?]*(\s*\[\d+\])*\s*/g) ?? [text];
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
        const ref = this.image(node.ref);
        return ref === undefined ? undefined : node;
      }
      case 'gallery': {
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
