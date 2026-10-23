import type { CardNode, ImageCredit } from '../shared/card';
import { claimsFigure, showsFigure } from '../shared/figure';
import { fileWords, fitsEntity, isComposite, namesSibling, rankForEntity, splitEntities } from '../shared/imagematch';
import type { ImageResult } from '../shared/types';
import { findImages } from './images';
import type { TeamLogo } from './liveScore';
import { type GateContext, type PicTarget, accepts, contextMarks, mentions, mentionsAny, nameLike, namedTarget, namesPerson, personPage, portraitMatches, portraitSrcOk, profilePortraitMarks, profilePortraitQuery, targetFor, withHint } from './imageGate';
import { corpusOf, fillRowImages, hasBlankPictures, rowEntity, type RowImageDeps } from './rowImages';
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
/**
 * SPD5 (t457): the longest the finished card waits for picture lookups and row pictures once the text is
 * done. Lookups (3 s timeout + hedge) held `done` up to ~4 s on picture-heavy cards; pictures that are
 * not in by then are left out, and nothing is emitted after the cap.
 */
export const PICTURE_WAIT_MS = 1500;

/** Product-row lookups start while the card is still being written, and may finish shortly after the text. */
const ROW_FILL_WAIT_MS = 2500;

export class PictureResolver {
  private readonly pending: Promise<void>[] = [];

  /** Set once flush gives up waiting: later picture patches are dropped instead of arriving after done. */
  private closed = false;
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
  /** T443 gate context: result text for proper-noun checks, plus the optional t444 entity hint lookup. */
  private readonly ctx: GateContext;

