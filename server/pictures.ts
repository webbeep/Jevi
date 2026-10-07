import type { CardNode, ImageCredit } from '../shared/card';
import type { ImageResult } from '../shared/types';
import { findImages, matches } from './images';
import type { Env } from './util';

type Emit = (node: CardNode, index: number) => void;
type Pic = { src: string; link: string; title: string };

/**
 * Finds real pictures for items the designer named (`imageQuery`) and patches
 * them into the card. Pictures already gathered with the search are checked
 * first (instant); otherwise the image sources are raced. Nodes are shown
 * immediately and re-emitted with their pictures as soon as they are found.
 */
export class PictureResolver {
  private readonly pending: Promise<void>[] = [];
  private readonly used = new Set<string>();

  constructor(
    private readonly env: Env,
    /** Pictures that came with the search results (already allowed by the image policy). */
    private readonly pool: ImageResult[],
    private readonly onCredit: (credit: ImageCredit) => void,
  ) {}

  private take(img: ImageResult): Pic {
    this.used.add(img.thumb);
    this.onCredit({ src: img.thumb, link: img.url, credit: img.credit ?? img.source, license: img.license });
    return { src: img.thumb, link: img.url, title: img.title };
  }

  /** A pooled picture whose title names every significant word of the item. */
  private fromPool(query: string): ImageResult | undefined {
    return this.pool.find((img) => !this.used.has(img.thumb) && img.title && matches(query, img.title));
  }

  /** Remote lookups left for this card; each costs one or more of the request's 50 subrequests. */
  private lookupsLeft = 10;

  private async one(query: string, allowGeneric = false): Promise<Pic | undefined> {
    const pooled = this.fromPool(query);
    if (pooled) return this.take(pooled);
    if (this.lookupsLeft-- <= 0) return undefined;
    const found = await findImages(query, this.env, 3, allowGeneric);
    const pick = found.find((img) => !this.used.has(img.thumb));
    return pick && this.take(pick);
  }

  private async many(query: string, n: number): Promise<Pic[]> {
    if (this.lookupsLeft-- <= 0) return [];
    const found = await findImages(query, this.env, n, true);
    return found.filter((img) => !this.used.has(img.thumb)).map((img) => this.take(img));
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
    emit(node, index);
    if (!PictureResolver.needs(node)) return;
    this.pending.push(
      this.resolve(node)
        .then((patched) => emit(patched, index))
        .catch((err) => console.error('picture lookup failed', err)),
    );
  }

  /** Waits for outstanding lookups so the card is complete before it is marked done. */
  async flush(): Promise<void> {
    await Promise.allSettled(this.pending);
  }
}
