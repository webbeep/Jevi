import type { CardNode } from '../shared/card';
import { fitsEntity, isComposite } from '../shared/imagematch';
import type { ImageResult, SearchResult } from '../shared/types';

/**
 * T442: pictures for ranked rows (media lists) and tiles the designer left without one.
 * Order, cheapest first: the row's own source result picture, a pooled picture that names the row
 * (0 calls) → at most one card-level picture search (Serper /images, matched to rows by name) →
 * og:image of the row's source page (direct fetch, ~2s). https only; a row with no fit keeps its
 * number/icon. Fills the existing `imageSrc` field on tiles and list items, and `image` on stat tiles (T441 field).
 */
export interface RowImageDeps {
  results: SearchResult[];
  pool: ImageResult[];
  /** The card's single picture search (shared with the T436 boost); resolves [] when not allowed. */
  cardImages?: () => Promise<ImageResult[]>;
  og?: (url: string) => Promise<string | undefined>;
  /** Free per-name picture lookup (Wikipedia, Commons, Openverse; 0 paid calls), tried for name-like rows before og:image. */
  lookup?: (entity: string) => Promise<ImageResult[]>;
  /** Most og:image fetches per card. */
  ogMax?: number;
}

interface Slot {
  entity: string;
  source?: number;
  /** og:image fallback allowed (rows, and name-like tiles). */
  ogOk: boolean;
  src?: string;
}

const https = (u?: string): u is string => !!u && /^https:\/\//i.test(u);

