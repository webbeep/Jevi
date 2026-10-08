import type { CardNode, ImageCredit } from '../shared/card';
import { fileWords, fitsEntity, isComposite, namesSibling, rankForEntity, splitEntities } from '../shared/imagematch';
import type { ImageResult } from '../shared/types';
import { findImages } from './images';
import type { Env } from './util';

type Emit = (node: CardNode, index: number) => void;
type Pic = { src: string; link: string; title: string };
type FindImages = (query: string, env: Env, n?: number, allowGeneric?: boolean) => Promise<ImageResult[]>;

/** List-item label: drop markdown and [n] citations, keep the first few words. */
function itemEntity(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\d+\]/g, ' ')
    .replace(/[*_~`>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 6)
    .join(' ');
}

/**
 * Finds real pictures for items the designer named (`imageQuery`) and patches
 * them into the card. Pictures already gathered with the search are checked
 * first (instant); otherwise the image sources are raced. A picture is used
 * only when it shows that item and not a comparison or a sibling item.
 * Nodes are shown immediately and re-emitted with their pictures as soon as
 * they are found.
 */
export class PictureResolver {
  private readonly pending: Promise<void>[] = [];
  private readonly used = new Set<string>();
  /** Query entities plus every item named on the card so far. */
  private readonly seen = new Set<string>();
  private readonly env: Env;
  /** Pictures that came with the search results (already allowed by the image policy). */
  private readonly pool: ImageResult[];
  private readonly onCredit: (credit: ImageCredit) => void;
  private readonly find: FindImages;

  constructor(env: Env, pool: ImageResult[], onCredit: (credit: ImageCredit) => void, query?: string, find: FindImages = findImages) {
    this.env = env;
    this.pool = pool;
    this.onCredit = onCredit;
    this.find = find;
    for (const name of splitEntities(query ?? '')) this.note(name);
  }

  private note(value?: string): void {
    const t = value?.trim();
    if (t) this.seen.add(t);
  }

  private siblings(): string[] {
    return [...this.seen];
  }

  /**
   * Remember every pictured item in the node before any of them picks a picture.
   * Only items that carry a picture count: plain labels ("Price", "Battery") are not rivals.
   */
  private collect(node: CardNode): void {
    switch (node.type) {
      case 'tile':
        if (node.imageQuery || node.imageRef !== undefined) this.note(node.imageQuery ?? node.label);
        return;
      case 'profile':
        if (node.imageQuery || node.imageRef !== undefined) this.note(node.imageQuery ?? node.name);
        return;
      case 'list':
        for (const item of node.items) if (item.imageQuery || item.imageRef !== undefined) this.note(item.imageQuery ?? itemEntity(item.text));
        return;
      case 'stack':
      case 'grid':
      case 'section':
      case 'scroller':
        node.children.forEach((child) => this.collect(child));
        return;
      case 'tabs':
        node.tabs.forEach((tab) => tab.children.forEach((child) => this.collect(child)));
        return;
      default:
        return;
    }
  }

  private take(img: ImageResult): Pic {
    this.used.add(img.thumb);
    this.onCredit({ src: img.thumb, link: img.url, credit: img.credit ?? img.source, license: img.license });
    return { src: img.thumb, link: img.url, title: img.title };
  }

  /** A pooled picture of this item, not a comparison and not a sibling's photo. */
  private fromPool(query: string): ImageResult | undefined {
    return rankForEntity(query, this.pool, this.siblings(), this.used);
  }

  /** The designer's image index shows a different item or a comparison. */
  private refConflicts(entity: string, img: ImageResult): boolean {
    const siblings = this.siblings();
    return isComposite(img) || namesSibling(entity, img.title, siblings) || namesSibling(entity, fileWords(img.thumb), siblings);
  }

  /**
   * Drop an imageRef that isn't this item. A fitting pooled photo replaces it;
   * otherwise the node keeps its icon and is not looked up remotely.
   */
  private place(entity: string, imageRef?: number, imageQuery?: string): { imageRef?: number; imageQuery?: string; imageSrc?: string } {
    if (imageRef === undefined) return { imageRef, imageQuery };
    const img = this.pool[imageRef];
    if (img?.thumb && !this.used.has(img.thumb) && !this.refConflicts(entity, img)) {
      this.used.add(img.thumb);
      return { imageRef, imageQuery };
    }
    if (!img?.thumb) return { imageRef, imageQuery };
    const fit = rankForEntity(entity, this.pool, this.siblings(), this.used);
    if (!fit) return { imageRef: undefined, imageQuery: undefined };
    return { imageRef: undefined, imageQuery: undefined, imageSrc: this.take(fit).src };
  }

  private vet(node: CardNode): CardNode {
    switch (node.type) {
      case 'tile':
        return { ...node, ...this.place(node.label, node.imageRef, node.imageQuery) };
      case 'profile':
        return { ...node, ...this.place(node.name, node.imageRef, node.imageQuery) };
      case 'list':
        return {
          ...node,
          items: node.items.map((item) => ({ ...item, ...this.place(itemEntity(item.text), item.imageRef, item.imageQuery) })),
        };
      case 'stack':
      case 'grid':
      case 'section':
      case 'scroller':
        return { ...node, children: node.children.map((child) => this.vet(child)) };
      case 'tabs':
        return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => this.vet(child)) })) };
      default:
        return node;
    }
  }

  /** Remote lookups left for this card; each costs one or more of the request's 50 subrequests. */
  private lookupsLeft = 10;

  private accepts(query: string, img: ImageResult, allowGeneric: boolean): boolean {
    if (this.used.has(img.thumb) || isComposite(img)) return false;
    const siblings = this.siblings();
    if (namesSibling(query, img.title, siblings) || namesSibling(query, fileWords(img.thumb), siblings)) return false;
    return allowGeneric || fitsEntity(query, img, siblings);
  }

  private async one(query: string, allowGeneric = false): Promise<Pic | undefined> {
    const pooled = this.fromPool(query);
    if (pooled) return this.take(pooled);
    if (this.lookupsLeft-- <= 0) return undefined;
    const found = await this.find(query, this.env, 3, allowGeneric);
    const pick = found.find((img) => this.accepts(query, img, allowGeneric));
    return pick && this.take(pick);
  }

  private async many(query: string, n: number): Promise<Pic[]> {
    if (this.lookupsLeft-- <= 0) return [];
    const found = await this.find(query, this.env, n, true);
    return found.filter((img) => !this.used.has(img.thumb) && !isComposite(img)).map((img) => this.take(img));
  }

  private static needs(node: CardNode): boolean {
    switch (node.type) {
      case 'tile':
      case 'profile':
        return !!node.imageQuery && node.imageRef === undefined;
      case 'list':
        return node.items.some((i) => i.imageQuery && i.imageRef === undefined);
      case 'image':
      case 'gallery':
        return !!node.query;
      default:
        return 'children' in node ? node.children.some(PictureResolver.needs) : node.type === 'tabs' && node.tabs.some((t) => t.children.some(PictureResolver.needs));
    }
  }

  private async resolve(node: CardNode): Promise<CardNode> {
    switch (node.type) {
      case 'tile':
      case 'profile': {
        if (!node.imageQuery || node.imageRef !== undefined) return node;
        const pic = await this.one(node.imageQuery);
        return { ...node, imageQuery: undefined, imageSrc: pic?.src };
      }
      case 'list': {
        const items = await Promise.all(
          node.items.map(async (i) => (i.imageQuery && i.imageRef === undefined ? { ...i, imageQuery: undefined, imageSrc: (await this.one(i.imageQuery))?.src } : i)),
        );
        return { ...node, items };
      }
      case 'image': {
        if (!node.query) return node;
        const pic = await this.one(node.query, true);
        return { ...node, query: undefined, src: pic?.src, link: pic?.link, caption: node.caption ?? pic?.title };
      }
      case 'gallery': {
        if (!node.query) return node;
        return { ...node, query: undefined, pics: await this.many(node.query, 6) };
      }
      case 'stack':
      case 'grid':
      case 'section':
      case 'scroller':
        return { ...node, children: await Promise.all(node.children.map((c) => this.resolve(c))) };
      case 'tabs':
        return { ...node, tabs: await Promise.all(node.tabs.map(async (t) => ({ ...t, children: await Promise.all(t.children.map((c) => this.resolve(c))) }))) };
      default:
        return node;
    }
  }

  /** Emits `node` now and, if it asked for pictures, again once they are found. */
  emit(node: CardNode, index: number, emit: Emit): void {
    this.collect(node);
    const vetted = this.vet(node);
    emit(vetted, index);
    if (!PictureResolver.needs(vetted)) return;
    this.pending.push(
      this.resolve(vetted)
        .then((patched) => emit(patched, index))
        .catch((err) => console.error('picture lookup failed', err)),
    );
  }

  /** Waits for outstanding lookups so the card is complete before it is marked done. */
  async flush(): Promise<void> {
    await Promise.allSettled(this.pending);
  }
}
