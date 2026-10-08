import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Minus, Play, Star, ThumbsDown, ThumbsUp, TrendingDown, TrendingUp } from 'lucide-react';
import { askQuestion, type AskRef, type Box } from '../../shared/askAbout';
import type { CardNode, Tone } from '../../shared/card';
import type { SearchResult } from '../../shared/types';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCard, useCredit } from './context';
import { Icon } from './Icon';
import { ICON_NAMES } from './iconNames';
import { RichText } from './RichText';

type Of<T extends CardNode['type']> = Extract<CardNode, { type: T }>;

/** Short labels render as plain text, so inline source markers are dropped from them. */
export const plain = (s: string) => s.replace(/\s*\[\d+\]/g, '').trim();

/** Mirrors server/verdict.ts polarity(): a short Yes/No/Mixed-style value is a verdict the server may revise in place. */
const isVerdict = (value: string | undefined) => !!value && value.trim().length <= 24 && /^(yes|true|no|false|mixed|unclear|depends|partly)\b/i.test(value.trim());

/** A label the server already clipped ("… each other —…") drops the dangling dash/comma before its ellipsis. */
const tidyClip = (s: string) => s.replace(/[\s—–,;:-]+…$/, '…');

/** True when a tile's group (grid, row stack, scroller) has a tile with a picture: every tile there keeps the picture slot. */
export const TilePictures = createContext(false);

/** Whether a tile brings its own picture, so its group's tiles all keep the picture slot. */
export const wantsPicture = (n: CardNode) => n.type === 'tile' && (!!n.imageSrc || n.imageRef !== undefined || !!n.imageQuery);

export const TONE_TEXT: Record<Tone, string> = {
  default: 'text-foreground',
  muted: 'text-muted-foreground',
  primary: 'text-brand',
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
};

const TONE_SURFACE: Record<Tone, string> = {
  default: 'bg-muted/50 border-border',
  muted: 'bg-muted/40 border-transparent',
  primary: 'bg-brand/8 border-brand/20',
  positive: 'bg-positive/8 border-positive/20',
  negative: 'bg-negative/8 border-negative/20',
  warning: 'bg-warning/10 border-warning/25',
};

/** Animates the leading number of a value (e.g. "41,798,407" or "23°") from zero on mount. */
function useCountUp(value: string, ms = 700): string {
  const match = value.match(/^(\D*)(\d[\d,]*(?:\.\d+)?)(.*)$/);
  const target = match ? Number(match[2].replace(/,/g, '')) : NaN;
  const [shown, setShown] = useState(Number.isFinite(target) ? 0 : target);
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / ms);
      setShown(target * (1 - (1 - t) ** 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  if (!match || !Number.isFinite(target)) return value;
  const decimals = match[2].split('.')[1]?.length ?? 0;
  const body = shown.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: match[2].includes(',') });
  return `${match[1]}${body}${match[3]}`;
}

export function Hero({ node }: { node: Of<'hero'> }) {
  const value = useCountUp(node.value);
  return (
    <div className="flex min-w-0 flex-col">
      {node.label && (
        // Max two lines; a verdict hero reserves both (text from the top) so an in-place revision (No -> Yes, longer label) never shifts anything.
        <span data-hero-label="" className={cn('zo-label flex', isVerdict(node.value) && 'min-h-[2lh] items-start')}>
          <span className="line-clamp-2 text-pretty [overflow-wrap:anywhere]">{tidyClip(plain(node.label))}</span>
        </span>
      )}
      <div className="flex items-start gap-3">
        <span className={cn('text-[52px] font-semibold leading-[0.95] tracking-[-0.045em] sm:text-[64px]', node.value.length > 8 && node.value.length <= 14 && 'text-[36px] leading-[1.05] tracking-[-0.035em] sm:text-[64px] sm:leading-[0.95] sm:tracking-[-0.045em]', node.value.length > 14 && 'text-[32px] leading-tight tracking-[-0.03em] sm:text-[40px]', TONE_TEXT[node.tone === 'primary' || !node.tone ? 'default' : node.tone])}>
          <span className="tabular-nums">{plain(value)}</span>
          {node.unit && <span className="ml-1 align-top text-xl font-normal tracking-[-0.02em] text-muted-foreground sm:text-2xl">{node.unit}</span>}
        </span>
        {node.icon && <Icon name={node.icon} className="mt-1 size-10 text-muted-foreground/60 sm:size-12" />}
      </div>
      {node.caption && <p className="mt-2.5 text-[14px] text-muted-foreground"><RichText text={node.caption} inline /></p>}
    </div>
  );
}

export function Heading({ node }: { node: Of<'heading'> }) {
  return (
    <div>
      {node.eyebrow && <div className="zo-label">{node.eyebrow}</div>}
      <div className={cn('font-semibold tracking-[-0.02em]', node.level === 1 ? 'text-[22px]' : node.level === 3 ? 'text-[15px]' : 'text-[17px]')}>{plain(node.text)}</div>
    </div>
  );
}

