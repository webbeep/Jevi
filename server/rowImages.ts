import type { CardNode, ImageCredit } from '../shared/card';
import { isComposite } from '../shared/imagematch';
import { shoppingAsk } from './claims';
import { type EntityHint, type GateContext, type PicTarget, accepts, hostNames, nameLike, namedTarget, pageNames, targetFor } from './imageGate';
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
  /** t444 hook (Backend patch-entity): disambiguated name/aliases/domains for an entity. */
  hintFor?: (entity: string) => EntityHint | undefined;
  /** The one person the card is about: every picture must be them. */
  person?: string;
  /** t444: every filled picture reports the page it came from, so the client can show its tap-to-source credit. */
  onCredit?: (credit: ImageCredit) => void;
  /** The ask. A shopping list of products gets a picture per item even when the list is not marked media. */
  query?: string;
}

/** Result titles + snippets: proper-noun evidence for one-word labels. */
export const corpusOf = (results: SearchResult[]) => results.map((r) => `${r.title ?? ''}. ${r.snippet ?? ''}`).join('\n');

interface Slot {
  entity: string;
  target: PicTarget;
  source?: number;
  /** og:image fallback allowed (rows and tiles; never stats). */
  ogOk: boolean;
  /** Org tiles: the org's own site among the results. */
  officialSite?: string;
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


const blankTile = (n: Extract<CardNode, { type: 'tile' }>) => !n.imageSrc && n.imageRef === undefined && !n.imageQuery;
const blankItem = (i: Extract<CardNode, { type: 'list' }>['items'][number]) => !i.imageSrc && i.imageRef === undefined && !i.imageQuery;

const STEP = /^(?:mix|add|preheat|stir|bake|cut|place|heat|combine|pour|serve|whisk|fold|cook|boil|simmer|chop|slice|let|set|remove|transfer|repeat|then|rinse|drain|season|cover|bring)\b/i;

/** A short name a picture can show: a product, a variety, a place. Not a step. */
function thingName(entity: string): boolean {
  if (!entity || entity.length < 3 || STEP.test(entity)) return false;
  const words = entity.split(/\s+/);
  if (words.length > 6) return false;
  if (words.length >= 5 && /\b(?:is|are|was|were|has|have|with|that)\b/i.test(entity)) return false;
  return /^[A-Z0-9]/.test(words[0] ?? '');
}

/**
 * A media list always gets pictures. So does a shopping list, and any other list whose items
 * are short names. A numbered procedure does not.
 */
function listGetsPictures(node: Extract<CardNode, { type: 'list' }>, query?: string): boolean {
  if (node.style === 'media') return true;
  if (node.style === 'number') return false;
  const names = node.items.map((item) => rowEntity(item.text)).filter(thingName);
  if (names.length < 2 || names.length < node.items.length) return false;
  if (query && shoppingAsk(query)) return true;
  return names.every((entity) => entity.split(/\s+/).length <= 4);
}

/** The picture target for one list item. A name the row itself capitalizes still counts. */
function itemPictureTarget(entity: string, text: string, ctx?: GateContext): PicTarget {
  const named = namedTarget(entity, ctx);
  if (named.kind !== 'none') return named;
  const words = entity.trim().split(/\s+/);
  const written = words.length > 0 && words.length <= 4 && words.every((word) => /^[A-Z0-9]/.test(word)) && nameLike(entity) && !STEP.test(text);
  if (!written || ctx?.person) return named;
  return { kind: 'named', entity: entity.trim() };
}

function slotsOf(node: CardNode, out: Slot[], ctx?: GateContext, query?: string): void {
  switch (node.type) {
    case 'stat': {
      // Stat tiles carry no source: only a gated picture that names them, never og:image.
      if (node.image) return;
      const target = targetFor(node.label, node.value, undefined, ctx);
      out.push({ entity: target.entity, target, ogOk: false });
      return;
    }
    case 'tile': {
      if (!blankTile(node)) return;
      const target = targetFor(node.label, node.value, undefined, ctx);
      out.push({ entity: target.entity, target, source: node.source, ogOk: true });
      return;
    }
    case 'list':
      if (listGetsPictures(node, query)) {
        for (const item of node.items) {
          if (!blankItem(item)) continue;
          const entity = rowEntity(item.text);
          out.push({ entity, target: itemPictureTarget(entity, item.text, ctx), source: item.source, ogOk: true });
        }
      }
      return;
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      node.children.forEach((c) => slotsOf(c, out, ctx, query));
      return;
    case 'tabs':
      node.tabs.forEach((t) => t.children.forEach((c) => slotsOf(c, out, ctx, query)));
      return;
    default:
      return;
  }
}

function apply(node: CardNode, slots: Slot[], at: { i: number }, query?: string): CardNode {
  switch (node.type) {
    case 'stat': {
      if (node.image) return node;
      const s = slots[at.i++];
      return s?.src ? { ...node, image: s.src } : node;
    }
    case 'tile': {
      if (!blankTile(node)) return node;
      const s = slots[at.i++];
      return s?.src ? { ...node, imageSrc: s.src } : node;
    }
    case 'list': {
      if (!listGetsPictures(node, query)) return node;
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
      return { ...node, children: node.children.map((c) => apply(c, slots, at, query)) };
    case 'tabs':
      return { ...node, tabs: node.tabs.map((t) => ({ ...t, children: t.children.map((c) => apply(c, slots, at, query)) })) };
    default:
      return node;
  }
}

/** True when the node has a tile or named list row without any picture. */
export function hasBlankPictures(node: CardNode, ctx?: GateContext, query?: string): boolean {
  const out: Slot[] = [];
  slotsOf(node, out, ctx, query);
  return out.length > 0;
}

/** Best unused picture that passes the T443 relevance gate for this slot. */
function pick(target: PicTarget, images: ImageResult[], used: Set<string>): ImageResult | undefined {
  if (target.kind === 'none') return undefined;
  return images.find((img) => https(img.thumb) && !used.has(img.thumb) && !isComposite(img) && accepts(target, img));
}

/** Fills blank tiles and media rows across the card's nodes. Returns the patched nodes (same order) and the calls spent. */
export async function fillRowImages(nodes: CardNode[], deps: RowImageDeps, used: Set<string> = new Set()): Promise<{ nodes: CardNode[]; changed: boolean[]; imageCalls: number; og: number }> {
  const ctx: GateContext = { corpus: corpusOf(deps.results), hintFor: deps.hintFor, person: deps.person };
  const perNode = nodes.map((n) => {
    const s: Slot[] = [];
    slotsOf(n, s, ctx, deps.query);
    return s;
  });
  const all = perNode.flat();
  const live = all.filter((s) => s.target.kind !== 'none');
  if (!live.length) return { nodes, changed: nodes.map(() => false), imageCalls: 0, og: 0 };
  const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const take = (s: Slot, src: string, from?: { url?: string; credit?: string; source?: string; license?: ImageResult['license'] }) => {
    s.src = src;
    used.add(src);
    const link = from?.url;
    if (deps.onCredit && link && https(link)) deps.onCredit({ src, link, credit: from?.credit ?? from?.source ?? hostOf(link), license: from?.license ?? 'source' });
  };
  const credit = (img: ImageResult) => ({ url: img.url, credit: img.credit, source: img.source, license: img.license });

  // 1. Zero calls: the row's own source picture (when that page names it), then gated pooled pictures.
  //    Orgs: a result on the org's own site (its picture or og:image), else nothing.
  for (const s of live) {
    const own = s.source ? deps.results[s.source - 1] : undefined;
    if (s.target.kind === 'org') {
      const site = deps.results.find((r) => hostNames(s.target.entity, r.url));
      if (site && https(site.image) && !used.has(site.image)) {
        take(s, site.image, { url: site.url });
        continue;
      }
      if (site) s.officialSite = site.url;
    } else if (own && pageNames(s.target, own)) {
      const ownPic = own.image ?? deps.pool.find((p) => p.url === own.url)?.thumb;
      if (https(ownPic) && !used.has(ownPic)) {
        take(s, ownPic, { url: own.url });
        continue;
      }
    }
    const pooled = pick(s.target, deps.pool, used);
    if (pooled) take(s, pooled.thumb, credit(pooled));
  }

  // 2. At most one picture search for the card, matched to rows by name.
  let imageCalls = 0;
  if (live.some((s) => !s.src) && deps.cardImages) {
    const found = await deps.cardImages();
    imageCalls = found.length ? 1 : 0;
    for (const s of live) {
      if (s.src) continue;
      const hit = pick(s.target, found, used);
      if (hit) take(s, hit.thumb, credit(hit));
    }
  }

  // 2b. Free per-name lookups (Wikipedia first) for name-like rows still blank, at most 6, ~2s.
  if (deps.lookup) {
    const want = live.filter((s) => !s.src && s.target.kind === 'named').slice(0, 6);
    const found = await Promise.all(want.map((s) => Promise.race([deps.lookup!(s.entity).catch(() => [] as ImageResult[]), new Promise<ImageResult[]>((r) => setTimeout(() => r([]), 2000))])));
    want.forEach((s, i) => {
      if (s.src) return;
      const hit = pick(s.target, found[i], used);
      if (hit) take(s, hit.thumb, credit(hit));
    });
  }

  // 3. The row's source page og:image, a few in parallel with a short timeout.
  let og = 0;
  if (deps.og) {
    // A source page shared by several rows (a rankings article) has one picture that fits none of them in particular.
    const perSource = new Map<number, number>();
    for (const s of live) if (s.source) perSource.set(s.source, (perSource.get(s.source) ?? 0) + 1);
    // Orgs: og:image of their own site. Named rows: og:image of their own unshared source page when that page names them.
    const want = live
      .filter((s) => !s.src && s.ogOk)
      .flatMap((s) => {
        if (s.target.kind === 'org') return s.officialSite ? [{ s, url: s.officialSite }] : [];
        const own = s.source ? deps.results[s.source - 1] : undefined;
        return own && perSource.get(s.source!) === 1 && pageNames(s.target, own) ? [{ s, url: own.url }] : [];
      })
      .slice(0, deps.ogMax ?? 6);
    og = want.length;
    const pics = await Promise.all(want.map((w) => deps.og!(w.url)));
    want.forEach((w, i) => {
      const src = pics[i];
      if (https(src) && !used.has(src)) take(w.s, src, { url: w.url });
    });
  }

  const changed: boolean[] = [];
  const out = nodes.map((n, i) => {
    if (!perNode[i].some((s) => s.src)) {
      changed.push(false);
      return n;
    }
    changed.push(true);
    return apply(n, perNode[i], { i: 0 }, deps.query);
  });
  return { nodes: out, changed, imageCalls, og };
}
