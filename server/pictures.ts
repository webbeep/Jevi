import type { CardNode } from '../shared/card';
import { findImages } from './images';
import type { Env } from './util';

type Emit = (node: CardNode, index: number) => void;

/**
 * Finds real pictures for items the designer named (`imageQuery`) and patches
 * them into the card. Nodes are shown immediately; each one is re-emitted with
 * its pictures as soon as they are found, so thumbnails fill in progressively.
 */
export class PictureResolver {
  private readonly pending: Promise<void>[] = [];
  private readonly used = new Set<string>();

  constructor(private readonly env: Env) {}

  private async one(query: string, allowGeneric = false): Promise<{ src: string; link: string; title: string } | undefined> {
    const found = await findImages(query, this.env, 3, allowGeneric);
    const pick = found.find((img) => !this.used.has(img.thumb));
    if (!pick) return undefined;
    this.used.add(pick.thumb);
    return { src: pick.thumb, link: pick.url, title: pick.title };
  }

  private async many(query: string, n: number) {
    const found = await findImages(query, this.env, n, true);
    return found.filter((img) => !this.used.has(img.thumb) && this.used.add(img.thumb)).map((img) => ({ src: img.thumb, link: img.url, title: img.title }));
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