export function Text({ node }: { node: Of<'text'> }) {
  return (
    <div className={cn(node.size === 'lg' ? 'text-[16.5px] leading-[1.55] tracking-[-0.011em] sm:text-[17.5px]' : node.size === 'sm' ? 'text-[13px] leading-relaxed' : 'text-[15px] leading-[1.65]', node.tone ? TONE_TEXT[node.tone] : 'text-foreground/90')}>
      <RichText text={node.text} />
    </div>
  );
}

export function StatView({ node }: { node: Of<'stat'> }) {
  const { onItem, entity } = useCard();
  const Trend = node.trend === 'up' ? TrendingUp : node.trend === 'down' ? TrendingDown : Minus;
  const [img, onImgError] = useLoadable(httpsOnly(node.image));
  const label = plain(node.label);
  const value = node.value && plain(node.value);
  const box: Box = { kind: 'stat', label, value, unit: node.unit, entity };
  const ask = askQuestion(box);
  const ref: AskRef = { label, value: value && node.unit ? `${value}${node.unit === '%' ? node.unit : ` ${node.unit}`}` : value, entity };
  return (
    <div className="relative rounded-xl border bg-card p-3 transition-colors has-[>button:hover]:border-foreground/20 sm:p-4">
      <button type="button" aria-label={ask} onClick={() => onItem(ask, ref)} className={cn('absolute inset-0 rounded-[inherit] cursor-pointer', ITEM_FOCUS)} />
      <div className="pointer-events-none relative flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground"><Icon name={node.icon} className="size-3.5" />{node.label}</div>
          <div className="mt-1 flex items-baseline gap-1 sm:mt-1.5">
            <span className="text-[22px] font-semibold tabular-nums tracking-[-0.03em] sm:text-[26px]">{plain(node.value)}</span>
            {node.unit && <span className="text-sm text-muted-foreground">{node.unit}</span>}
          </div>
          {node.delta && (
            <div className={cn('mt-1 inline-flex items-center gap-1 text-xs', node.trend === 'up' ? 'text-positive' : node.trend === 'down' ? 'text-negative' : 'text-muted-foreground')}>
              <Trend className="size-3" />{node.delta}
            </div>
          )}
        </div>
        {img && (
          <span className="relative shrink-0">
            <img src={img} alt={plain(node.label)} loading="lazy" decoding="async" width={36} height={36} className="size-9 rounded-full bg-muted object-cover" onError={onImgError} />
            <PhotoCredit src={img} className="-bottom-2.5 left-1/2 -translate-x-1/2" />
          </span>
        )}
      </div>
    </div>
  );
}

/** The page a picture came from: its credit, else the pooled image or the search result that carries it. */
function usePictureLink(src: string | undefined): string | undefined {
  const { credits, images, results } = useCard();
  if (!src) return undefined;
  return credits[src]?.link ?? images.find((i) => i.thumb === src)?.url ?? results.find((r) => r.image === src)?.url;
}

