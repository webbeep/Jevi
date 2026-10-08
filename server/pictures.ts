import type { CardNode, ImageCredit } from '../shared/card';
import { fileWords, fitsEntity, isComposite, namesSibling, rankForEntity, splitEntities } from '../shared/imagematch';
import type { ImageResult } from '../shared/types';
import { findImages } from './images';
import { type PicTarget, accepts, mentions, mentionsAny, nameLike, targetFor } from './imageGate';
import { fillRowImages, hasBlankPictures, rowEntity, type RowImageDeps } from './rowImages';
import type { Env } from './util';

type Emit = (node: CardNode, index: number) => void;
type Pic = { src: string; link: string; title: string };
type FindImages = (query: string, env: Env, n?: number, allowGeneric?: boolean) => Promise<ImageResult[]>;

/** T442 inputs from the stream: the card's single picture search, og:image reader, and a call counter. */
export type RowImagePlan = Omit<RowImageDeps, 'results' | 'pool'> & { onFilled?: (stats: { imageCalls: number; og: number; filled: number }) => void };

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

  /** T442: latest version of every emitted node, so blank tiles/rows can be filled once the card is complete. */
  private readonly latest = new Map<number, { node: CardNode; emit: Emit }>();
  private readonly rows?: RowImagePlan & { results: RowImageDeps['results'] };
  private readonly subject: string;

  constructor(env: Env, pool: ImageResult[], onCredit: (credit: ImageCredit) => void, query?: string, find: FindImages = findImages, rows?: RowImagePlan & { results: RowImageDeps['results'] }) {
    this.env = env;
    this.pool = pool;
    this.onCredit = onCredit;
    this.find = find;
    this.rows = rows;
    this.subject = query ?? '';
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
  private place(entity: string, imageRef?: number, imageQuery?: string, target?: PicTarget): { imageRef?: number; imageQuery?: string; imageSrc?: string } {
    // T443: attribute tiles (role, location, date…) never get a photo; the client shows the icon.
    if (target?.kind === 'none') return { imageRef: undefined, imageQuery: undefined, imageSrc: undefined };
    const gate = (img: ImageResult) => !target || accepts(target, img);
    if (imageRef === undefined) return { imageRef, imageQuery };
    const img = this.pool[imageRef];
    if (img?.thumb && !this.used.has(img.thumb) && !this.refConflicts(entity, img) && gate(img)) {
      this.used.add(img.thumb);
      return { imageRef, imageQuery };
    }
    const fit = this.pool.find((p) => p.thumb && !this.used.has(p.thumb) && !isComposite(p) && gate(p));
    if (!fit) return { imageRef: undefined, imageQuery: target?.kind === 'named' ? imageQuery : undefined };
    return { imageRef: undefined, imageQuery: undefined, imageSrc: this.take(fit).src };
  }

  /** T443 target for a node's picture. */
  private static tileTarget(n: { label: string; value?: string; imageQuery?: string }): PicTarget {
    return targetFor(n.label, n.value, n.imageQuery);
  }

  private static itemTarget(i: { text: string; imageQuery?: string }): PicTarget {
    const entity = i.imageQuery && nameLike(i.imageQuery) ? i.imageQuery : rowEntity(i.text);
    return nameLike(entity) ? { kind: 'named', entity } : { kind: 'none', entity: '' };
  }

  private vet(node: CardNode): CardNode {
    switch (node.type) {
      case 'tile':
        return { ...node, ...this.place(node.label, node.imageRef, node.imageQuery, PictureResolver.tileTarget(node)) };
      case 'profile':
        return { ...node, ...this.place(node.name, node.imageRef, node.imageQuery, { kind: 'named', entity: node.name }) };
      case 'stat': {
        // A designer-supplied stat picture must pass the gate on its own URL; attribute stats never keep one.
        if (!node.image) return node;
        const t = targetFor(node.label, node.value);
        return accepts(t, { title: '', url: node.image, thumb: node.image }) ? node : { ...node, image: undefined };
      }
      case 'list':
        return {
          ...node,
          items: node.items.map((item) => ({ ...item, ...this.place(itemEntity(item.text), item.imageRef, item.imageQuery, PictureResolver.itemTarget(item)) })),
        };
      case 'gallery': {
        // T443: card-level pictures must mention the card subject.
        const refs = node.refs.filter((r) => { const img = this.pool[r]; return !!img && mentionsAny(this.subject, img); });
        return { ...node, refs };
      }
      case 'image': {
        if (node.ref === undefined) return node;
        const img = this.pool[node.ref];
        return img && mentionsAny(node.caption ? `${this.subject} ${node.caption}` : this.subject, img) ? node : { ...node, ref: undefined, query: node.query ?? node.caption };
      }
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

  private async one(query: string, allowGeneric = false, target?: PicTarget): Promise<Pic | undefined> {
    // T443 gate: named items need their name in the picture; free-form images need the subject's main token.
    const gate = (img: ImageResult) => (target ? accepts(target, img) : mentions(query, img));
    const pooledRaw = this.fromPool(query);
    const pooled = pooledRaw && gate(pooledRaw) ? pooledRaw : this.pool.find((p) => p.thumb && !this.used.has(p.thumb) && !isComposite(p) && gate(p));
    if (pooled) return this.take(pooled);
    if (target?.kind === 'none' || this.lookupsLeft-- <= 0) return undefined;
    const found = await this.find(query, this.env, 3, allowGeneric);
    const pick = found.find((img) => this.accepts(query, img, allowGeneric) && gate(img));
    return pick && this.take(pick);
  }

  private async many(query: string, n: number): Promise<Pic[]> {
    if (this.lookupsLeft-- <= 0) return [];
    const found = await this.find(query, this.env, n, true);
    return found.filter((img) => !this.used.has(img.thumb) && !isComposite(img) && mentions(query, img)).map((img) => this.take(img));
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
        const target: PicTarget = node.type === 'tile' ? PictureResolver.tileTarget(node) : { kind: 'named', entity: node.name };
        const pic = await this.one(node.imageQuery, false, target);
        return { ...node, imageQuery: undefined, imageSrc: pic?.src };
      }
      case 'list': {
        const items = await Promise.all(
          node.items.map(async (i) => (i.imageQuery && i.imageRef === undefined ? { ...i, imageQuery: undefined, imageSrc: (await this.one(i.imageQuery, false, PictureResolver.itemTarget(i)))?.src } : i)),
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
    const track = (n: CardNode) => {
      if (this.rows) this.latest.set(index, { node: n, emit });
      emit(n, index);
    };
    track(vetted);
    // Start the card's one picture search early so it is ready when the card completes.
    if (this.rows?.cardImages && hasBlankPictures(vetted)) void this.rows.cardImages();
    if (!PictureResolver.needs(vetted)) return;
    this.pending.push(
      this.resolve(vetted)
        .then((patched) => track(patched))
        .catch((err) => console.error('picture lookup failed', err)),
    );
  }

  /** Waits for outstanding lookups so the card is complete before it is marked done; then fills blank tiles and rows (T442). */
  async flush(): Promise<void> {
    await Promise.allSettled(this.pending);
    if (!this.rows || !this.latest.size) return;
    try {
      const entries = [...this.latest.entries()];
      const filled = await fillRowImages(entries.map(([, e]) => e.node), { lookup: (entity) => this.find(entity, this.env, 3, false), ...this.rows, pool: this.pool }, this.used);
      let count = 0;
      entries.forEach(([index, e], i) => {
        if (!filled.changed[i]) return;
        count += 1;
        e.emit(filled.nodes[i], index);
      });
      this.rows.onFilled?.({ imageCalls: filled.imageCalls, og: filled.og, filled: count });
    } catch (err) {
      console.error('row pictures failed', err);
    }
  }
}