  constructor(env: Env, pool: ImageResult[], onCredit: (credit: ImageCredit) => void, query?: string, find: FindImages = findImages, rows?: RowImagePlan & { results: RowImageDeps['results'] }) {
    this.env = env;
    this.pool = pool;
    this.onCredit = onCredit;
    this.find = find;
    this.rows = rows;
    this.subject = query ?? '';
    this.ctx = { corpus: corpusOf(rows?.results ?? []), hintFor: rows?.hintFor, person: rows?.person };
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
  private tileTarget(n: { label: string; value?: string; imageQuery?: string }): PicTarget {
    return targetFor(n.label, n.value, n.imageQuery, this.ctx);
  }

  private itemTarget(i: { text: string; imageQuery?: string }): PicTarget {
    const entity = i.imageQuery && nameLike(i.imageQuery) ? i.imageQuery : rowEntity(i.text);
    return namedTarget(entity, this.ctx);
  }

  private profileTarget(name: string): PicTarget {
    if (this.ctx.person && !namesPerson(name, this.ctx.person)) return { kind: 'none', entity: '' };
    return withHint({ kind: 'named', entity: name }, this.ctx);
  }

  /**
   * A profile photo has to be a page about the resolved person. A picture from the
   * original results whose page is someone else is dropped, and the portrait is searched again.
   */
  /** A picture already in hand whose page is this person and names a company or role on the card. */
  private pooledPortrait(name: string, marks: readonly string[]): ImageResult | undefined {
    return this.pool.find((img) => img.thumb && !this.used.has(img.thumb) && portraitSrcOk(img.thumb) && personPage(name, img) && portraitMatches(marks, img));
  }

  private vetProfile(node: Extract<CardNode, { type: 'profile' }>): CardNode {
    const target = this.profileTarget(node.name);
    const placed = this.place(node.name, node.imageRef, node.imageQuery, target);
    const marks = [...new Set([...profilePortraitMarks(node), ...contextMarks(target.hint?.context)])];
    if (!marks.length) return { ...node, ...placed };
    const img = placed.imageSrc
      ? this.pool.find((p) => p.thumb === placed.imageSrc)
      : placed.imageRef !== undefined ? this.pool[placed.imageRef] : undefined;
    if (img && portraitSrcOk(img.thumb) && portraitMatches(marks, img) && personPage(node.name, img)) return { ...node, ...placed };
    const ready = this.pooledPortrait(node.name, marks);
    if (ready) {
      const pic = this.take(ready);
      return { ...node, imageRef: undefined, imageQuery: undefined, imageSrc: pic.src };
    }
    const query = profilePortraitQuery(node, target.hint?.context ?? []);
    return { ...node, imageRef: undefined, imageSrc: undefined, imageQuery: query };
  }

  /** Card-level pictures: on a one-person card that person's photo, else anything that mentions the subject. */
  private cardPicture(img: ImageResult, about = this.subject): boolean {
    return this.ctx.person ? accepts(this.profileTarget(this.ctx.person), img) : mentionsAny(about, img);
  }

  private vet(node: CardNode): CardNode {
    switch (node.type) {
      case 'tile':
        return { ...node, ...this.place(node.label, node.imageRef, node.imageQuery, this.tileTarget(node)) };
      case 'profile':
        return this.vetProfile(node);
      case 'stat': {
        // A designer-supplied stat picture must pass the gate on its own URL; attribute stats never keep one.
        if (!node.image) return node;
        const t = targetFor(node.label, node.value, undefined, this.ctx);
        return accepts(t, { title: '', url: node.image, thumb: node.image }) ? node : { ...node, image: undefined };
      }
      case 'list':
        return {
          ...node,
          items: node.items.map((item) => ({ ...item, ...this.place(itemEntity(item.text), item.imageRef, item.imageQuery, this.itemTarget(item)) })),
        };
      case 'gallery': {
        // T443: card-level pictures must mention the card subject.
        const refs = node.refs.filter((r) => { const img = this.pool[r]; return !!img && this.cardPicture(img); });
        return { ...node, refs };
      }
      case 'image': {
        const claim = `${node.caption ?? ''} ${node.query ?? ''}`;
        const figure = claimsFigure(claim);
        if (node.ref === undefined) return figure && !node.query ? { ...node, src: undefined } : node;
        const img = this.pool[node.ref];
        const about = node.caption ? `${this.subject} ${node.caption}` : this.subject;
        const named = !!img && (this.ctx.person ? this.cardPicture(img, about) : mentionsAny(about, img));
        if (named && (!figure || showsFigure(img))) return node;
        if (figure) return { ...node, ref: undefined, query: undefined, src: undefined };
        return { ...node, ref: undefined, query: this.ctx.person ? undefined : node.query ?? node.caption };
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
  /** Blank product rows fill one after another so two rows cannot claim the same picture. */
  private fillQueue: Promise<void> = Promise.resolve();
  /** Product rows looked up as soon as they were shown get a longer finish wait than other pictures. */
  private rowFillStarted = false;
  /** Picture work started when the row was shown, reported once when the card finishes. */
  private rowStats = { imageCalls: 0, og: 0, filled: 0 };

  private accepts(query: string, img: ImageResult, allowGeneric: boolean): boolean {
    if (this.used.has(img.thumb) || isComposite(img)) return false;
    const siblings = this.siblings();
    if (namesSibling(query, img.title, siblings) || namesSibling(query, fileWords(img.thumb), siblings)) return false;
    return allowGeneric || fitsEntity(query, img, siblings);
  }

  private async one(query: string, allowGeneric = false, target?: PicTarget): Promise<Pic | undefined> {
    // T443 gate: named items need their name in the picture; free-form images need the subject's main token.
    // A resolved person's portrait also has to be their own page, not a logo or a team graphic.
    const ownPortrait = !!this.ctx.person && !!target && target.kind === 'named' && namesPerson(target.entity, this.ctx.person);
    const gate = (img: ImageResult) => {
      if (!(target ? accepts(target, img) : this.ctx.person ? this.cardPicture(img) : mentions(query, img))) return false;
      return !ownPortrait || (portraitSrcOk(img.thumb) && personPage(this.ctx.person!, img));
    };
    const pooledRaw = this.fromPool(query);
    const pooled = pooledRaw && gate(pooledRaw) ? pooledRaw : this.pool.find((p) => p.thumb && !this.used.has(p.thumb) && !isComposite(p) && gate(p));
    if (pooled) return this.take(pooled);
    if (this.rows?.cardImages) {
      const boosted = await this.rows.cardImages();
      const hit = boosted.find((img) => img.thumb && !this.used.has(img.thumb) && !isComposite(img) && gate(img));
      if (hit) return this.take(hit);
    }
    if (target?.kind === 'none' || this.lookupsLeft-- <= 0) return undefined;
    const found = await this.find(query, this.env, 3, allowGeneric);
    const pick = found.find((img) => this.accepts(query, img, allowGeneric) && gate(img));
    return pick && this.take(pick);
  }

  private async many(query: string, n: number): Promise<Pic[]> {
    if (this.lookupsLeft-- <= 0) return [];
    const found = await this.find(query, this.env, n, true);
    return found.filter((img) => !this.used.has(img.thumb) && !isComposite(img) && (this.ctx.person ? this.cardPicture(img) : mentions(query, img))).map((img) => this.take(img));
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
        const target: PicTarget = node.type === 'tile' ? this.tileTarget(node) : this.profileTarget(node.name);
        const pic = await this.one(node.imageQuery, false, target);
        return { ...node, imageQuery: undefined, imageSrc: pic?.src };
      }
      case 'list': {
        const items = await Promise.all(
          node.items.map(async (i) => (i.imageQuery && i.imageRef === undefined ? { ...i, imageQuery: undefined, imageSrc: (await this.one(i.imageQuery, false, this.itemTarget(i)))?.src } : i)),
        );
        return { ...node, items };
      }
      case 'image': {
        const query = node.query;
        if (!query) return node;
        const claim = `${query} ${node.caption ?? ''}`;
        if (claimsFigure(claim)) {
          const pooled = this.pool.find((img) => img.thumb && !this.used.has(img.thumb) && showsFigure(img) && mentions(query, img));
          if (!pooled) return { ...node, query: undefined, src: undefined, ref: undefined };
          const pic = this.take(pooled);
          return { ...node, query: undefined, src: pic.src, link: pic.link, caption: node.caption ?? pic.title };
        }
        const pic = await this.one(query, true);
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

  private logos: TeamLogo[] = [];

  /** A scoreboard card: teams show their own logos and nothing is looked up ("Nuggets" is not a food photo). */
  useLogos(teams: TeamLogo[]): void {
    this.logos = teams;
  }

  private logoFor(label: string): string | undefined {
    const text = ` ${label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
    let best: { logo: string; len: number } | undefined;
    for (const team of this.logos) {
      for (const name of team.names) {
        const n = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (text.includes(` ${n} `) && (!best || n.length > best.len)) best = { logo: team.logo, len: n.length };
      }
    }
    if (best) this.onCredit({ src: best.logo, link: 'https://www.espn.com/', credit: 'espn.com', license: 'source' });
    return best?.logo;
  }

  private withLogos(node: CardNode): CardNode {
    switch (node.type) {
      case 'tile':
      case 'profile': {
        const logo = this.logoFor(node.type === 'tile' ? `${node.imageQuery ?? ''} ${node.label}` : node.name);
        return { ...node, imageRef: undefined, imageQuery: undefined, imageSrc: logo };
      }
      case 'list':
        return { ...node, items: node.items.map((item) => ({ ...item, imageRef: undefined, imageQuery: undefined, imageSrc: item.imageQuery || item.imageRef !== undefined ? this.logoFor(`${item.imageQuery ?? ''} ${itemEntity(item.text)}`) : undefined })) };
      case 'stack':
      case 'grid':
      case 'section':
      case 'scroller':
        return { ...node, children: node.children.map((child) => this.withLogos(child)) } as CardNode;
      case 'tabs':
        return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => this.withLogos(child)) })) };
      default:
        return this.vet(node);
    }
  }

  /** Emits `node` now and, if it asked for pictures, again once they are found. */
  emit(node: CardNode, index: number, emit: Emit): void {
    if (this.logos.length) {
      if (!this.closed) emit(this.withLogos(node), index);
      return;
    }
    this.collect(node);
    const vetted = this.vet(node);
    const track = (n: CardNode) => {
      if (this.closed) return;
      if (this.rows) this.latest.set(index, { node: n, emit });
      emit(n, index);
    };
    track(vetted);
    // Start the card's one picture search early so it is ready when the card completes.
    if (this.rows?.cardImages && hasBlankPictures(vetted, this.ctx, this.subject)) void this.rows.cardImages();
    if (PictureResolver.needs(vetted)) {
      this.pending.push(
        this.resolve(vetted)
          .then((patched) => track(patched))
          .catch((err) => console.error('picture lookup failed', err)),
      );
      return;
    }
    // A ranked list names each product and leaves the picture blank. Looking them up only after the
    // card is written misses the short wait before done, so the row is still empty (running shoes).
    if (this.rows && hasBlankPictures(vetted, this.ctx, this.subject)) this.startRowFill(vetted, track);
  }

  /** Fills one node's blank rows. Queued so later nodes see pictures the earlier ones already took. */
  private startRowFill(node: CardNode, track: (n: CardNode) => void): void {
    this.rowFillStarted = true;
    const job = this.fillQueue.then(async () => {
      const patched = await this.fillNode(node);
      if (patched) track(patched);
    }).catch((err) => console.error('row pictures failed', err));
    this.fillQueue = job;
    this.pending.push(job);
  }

  private async fillNode(node: CardNode): Promise<CardNode | undefined> {
    if (!this.rows) return undefined;
    const filled = await fillRowImages([node], { lookup: (entity) => this.find(entity, this.env, 3, false), ...this.rows, pool: this.pool, onCredit: this.onCredit, query: this.subject }, this.used);
    this.rowStats.imageCalls = Math.max(this.rowStats.imageCalls, filled.imageCalls);
    this.rowStats.og += filled.og;
    if (filled.changed[0]) this.rowStats.filled += 1;
    return filled.changed[0] ? filled.nodes[0] : undefined;
  }

  /**
   * Waits for outstanding lookups and row pictures, so the card is complete before it is marked done.
   * Product rows already started while the rest of the card was written; they keep going until they
   * finish or ROW_FILL_WAIT_MS, whichever is first. Other picture lookups stay on the short cap.
   */
  async flush(capMs = PICTURE_WAIT_MS): Promise<void> {
    const started = Date.now();
    const wait = this.rowFillStarted ? Math.max(capMs, ROW_FILL_WAIT_MS) : capMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<'cap'>((resolve) => {
      timer = setTimeout(() => resolve('cap'), wait);
    });
    const done = await Promise.race([this.flushAll().then(() => 'ok' as const), cap]);
    if (timer !== undefined) clearTimeout(timer);
    if (done === 'cap') {
      this.closed = true;
      console.log(JSON.stringify({ zo: 'pictures', capped: true, pending: this.pending.length, ms: Date.now() - started }));
    }
  }

  /** Outstanding lookups, then blank tiles and rows (T442). */
  private async flushAll(): Promise<void> {
    await Promise.allSettled(this.pending);
    if (!this.rows || !this.latest.size) return;
    try {
      const entries = [...this.latest.entries()];
      const filled = await fillRowImages(entries.map(([, e]) => e.node), { lookup: (entity) => this.find(entity, this.env, 3, false), ...this.rows, pool: this.pool, onCredit: this.onCredit, query: this.subject }, this.used);
      this.rowStats.imageCalls = Math.max(this.rowStats.imageCalls, filled.imageCalls);
      this.rowStats.og += filled.og;
      let count = this.rowStats.filled;
      entries.forEach(([index, e], i) => {
        if (!filled.changed[i] || this.closed) return;
        count += 1;
        e.emit(filled.nodes[i], index);
      });
      this.rows.onFilled?.({ imageCalls: this.rowStats.imageCalls, og: this.rowStats.og, filled: count });
    } catch (err) {
      console.error('row pictures failed', err);
    }
  }
}