/** Only https pictures may be shown; anything else (or a missing one) is dropped. */
const httpsOnly = (u?: string) => (u && /^https:\/\//i.test(u) ? u : undefined);

/** A picture found for the item, or one referenced from the search images. */
function usePicture(src: string | undefined, ref: number | undefined): string | undefined {
  const { images } = useCard();
  return httpsOnly(src ?? (ref !== undefined ? images[ref]?.thumb : undefined));
}

/** Drops a src that failed to load; a different src is tried again. */
function useLoadable(src: string | undefined): [string | undefined, () => void] {
  const [failed, setFailed] = useState<string | undefined>(undefined);
  return [src === failed ? undefined : src, () => setFailed(src)];
}

/** The search result a source number points at, if it exists. */
function useSource(n: number | undefined) {
  const { results } = useCard();
  return n ? results[n - 1] : undefined;
}

/** The thing an item is about: "**Golden Delicious** — holds shape" → "Golden Delicious". */
const subjectOf = (text: string) => plain(text).replace(/\*\*/g, '').split(/\s[—–-]\s|:\s/)[0].trim().slice(0, 80);

/** Container classes shared by tappable items: visible keyboard focus ring with the theme ring token. */
const ITEM_FOCUS = 'outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50';

/**
 * Round chip that opens an item's source in a new tab. 18px visual, 44×44 hit area via ::after.
 * It sits next to (never inside) the item's button, and stops propagation so it never sends a question.
 */
function SourceChip({ result: r, n, className }: { result: SearchResult; n: number; className?: string }) {
  const [iconFailed, setIconFailed] = useState(false);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <a
      href={r.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${r.title} — ${domainLabel(r.domain)}`}
      aria-label={`Open source: ${domainLabel(r.domain) || r.title}`}
      data-source-chip=""
      onClick={stop}
      onKeyDown={stop}
      onPointerDown={stop}
      className={cn('pointer-events-auto relative z-[1] inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border bg-background align-middle text-[10px] font-medium text-muted-foreground transition-colors after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[\'\'] hover:border-foreground/30 hover:text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', className)}
    >
      {iconFailed ? n : <img src={`https://icons.duckduckgo.com/ip3/${r.domain}.ico`} alt="" className="size-3 rounded-full" loading="lazy" onError={() => setIconFailed(true)} />}
    </a>
  );
}

const domainLabel = (d: string) => d.replace(/^(www|en|m)\./, '');

/** Hostname of a link the model wrote; malformed links give an empty string instead of throwing. */
function hostOf(url?: string): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

/**
 * Small "nba.com" link on a picture to the page it came from; nothing when the source page is unknown.
 * Never drafts a question.
 */
function PhotoCredit({ src, className }: { src: string | undefined; className?: string }) {
  const link = usePictureLink(src);
  const domain = domainLabel(hostOf(link));
  if (!link || !domain || !/^https?:\/\//i.test(link)) return null;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <a href={link} target="_blank" rel="noopener noreferrer" aria-label={`Image source: ${domain}`} data-photo-credit="" onClick={stop} onKeyDown={stop} onPointerDown={stop}
      className={cn("pointer-events-auto absolute z-[1] flex max-w-[calc(100%-8px)] rounded bg-black/55 px-1 py-px text-[9px] font-medium leading-tight text-white/90 outline-none after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-ring", className)}>
      <span className="truncate">{domain}</span>
    </a>
  );
}

/** Video id and embeddable player for YouTube and Vimeo watch pages; undefined for channels and other pages. */
export function videoEmbed(url: string): { id: string; player: string; thumb?: string } | undefined {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, '');
    const yt = host === 'youtu.be' ? u.pathname.slice(1) : host.endsWith('youtube.com') ? (u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1]) : undefined;
    if (yt && /^[\w-]{11}$/.test(yt)) return { id: yt, player: `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0`, thumb: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` };
    const vimeo = host === 'vimeo.com' ? u.pathname.match(/^\/(\d+)/)?.[1] : undefined;
    if (vimeo) return { id: vimeo, player: `https://player.vimeo.com/video/${vimeo}?autoplay=1` };
  } catch {
    // not a URL
  }
  return undefined;
}

export function VideoView({ node }: { node: Of<'video'> }) {
  const r = useSource(node.source);
  const [playing, setPlaying] = useState(false);
  if (!r) return null;
  const embed = videoEmbed(r.url);
  const thumb = embed?.thumb ?? r.image;
  return (
    <figure className="space-y-2">
      <div className="relative aspect-video overflow-hidden rounded-xl border bg-muted">
        {playing && embed ? (
          <iframe src={embed.player} title={r.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen className="absolute inset-0 size-full" />
        ) : (
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (!embed) return;
              e.preventDefault();
              setPlaying(true);
            }}
            className="group absolute inset-0 flex items-center justify-center"
            aria-label={`Play ${r.title}`}
          >
            {thumb && <img src={thumb} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />}
            <span className="relative flex size-14 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-transform group-hover:scale-105">
              <Play className="ml-0.5 size-6 fill-current" />
            </span>
          </a>
        )}
      </div>
      <figcaption className="flex items-start gap-2 text-sm">
        <img src={`https://icons.duckduckgo.com/ip3/${r.domain}.ico`} alt="" className="mt-0.5 size-4 shrink-0 rounded-sm" />
        <span className="min-w-0 flex-1">
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium leading-snug hover:underline">{node.caption ?? r.title}</a>
          <span className="block text-xs text-muted-foreground">{domainLabel(r.domain)}{r.date ? ` · ${r.date.slice(0, 10)}` : ''}</span>
        </span>
      </figcaption>
    </figure>
  );
}