/** The thing a row is about: text before the first dash, colon, comma or bracket, without markdown or citations. */
export function rowEntity(text: string): string {
  const plain = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\d+\]/g, ' ')
    .replace(/[*_~`>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const head = plain.split(/\s[—–-]\s|:|,|\(|\s\|\s/)[0] ?? plain;
  return head.split(' ').slice(0, 6).join(' ').trim();
}

/** "Lendeborg", "Steph Curry", "OKC Thunder": 1–4 words, each capitalised or a number. */
const nameLike = (s: string) => /^(?:[A-Z0-9][\w.'’&-]*)(?:\s+[A-Z0-9][\w.'’&-]*){0,3}$/.test(s.trim());

const blankTile = (n: Extract<CardNode, { type: 'tile' }>) => !n.imageSrc && n.imageRef === undefined && !n.imageQuery;
const blankItem = (i: Extract<CardNode, { type: 'list' }>['items'][number]) => !i.imageSrc && i.imageRef === undefined && !i.imageQuery;

function slotsOf(node: CardNode, out: Slot[]): void {
  switch (node.type) {
    case 'stat':
      // Stat tiles carry no source: only a picture that names them (pool or the card search), never og:image.
      if (!node.image && nameLike(node.label)) out.push({ entity: node.label, ogOk: false });
      return;
    case 'tile':
      if (blankTile(node)) out.push({ entity: node.label, source: node.source, ogOk: nameLike(node.label) });
      return;
    case 'list':
      if (node.style === 'media') for (const item of node.items) if (blankItem(item)) out.push({ entity: rowEntity(item.text), source: item.source, ogOk: true });
      return;
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      node.children.forEach((c) => slotsOf(c, out));
      return;
    case 'tabs':
      node.tabs.forEach((t) => t.children.forEach((c) => slotsOf(c, out)));
      return;
    default:
      return;
  }
}

function apply(node: CardNode, slots: Slot[], at: { i: number }): CardNode {
  switch (node.type) {
    case 'stat': {
      if (node.image || !nameLike(node.label)) return node;
      const s = slots[at.i++];
      return s?.src ? { ...node, image: s.src } : node;
    }
    case 'tile': {
      if (!blankTile(node)) return node;
      const s = slots[at.i++];
      return s?.src ? { ...node, imageSrc: s.src } : node;
    }
    case 'list': {
      if (node.style !== 'media') return node;
      return {
        ...node,
        items: node.items.map((item) => {
          if (!blankItem(item)) return item;
          const s = slots[at.i++];
          return s?.src ? { ...item, imageSrc: s.src } : item;
        }),
      };
    }
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return { ...node, children: node.children.map((c) => apply(c, slots, at)) };
    case 'tabs':
      return { ...node, tabs: node.tabs.map((t) => ({ ...t, children: t.children.map((c) => apply(c, slots, at)) })) };
    default:
      return node;
  }
}

/** True when the node has a tile or media row without any picture. */
export function hasBlankPictures(node: CardNode): boolean {
  const out: Slot[] = [];
  slotsOf(node, out);
  return out.length > 0;
}

/** Best unused picture that names this entity and only this entity. */
function pick(entity: string, images: ImageResult[], siblings: string[], used: Set<string>): ImageResult | undefined {
  if (!entity) return undefined;
  const rivals = siblings.filter((s) => s !== entity);
  return images.find((img) => https(img.thumb) && !used.has(img.thumb) && !isComposite(img) && fitsEntity(entity, img, rivals));
}

/** Fills blank tiles and media rows across the card's nodes. Returns the patched nodes (same order) and the calls spent. */
export async function fillRowImages(nodes: CardNode[], deps: RowImageDeps, used: Set<string> = new Set()): Promise<{ nodes: CardNode[]; changed: boolean[]; imageCalls: number; og: number }> {
  const perNode = nodes.map((n) => {
    const s: Slot[] = [];
    slotsOf(n, s);
    return s;
  });
  const all = perNode.flat();
  if (!all.length) return { nodes, changed: nodes.map(() => false), imageCalls: 0, og: 0 };
  const siblings = all.map((s) => s.entity).filter(Boolean);
  const take = (s: Slot, src: string) => {
    s.src = src;
    used.add(src);
  };

  // 1. Zero calls: the row's own source picture, then pooled pictures that name it.
  for (const s of all) {
    const own = s.source ? deps.results[s.source - 1] : undefined;
    const ownPic = own ? (own.image ?? deps.pool.find((p) => p.url === own.url)?.thumb) : undefined;
    if (https(ownPic) && !used.has(ownPic)) {
      take(s, ownPic);
      continue;
    }
    const pooled = pick(s.entity, deps.pool, siblings, used);
    if (pooled) take(s, pooled.thumb);
  }

  // 2. At most one picture search for the card, matched to rows by name.
  let imageCalls = 0;
  if (all.some((s) => !s.src) && deps.cardImages) {
    const found = await deps.cardImages();
    imageCalls = found.length ? 1 : 0;
    for (const s of all) {
      if (s.src) continue;
      const hit = pick(s.entity, found, siblings, used);
      if (hit) take(s, hit.thumb);
    }
  }

  // 2b. Free per-name lookups (Wikipedia first) for name-like rows still blank, at most 6, ~2s.
  if (deps.lookup) {
    const want = all.filter((s) => !s.src && nameLike(s.entity)).slice(0, 6);
    const found = await Promise.all(want.map((s) => Promise.race([deps.lookup!(s.entity).catch(() => [] as ImageResult[]), new Promise<ImageResult[]>((r) => setTimeout(() => r([]), 2000))])));
    want.forEach((s, i) => {
      if (s.src) return;
      const hit = pick(s.entity, found[i], siblings, used);
      if (hit) take(s, hit.thumb);
    });
  }

  // 3. The row's source page og:image, a few in parallel with a short timeout.
  let og = 0;
  if (deps.og) {
    // A source page shared by several rows (a rankings article) has one picture that fits none of them in particular.
    const perSource = new Map<number, number>();
    for (const s of all) if (s.source) perSource.set(s.source, (perSource.get(s.source) ?? 0) + 1);
    const want = all.filter((s) => !s.src && s.ogOk && s.source && perSource.get(s.source) === 1 && deps.results[s.source - 1]).slice(0, deps.ogMax ?? 6);
    og = want.length;
    const pics = await Promise.all(want.map((s) => deps.og!(deps.results[s.source! - 1]!.url)));
    want.forEach((s, i) => {
      const src = pics[i];
      if (https(src) && !used.has(src)) take(s, src);
    });
  }

  const changed: boolean[] = [];
  const out = nodes.map((n, i) => {
    if (!perNode[i].some((s) => s.src)) {
      changed.push(false);
      return n;
    }
    changed.push(true);
    return apply(n, perNode[i], { i: 0 });
  });
  return { nodes: out, changed, imageCalls, og };
}