export function Links({ node }: { node: Of<'links'> }) {
  const { onItem, entity, results } = useCard();
  const items = node.items.flatMap((i) => (results[i.source - 1] ? [{ ...i, r: results[i.source - 1] }] : []));
  if (!items.length) return null;
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {items.map(({ source, r, label, note }) => {
        const video = !!videoEmbed(r.url);
        const box: Box = { kind: 'link', label: label ?? r.title, entity };
        const ask = askQuestion(box);
        const ref: AskRef = { label: subjectOf(label ?? r.title), entity, sourceUrl: r.url, snippet: r.snippet };
        return (
          <li key={r.url} className="relative">
            <button type="button" aria-label={ask} onClick={() => onItem(ask, ref)} className={cn('absolute inset-0 cursor-pointer transition-colors hover:bg-foreground/[0.03] [li:first-child>&]:rounded-t-xl [li:last-child>&]:rounded-b-xl', ITEM_FOCUS)} />
            <div className="pointer-events-none relative flex w-full items-center gap-3 p-2.5 text-left sm:p-3">
              <span className="relative flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
                <img src={`https://icons.duckduckgo.com/ip3/${r.domain}.ico`} alt="" className="size-[18px] rounded-sm" loading="lazy" />
                {video && <Play className="absolute -bottom-1 -right-1 size-3.5 rounded-full bg-foreground fill-background p-0.5 text-background" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium leading-snug">{label ?? r.title} <SourceChip result={r} n={source} className="-my-[3px]" /></span>
                <span className="block text-xs leading-snug text-muted-foreground">{note ? `${note} · ` : ''}{domainLabel(r.domain)}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const KNOWN_ICONS = new Set(ICON_NAMES.split('|'));

/** Type icon for a tile without a picture: the server's icon when it is a real one, else one from the label, else none. */
const TILE_KINDS: [RegExp, string][] = [
  [/\b(role|job|title|position|occupation|profession)\b/i, 'briefcase'],
  [/\b(location|city|hometown|home ?town|based|lives|born|birthplace|country|region|address)\b/i, 'map-pin'],
  [/\b(education|school|college|university|degree|alma mater|studied)\b/i, 'graduation-cap'],
  [/\b(company|employer|team|org|organi[sz]ation|club|firm|works? at)\b/i, 'building-2'],
];

function tileIcon(node: Of<'tile'>): string | undefined {
  if (node.icon && KNOWN_ICONS.has(node.icon)) return node.icon;
  const label = plain(node.label);
  return TILE_KINDS.find(([re]) => re.test(label))?.[1];
}

/** Kind of a tile from its label (or, failing that, the server's icon). Role and location tiles never show a photo, even if one is sent. */
function tileKind(node: Of<'tile'>): 'role' | 'location' | 'education' | 'company' | undefined {
  const label = plain(node.label);
  if (TILE_KINDS[0][0].test(label) || /^briefcase/.test(node.icon ?? '')) return 'role';
  if (TILE_KINDS[1][0].test(label) || /^map-pin|^map$/.test(node.icon ?? '')) return 'location';
  if (TILE_KINDS[2][0].test(label) || /^graduation-cap|^school|^university/.test(node.icon ?? '')) return 'education';
  if (TILE_KINDS[3][0].test(label) || /^building/.test(node.icon ?? '')) return 'company';
  return undefined;
}

const NO_PHOTO = new Set(['role', 'location']);

export function Tile({ node }: { node: Of<'tile'> }) {
  const { onItem, entity, busy } = useCard();
  const want = useContext(TilePictures) || wantsPicture(node);
  const slotRef = useRef(false);
  if (want) slotRef.current = true;
  const slot = slotRef.current;
  const icon = tileIcon(node);
  const kind = tileKind(node);
  const noPhoto = !!kind && NO_PHOTO.has(kind);
  const [img, onImgError] = useLoadable(usePicture(noPhoto ? undefined : node.imageSrc, noPhoto ? undefined : node.imageRef));
  const pending = !noPhoto && !img && !!node.imageQuery && busy;
  const link = useSource(node.source);
  const label = plain(node.label);
  const value = node.value && plain(node.value);
  const box: Box = { kind: isVerdict(value) ? 'verdict' : 'tile', label, value, entity };
  const ask = askQuestion(box);
  const ref: AskRef = { label, value, entity, sourceUrl: link?.url, snippet: link?.snippet };
  return (
    <div
      data-item=""
      data-tile-kind={kind}
      className={cn(
        'relative flex min-w-[72px] flex-col items-center gap-0.5 rounded-xl border px-2 py-2.5 text-center transition-colors has-[>button:hover]:border-foreground/20 sm:min-w-[84px] sm:gap-1 sm:px-3 sm:py-3',
        node.active ? 'border-foreground/25 bg-muted ring-1 ring-foreground/10' : 'bg-card',
      )}
    >
      <button type="button" aria-label={ask} onClick={() => onItem(ask, ref)} className={cn('absolute inset-0 rounded-[inherit] cursor-pointer', ITEM_FOCUS)} />
      {slot && (
        <span data-picture-slot="" className="pointer-events-none relative mb-1 flex aspect-square w-full max-w-24 items-center justify-center rounded-lg bg-muted">
          {pending ? <Skeleton className="absolute inset-0 rounded-lg" /> : <Icon name={icon} fallback="layout-grid" className="size-7 text-muted-foreground/70 sm:size-8" />}
          {img && <img src={img} alt={plain(node.label)} loading="lazy" className="absolute inset-0 size-full rounded-[inherit] object-cover animate-in fade-in" onError={onImgError} />}
          {img && <PhotoCredit src={img} className="right-1 top-1" />}
        </span>
      )}
      <span
        className={cn(
          'pointer-events-none relative flex max-w-full min-w-0 justify-center gap-1 text-[11px] font-medium text-muted-foreground',
          isVerdict(node.value) ? 'min-h-[2lh] items-start' : 'items-center',
        )}
      >
        <span className="line-clamp-2 min-w-0 text-pretty [overflow-wrap:anywhere]">{plain(node.label)}</span>
        {link && <span className="-my-[3px] shrink-0"><SourceChip result={link} n={node.source!} /></span>}
      </span>
      {!slot && !img && !pending && <Icon name={icon} className="pointer-events-none relative size-[18px] text-foreground/70 sm:size-5" />}
      {node.value && <span className="pointer-events-none relative text-[15px] font-semibold tracking-tight sm:text-base">{plain(node.value)}</span>}
      {node.sub && <span className="pointer-events-none relative text-[11px] leading-tight text-muted-foreground"><RichText text={node.sub} inline noLinks /></span>}
    </div>
  );
}

export function KeyValue({ node }: { node: Of<'keyvalue'> }) {
  return (
    <dl className="@container divide-y rounded-xl border bg-card">
      {node.items.map((i) => (
        // Side by side when there is room; label above value in narrow spots so neither gets squeezed.
        <div key={i.label} className="flex flex-col gap-0.5 px-3 py-2 text-sm @xs:flex-row @xs:items-center @xs:justify-between @xs:gap-3 sm:px-4 sm:py-2.5">
          <dt className="flex shrink-0 items-center gap-2 text-muted-foreground @xs:max-w-[45%]"><Icon name={i.icon} className="size-3.5 shrink-0" />{i.label}</dt>
          <dd className="min-w-0 font-medium @xs:text-right"><RichText text={i.value} inline /></dd>
        </div>
      ))}
    </dl>
  );
}

function MediaThumb({ item, index }: { item: Of<'list'>['items'][number]; index: number }) {
  const { busy } = useCard();
  const [img, onImgError] = useLoadable(usePicture(item.imageSrc, item.imageRef));
  if (img) {
    return (
      <span className="relative size-12 shrink-0 sm:size-14">
        <img src={img} alt={subjectOf(item.text)} loading="lazy" className="size-12 shrink-0 rounded-lg bg-muted object-cover animate-in fade-in sm:size-14" onError={onImgError} />
        <PhotoCredit src={img} className="bottom-0.5 left-1/2 -translate-x-1/2 after:h-6 after:w-[calc(100%+8px)]" />
      </span>
    );
  }
  if (item.imageQuery && busy) return <Skeleton className="size-12 shrink-0 rounded-lg sm:size-14" />;
  return (
    <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground sm:size-14">
      {item.icon ? <Icon name={item.icon} className="size-5" /> : index + 1}
    </span>
  );
}

function MediaRow({ item, index }: { item: Of<'list'>['items'][number]; index: number }) {
  const r = useSource(item.source);
  const { onItem, entity } = useCard();
  const box: Box = { kind: 'row', label: plain(item.text), detail: item.meta, entity };
  const ask = askQuestion(box);
  const ref: AskRef = { label: subjectOf(item.text), value: item.meta, entity, sourceUrl: r?.url, snippet: r?.snippet };
  return (
    <li className="relative">
      <button type="button" aria-label={ask} onClick={() => onItem(ask, ref)} className={cn('absolute inset-0 cursor-pointer transition-colors hover:bg-foreground/[0.03] [li:first-child>&]:rounded-t-xl [li:last-child>&]:rounded-b-xl', ITEM_FOCUS)} />
      <div className="pointer-events-none relative flex w-full items-center gap-3 p-2.5 text-left sm:p-3">
        <MediaThumb item={item} index={index} />
        <span className="flex min-w-0 flex-1 flex-col items-start gap-1 text-sm leading-snug">
          <span className="min-w-0"><RichText text={item.text} inline noLinks />{r && <>{' '}<SourceChip result={r} n={item.source!} className="-my-[3px]" /></>}</span>
          {item.meta && <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium leading-snug tabular-nums sm:hidden">{item.meta}</span>}
        </span>
        {item.meta && <span className="hidden max-w-[40%] shrink-0 rounded-md bg-muted px-2 py-0.5 text-right text-xs font-medium leading-snug tabular-nums sm:inline">{item.meta}</span>}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </div>
    </li>
  );
}

function MediaList({ node }: { node: Of<'list'> }) {
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {node.items.map((item, i) => (
        <MediaRow key={i} item={item} index={i} />
      ))}
    </ul>
  );
}

export function List({ node }: { node: Of<'list'> }) {
  const { results } = useCard();
  const style = node.style ?? 'bullet';
  if (style === 'media') return <MediaList node={node} />;
  return (
    <ul className="space-y-2 sm:space-y-2.5">
      {node.items.map((item, i) => {
        const r = item.source ? results[item.source - 1] : undefined;
        return (
          <li key={i} className="flex items-start gap-2 text-sm leading-relaxed sm:gap-3">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
              {style === 'number' ? <span className="text-xs font-semibold text-muted-foreground">{i + 1}</span>
                : style === 'check' ? <Check className="size-4 text-positive" />
                : style === 'icon' && item.icon ? <Icon name={item.icon} className="text-muted-foreground" />
                : <span className="size-1.5 rounded-full bg-foreground/40" />}
            </span>
            <span className="flex-1 text-foreground/85"><RichText text={item.text} /></span>
            {item.meta && <span className="shrink-0 text-xs text-muted-foreground">{item.meta}</span>}
            {/* Rows sit 8–10px apart, so the chip's tap area is clipped to stay clear of neighbours (list-row rule: ≥44w, ≥30h). */}
            {r && <span className="mt-[3px] flex shrink-0"><SourceChip result={r} n={item.source!} className="after:h-[30px]" /></span>}
          </li>
        );
      })}
    </ul>
  );
}

export function ProgressView({ node }: { node: Of<'progress'> }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm"><span>{node.label}</span><span className="font-medium tabular-nums">{Math.round(node.value)}%</span></div>
      <Progress value={node.value} className="h-2" />
      {node.caption && <p className="text-xs text-muted-foreground">{node.caption}</p>}
    </div>
  );
}

export function Rating({ node }: { node: Of<'rating'> }) {
  const scale = Math.max(node.max ?? 5, 1);
  if (scale > 10) {
    return (
      <div className="flex items-center gap-2.5">
        <span className="text-sm font-semibold tabular-nums">{node.value}<span className="font-normal text-muted-foreground">/{scale}</span></span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-warning" style={{ width: `${Math.min(100, (node.value / scale) * 100)}%` }} /></div>
        {node.label && <span className="text-xs text-muted-foreground">{plain(node.label)}</span>}
      </div>
    );
  }
  const max = scale;
  return (
    <div className="flex items-center gap-2">
      <div className="flex">
        {Array.from({ length: max }, (_, i) => (
          <Star key={i} className={cn('size-4', i < Math.round(node.value) ? 'fill-warning text-warning' : 'text-muted-foreground/30')} />
        ))}
      </div>
      <span className="text-sm font-medium tabular-nums">{node.value}</span>
      {node.label && <span className="text-xs text-muted-foreground">{node.label}</span>}
    </div>
  );
}

export function TableView({ node }: { node: Of<'table'> }) {
  const width = Math.max(node.columns.length, ...node.rows.map((r) => r.length));
  const columns = [...Array(width - node.columns.length).fill(''), ...node.columns];
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c, i) => <TableHead key={i} className={cn('h-9 text-xs font-semibold text-foreground', node.highlight === i && 'bg-muted/60')}>{c}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {node.rows.map((r, ri) => (
            <TableRow key={ri}>
              {r.map((cell, ci) => <TableCell key={ci} className={cn('whitespace-normal px-2 py-2 text-[13px] align-top sm:px-3 sm:py-2.5 sm:text-sm', ci === 0 && 'font-medium text-muted-foreground', node.highlight === ci && 'bg-muted/60')}>
                <RichText text={cell} inline />
              </TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function Timeline({ node }: { node: Of<'timeline'> }) {
  const { results } = useCard();
  return (
    <ol className="relative space-y-4 pl-6 before:absolute before:inset-y-1.5 before:left-[5px] before:w-px before:bg-border">
      {node.items.map((t, i) => {
        const r = t.source ? results[t.source - 1] : undefined;
        return (
          <li key={i} className="relative flex gap-2">
            <span className="absolute -left-6 top-1 size-[11px] rounded-full border-2 border-background bg-foreground ring-1 ring-border" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold tabular-nums text-muted-foreground">{t.when}</div>
              <div className="text-sm font-medium"><RichText text={t.title} inline /></div>
              {t.text && <div className="mt-0.5 text-sm text-muted-foreground"><RichText text={t.text} inline /></div>}
            </div>
            {r && <span className="mt-0.5 flex shrink-0"><SourceChip result={r} n={t.source!} /></span>}
          </li>
        );
      })}
    </ol>
  );
}

export function Steps({ node }: { node: Of<'steps'> }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setDone((d) => {
    const next = new Set(d);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });
  return (
    <ol className="space-y-1">
      {node.items.map((s, i) => (
        <li key={i}>
          <button onClick={() => toggle(i)} className="flex w-full items-start gap-2.5 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-muted/60 sm:gap-3 sm:p-2">
            <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors', done.has(i) ? 'border-positive bg-positive text-white' : 'bg-card')}>
              {done.has(i) ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn('min-w-0 transition-opacity', done.has(i) && 'opacity-50')}>
              <span className={cn('block text-sm font-medium', done.has(i) && 'line-through')}>{s.title}</span>
              {s.detail && <span className="block text-sm text-muted-foreground"><RichText text={s.detail} inline noLinks /></span>}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function ProsCons({ node }: { node: Of<'proscons'> }) {
  const column = (items: string[], positive: boolean) => (
    <div className={cn('rounded-xl border p-3 sm:p-4', positive ? TONE_SURFACE.positive : TONE_SURFACE.negative)}>
      <div className={cn('mb-2 flex items-center gap-1.5 text-[12.5px] font-medium', positive ? 'text-positive' : 'text-negative')}>
        {positive ? <ThumbsUp className="size-3.5" /> : <ThumbsDown className="size-3.5" />}{positive ? 'Pros' : 'Cons'}
      </div>
      <ul className="space-y-1.5 text-sm">{items.map((p, i) => <li key={i} className="leading-snug"><RichText text={p} inline /></li>)}</ul>
    </div>
  );
  return <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">{node.pros.length > 0 && column(node.pros, true)}{node.cons.length > 0 && column(node.cons, false)}</div>;
}

export function Badges({ node }: { node: Of<'badges'> }) {
  return <div className="flex flex-wrap gap-1.5">{node.items.map((b) => <Badge key={b} variant="secondary" className="font-normal">{plain(b)}</Badge>)}</div>;
}

export function Quote({ node }: { node: Of<'quote'> }) {
  return (
    <blockquote className="border-l-2 border-foreground/20 pl-4">
      <p className="text-base italic leading-relaxed">“{node.text}”</p>
      {node.source && <footer className="mt-1 text-xs text-muted-foreground">— {node.source}</footer>}
    </blockquote>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

/** Something the person asked to have written: shown as a ready-to-use document. */
export function Draft({ node }: { node: Of<'draft'> }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-background/60">
      <div className="flex h-10 items-center gap-2 border-b pl-3.5 pr-1.5">
        <span className="zo-label min-w-0 flex-1 truncate">{node.label ?? 'Draft'}</span>
        <CopyButton text={node.text} />
      </div>
      <div className="whitespace-pre-wrap px-3.5 py-3 text-[15px] leading-[1.65] text-foreground/90 sm:px-4 sm:py-3.5">{node.text}</div>
    </div>
  );
}

export function CodeView({ node }: { node: Of<'code'> }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-muted/40">
      <div className="flex h-9 items-center gap-2 border-b pl-3.5 pr-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground">{node.lang ?? 'code'}</span>
        <CopyButton text={node.code} />
      </div>
      <pre className="no-scrollbar overflow-x-auto overscroll-x-contain px-3.5 py-3 font-mono text-[12.5px] leading-relaxed sm:text-[13px]"><code>{node.code}</code></pre>
    </div>
  );
}

export function Callout({ node }: { node: Of<'callout'> }) {
  const tone = node.tone ?? 'default';
  return (
    <div className={cn('flex gap-2.5 rounded-xl border p-3 sm:gap-3 sm:p-4', TONE_SURFACE[tone])}>
      {node.icon && <Icon name={node.icon} className={cn('mt-0.5', TONE_TEXT[tone])} />}
      <div className="min-w-0 text-sm">
        {node.title && <div className="font-medium">{node.title}</div>}
        <div className="text-foreground/80"><RichText text={node.text} /></div>
      </div>
    </div>
  );
}

export function ImageView({ node }: { node: Of<'image'> }) {
  const { images, busy } = useCard();
  const ref = node.ref !== undefined ? images[node.ref] : undefined;
  const src = node.src ?? ref?.thumb;
  const link = usePictureLink(src);
  const credit = useCredit(src) ?? domainLabel(hostOf(node.link ?? link));
  const aspect = node.aspect === 'square' ? 'aspect-square' : node.aspect === 'tall' ? 'aspect-[3/4]' : 'aspect-video';
  if (!src) return node.query && busy ? <Skeleton className={cn('w-full rounded-xl', aspect)} /> : null;
  return (
    <figure className="overflow-hidden rounded-xl border bg-muted animate-in fade-in">
      <img src={src} alt={node.caption ?? ref?.title ?? ''} loading="lazy" className={cn('w-full object-cover', node.aspect === 'square' ? 'aspect-square' : node.aspect === 'tall' ? 'aspect-[3/4]' : 'aspect-video')} />
      {(node.caption || credit) && (
        <figcaption className="flex items-baseline gap-3 px-3 py-2 text-xs text-muted-foreground">
          {node.caption && <span className="min-w-0 flex-1">{node.caption}</span>}
          {credit && <a href={node.link ?? ref?.url ?? link} target="_blank" rel="noopener noreferrer" className="ml-auto max-w-[60%] shrink-0 truncate text-[11px] opacity-70 hover:opacity-100">{credit}</a>}
        </figcaption>
      )}
    </figure>
  );
}

export function Gallery({ node }: { node: Of<'gallery'> }) {
  const { images, busy } = useCard();
  const items = node.pics?.length
    ? node.pics.map((p) => ({ thumb: p.src, url: p.link, title: p.title, source: hostOf(p.link) }))
    : node.refs.map((r) => images[r]).filter(Boolean);
  const { credits } = useCard();
  const [open, setOpen] = useState<number | null>(null);
  const current = open === null ? undefined : items[open];
  if (!items.length) return node.query && busy ? <div className="grid grid-cols-3 gap-1.5">{[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}</div> : null;
  return (
    <>
      <div className={cn('grid gap-1.5', items.length >= 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {items.slice(0, 6).map((img, i) => (
          <button key={img.thumb} onClick={() => setOpen(i)} aria-label={img.title || `Open image ${i + 1}`} className={cn('overflow-hidden rounded-lg bg-muted', i === 0 && items.length >= 5 ? 'col-span-2 row-span-2 aspect-square' : 'aspect-square')}>
            <img src={img.thumb} alt={img.title} loading="lazy" className="size-full object-cover transition-transform duration-300 hover:scale-105" onError={(e) => ((e.target as HTMLElement).parentElement!.style.display = 'none')} />
          </button>
        ))}
      </div>
      <Dialog open={!!current} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-3xl gap-3 p-3">
          <DialogTitle className="truncate px-1 text-sm font-medium">{current?.title || current?.source}</DialogTitle>
          {current && <img src={current.thumb} alt={current.title} className="max-h-[70vh] w-full rounded-lg object-contain" />}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" aria-label="Previous image" onClick={() => setOpen(((open ?? 0) - 1 + items.length) % items.length)}><ChevronLeft /></Button>
            <a href={current?.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground">{(current && credits[current.thumb]?.credit) ?? current?.source} ↗</a>
            <Button variant="ghost" size="icon" aria-label="Next image" onClick={() => setOpen(((open ?? 0) + 1) % items.length)}><ChevronRight /></Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Profile({ node }: { node: Of<'profile'> }) {
  const { onItem } = useCard();
  const img = usePicture(node.imageSrc, node.imageRef);
  const box: Box = { kind: 'profile', label: node.name, value: node.subtitle, entity: node.name };
  const nameAsk = askQuestion(box);
  const nameRef: AskRef = { label: node.name, value: node.subtitle, entity: node.name };
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <span className="relative shrink-0">
        <Avatar className="size-16 rounded-2xl border sm:size-20">
          {img && <AvatarImage src={img} alt={node.name} className="object-cover" />}
          <AvatarFallback className="rounded-2xl text-xl">{node.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        {img && <PhotoCredit src={img} className="bottom-1 left-1/2 -translate-x-1/2" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="relative">
          <button type="button" aria-label={nameAsk} onClick={() => onItem(nameAsk, nameRef)} className={cn('absolute inset-0 rounded-[inherit] cursor-pointer', ITEM_FOCUS)} />
          <div className="pointer-events-none relative">
            <div className="text-xl font-semibold tracking-tight">{node.name}</div>
            {node.subtitle && <div className="text-sm text-muted-foreground">{node.subtitle}</div>}
          </div>
        </div>
        {node.facts && node.facts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {node.facts.map((f) => {
              const fact: Box = { kind: 'fact', label: f.label, value: f.value, entity: node.name };
              const ask = askQuestion(fact);
              const ref: AskRef = { label: f.label, value: f.value, entity: node.name };
              return (
                <span key={f.label} className="relative">
                  <button type="button" aria-label={ask} onClick={() => onItem(ask, ref)} className={cn('absolute inset-0 rounded-[inherit] cursor-pointer', ITEM_FOCUS)} />
                  <span className="pointer-events-none relative"><span className="text-muted-foreground">{f.label}</span> <span className="font-medium">{f.value}</span></span>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function Actions({ node }: { node: Of<'actions'> }) {
  const { onSearch, onAsk, onRefine } = useCard();
  const run = (a: Of<'actions'>['items'][number]) => {
    switch (a.kind ?? 'search') {
      case 'refine': return onRefine(a.query);
      case 'ask': return onAsk(a.query);
      case 'search': return onSearch(a.query);
      default: {
        const unreachable: never = a.kind as never;
        return unreachable;
      }
    }
  };
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-3">
      {node.items.map((a) => (
        <Button key={a.label} variant={a.kind === 'refine' ? 'secondary' : 'outline'} size="sm" className="relative rounded-full after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-['']" onClick={() => run(a)}>
          <Icon name={a.icon} fallback={a.kind === 'refine' ? 'wand-sparkles' : a.kind === 'ask' ? 'message-circle' : 'search'} className="size-3.5" />{a.label}
        </Button>
      ))}
    </div>
  );
}

export function SlotView({ node }: { node: Of<'slot'> }) {
  switch (node.shape) {
    case 'hero':
      return <div className="space-y-3"><Skeleton className="h-3 w-24" /><Skeleton className="h-14 w-40" /><Skeleton className="h-3 w-56" /></div>;
    case 'tile':
      return <Skeleton className="h-24 min-w-[84px] flex-1 rounded-xl" />;
    case 'chart':
      return <Skeleton className="h-48 w-full rounded-xl" />;
    case 'row':
      return <div className="flex items-center gap-3"><Skeleton className="size-14 shrink-0 rounded-xl" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-3/4" /></div></div>;
    case 'block':
      return <div className="space-y-2.5"><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-[92%]" /><Skeleton className="h-3.5 w-[78%]" /></div>;
    case 'line':
    case undefined:
      return <Skeleton className="h-4 w-3/4" />;
    default: {
      const unreachable: never = node.shape;
      return unreachable;
    }
  }
}
