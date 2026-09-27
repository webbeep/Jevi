import { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Minus, Star, ThumbsDown, ThumbsUp, TrendingDown, TrendingUp } from 'lucide-react';
import type { CardNode, Tone } from '../../shared/card';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCard } from './context';
import { Icon } from './Icon';
import { RichText } from './RichText';

type Of<T extends CardNode['type']> = Extract<CardNode, { type: T }>;

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

export function Hero({ node }: { node: Of<'hero'> }) {
  return (
    <div className="flex min-w-0 flex-col">
      {node.label && <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{node.label}</span>}
      <div className="flex items-start gap-3">
        <span className={cn('text-5xl font-semibold leading-none tracking-tighter sm:text-6xl', node.value.length > 14 && 'text-3xl sm:text-4xl leading-tight tracking-tight', TONE_TEXT[node.tone ?? 'default'])}>
          {node.value}
          {node.unit && <span className="ml-1 align-top text-2xl font-normal text-muted-foreground">{node.unit}</span>}
        </span>
        {node.icon && <Icon name={node.icon} className="mt-1 size-10 text-muted-foreground/60 sm:size-12" />}
      </div>
      {node.caption && <p className="mt-2 text-sm text-muted-foreground"><RichText text={node.caption} inline /></p>}
    </div>
  );
}

export function Heading({ node }: { node: Of<'heading'> }) {
  return (
    <div>
      {node.eyebrow && <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{node.eyebrow}</div>}
      <div className={cn('font-semibold tracking-tight', node.level === 1 ? 'text-2xl' : node.level === 3 ? 'text-base' : 'text-lg')}>{node.text}</div>
    </div>
  );
}

export function Text({ node }: { node: Of<'text'> }) {
  return (
    <div className={cn('leading-relaxed', node.size === 'lg' ? 'text-base sm:text-lg' : node.size === 'sm' ? 'text-xs' : 'text-sm', node.tone ? TONE_TEXT[node.tone] : 'text-foreground/85')}>
      <RichText text={node.text} />
    </div>
  );
}

export function StatView({ node }: { node: Of<'stat'> }) {
  const Trend = node.trend === 'up' ? TrendingUp : node.trend === 'down' ? TrendingDown : Minus;
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon name={node.icon} className="size-3.5" />{node.label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tracking-tight">{node.value}</span>
        {node.unit && <span className="text-sm text-muted-foreground">{node.unit}</span>}
      </div>
      {node.delta && (
        <div className={cn('mt-1 inline-flex items-center gap-1 text-xs', node.trend === 'up' ? 'text-positive' : node.trend === 'down' ? 'text-negative' : 'text-muted-foreground')}>
          <Trend className="size-3" />{node.delta}
        </div>
      )}
    </div>
  );
}

export function Tile({ node }: { node: Of<'tile'> }) {
  const { onAsk } = useCard();
  return (
    <button
      onClick={() => onAsk(`Tell me more about ${node.label}${node.value ? ` (${node.value})` : ''}`)}
      className={cn(
        'flex min-w-[84px] flex-col items-center gap-1 rounded-xl border px-3 py-3 text-center transition-colors hover:border-foreground/20',
        node.active ? 'border-foreground/25 bg-muted ring-1 ring-foreground/10' : 'bg-card',
      )}
    >
      <span className="text-[11px] font-medium text-muted-foreground">{node.label}</span>
      <Icon name={node.icon} className="size-5 text-foreground/70" />
      {node.value && <span className="text-base font-semibold tracking-tight">{node.value}</span>}
      {node.sub && <span className="text-[11px] leading-tight text-muted-foreground"><RichText text={node.sub} inline /></span>}
    </button>
  );
}

export function KeyValue({ node }: { node: Of<'keyvalue'> }) {
  return (
    <dl className="divide-y rounded-xl border bg-card">
      {node.items.map((i) => (
        <div key={i.label} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
          <dt className="flex items-center gap-2 text-muted-foreground"><Icon name={i.icon} className="size-3.5" />{i.label}</dt>
          <dd className="text-right font-medium"><RichText text={i.value} inline /></dd>
        </div>
      ))}
    </dl>
  );
}

export function List({ node }: { node: Of<'list'> }) {
  const style = node.style ?? 'bullet';
  return (
    <ul className="space-y-2.5">
      {node.items.map((item, i) => (
        <li key={i} className="flex items-start gap-3 text-sm leading-relaxed">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
            {style === 'number' ? <span className="text-xs font-semibold text-muted-foreground">{i + 1}</span>
              : style === 'check' ? <Check className="size-4 text-positive" />
              : style === 'icon' && item.icon ? <Icon name={item.icon} className="text-muted-foreground" />
              : <span className="size-1.5 rounded-full bg-foreground/40" />}
          </span>
          <span className="flex-1 text-foreground/85"><RichText text={item.text} /></span>
          {item.meta && <span className="shrink-0 text-xs text-muted-foreground">{item.meta}</span>}
        </li>
      ))}
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
  const max = Math.min(Math.max(node.max ?? 5, 1), 10);
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
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {node.columns.map((c, i) => <TableHead key={i} className={cn('h-10 text-xs', node.highlight === i && 'bg-muted/60 text-foreground')}>{c}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {node.rows.map((r, ri) => (
            <TableRow key={ri}>
              {r.map((cell, ci) => <TableCell key={ci} className={cn('whitespace-normal py-2.5 text-sm align-top', ci === 0 && 'font-medium text-muted-foreground', node.highlight === ci && 'bg-muted/60')}>
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
  return (
    <ol className="relative space-y-4 pl-6 before:absolute before:inset-y-1.5 before:left-[5px] before:w-px before:bg-border">
      {node.items.map((t, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-6 top-1 size-[11px] rounded-full border-2 border-background bg-foreground ring-1 ring-border" />
          <div className="text-xs font-semibold tabular-nums text-muted-foreground">{t.when}</div>
          <div className="text-sm font-medium"><RichText text={t.title} inline /></div>
          {t.text && <div className="mt-0.5 text-sm text-muted-foreground"><RichText text={t.text} inline /></div>}
        </li>
      ))}
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
          <button onClick={() => toggle(i)} className="flex w-full items-start gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted/60">
            <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors', done.has(i) ? 'border-positive bg-positive text-white' : 'bg-card')}>
              {done.has(i) ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn('min-w-0 transition-opacity', done.has(i) && 'opacity-50')}>
              <span className={cn('block text-sm font-medium', done.has(i) && 'line-through')}>{s.title}</span>
              {s.detail && <span className="block text-sm text-muted-foreground"><RichText text={s.detail} inline /></span>}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function ProsCons({ node }: { node: Of<'proscons'> }) {
  const column = (items: string[], positive: boolean) => (
    <div className={cn('rounded-xl border p-4', positive ? TONE_SURFACE.positive : TONE_SURFACE.negative)}>
      <div className={cn('mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider', positive ? 'text-positive' : 'text-negative')}>
        {positive ? <ThumbsUp className="size-3.5" /> : <ThumbsDown className="size-3.5" />}{positive ? 'Pros' : 'Cons'}
      </div>
      <ul className="space-y-1.5 text-sm">{items.map((p, i) => <li key={i} className="leading-snug"><RichText text={p} inline /></li>)}</ul>
    </div>
  );
  return <div className="grid gap-3 sm:grid-cols-2">{node.pros.length > 0 && column(node.pros, true)}{node.cons.length > 0 && column(node.cons, false)}</div>;
}

export function Badges({ node }: { node: Of<'badges'> }) {
  return <div className="flex flex-wrap gap-1.5">{node.items.map((b) => <Badge key={b} variant="secondary" className="font-normal">{b}</Badge>)}</div>;
}

export function Quote({ node }: { node: Of<'quote'> }) {
  return (
    <blockquote className="border-l-2 border-foreground/20 pl-4">
      <p className="text-base italic leading-relaxed">“{node.text}”</p>
      {node.source && <footer className="mt-1 text-xs text-muted-foreground">— {node.source}</footer>}
    </blockquote>
  );
}

export function Callout({ node }: { node: Of<'callout'> }) {
  const tone = node.tone ?? 'default';
  return (
    <div className={cn('flex gap-3 rounded-xl border p-4', TONE_SURFACE[tone])}>
      {node.icon && <Icon name={node.icon} className={cn('mt-0.5', TONE_TEXT[tone])} />}
      <div className="min-w-0 text-sm">
        {node.title && <div className="font-medium">{node.title}</div>}
        <div className="text-foreground/80"><RichText text={node.text} /></div>
      </div>
    </div>
  );
}

export function ImageView({ node }: { node: Of<'image'> }) {
  const { images } = useCard();
  const img = images[node.ref];
  if (!img) return null;
  return (
    <figure className="overflow-hidden rounded-xl border bg-muted">
      <img src={img.thumb} alt={node.caption ?? img.title} loading="lazy" className={cn('w-full object-cover', node.aspect === 'square' ? 'aspect-square' : node.aspect === 'tall' ? 'aspect-[3/4]' : 'aspect-video')} />
      {node.caption && <figcaption className="px-3 py-2 text-xs text-muted-foreground">{node.caption}</figcaption>}
    </figure>
  );
}

export function Gallery({ node }: { node: Of<'gallery'> }) {
  const { images } = useCard();
  const items = node.refs.map((r) => images[r]).filter(Boolean);
  const [open, setOpen] = useState<number | null>(null);
  const current = open === null ? undefined : items[open];
  if (!items.length) return null;
  return (
    <>
      <div className={cn('grid gap-1.5', items.length >= 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {items.slice(0, 6).map((img, i) => (
          <button key={img.thumb} onClick={() => setOpen(i)} className={cn('overflow-hidden rounded-lg bg-muted', i === 0 && items.length >= 5 ? 'col-span-2 row-span-2 aspect-square' : 'aspect-square')}>
            <img src={img.thumb} alt={img.title} loading="lazy" className="size-full object-cover transition-transform duration-300 hover:scale-105" onError={(e) => ((e.target as HTMLElement).parentElement!.style.display = 'none')} />
          </button>
        ))}
      </div>
      <Dialog open={!!current} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-3xl gap-3 p-3">
          <DialogTitle className="truncate px-1 text-sm font-medium">{current?.title || current?.source}</DialogTitle>
          {current && <img src={current.thumb} alt={current.title} className="max-h-[70vh] w-full rounded-lg object-contain" />}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={() => setOpen(((open ?? 0) - 1 + items.length) % items.length)}><ChevronLeft /></Button>
            <a href={current?.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-foreground">{current?.source} ↗</a>
            <Button variant="ghost" size="icon" onClick={() => setOpen(((open ?? 0) + 1) % items.length)}><ChevronRight /></Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Profile({ node }: { node: Of<'profile'> }) {
  const { images } = useCard();
  const img = node.imageRef !== undefined ? images[node.imageRef] : undefined;
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <Avatar className="size-20 rounded-2xl border">
        {img && <AvatarImage src={img.thumb} alt={node.name} className="object-cover" />}
        <AvatarFallback className="rounded-2xl text-xl">{node.name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="text-xl font-semibold tracking-tight">{node.name}</div>
        {node.subtitle && <div className="text-sm text-muted-foreground">{node.subtitle}</div>}
        {node.facts && node.facts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {node.facts.map((f) => <span key={f.label}><span className="text-muted-foreground">{f.label}</span> <span className="font-medium">{f.value}</span></span>)}
          </div>
        )}
      </div>
    </div>
  );
}

export function Actions({ node }: { node: Of<'actions'> }) {
  const { onSearch, onAsk } = useCard();
  return (
    <div className="flex flex-wrap gap-2">
      {node.items.map((a) => (
        <Button key={a.label} variant="outline" size="sm" className="rounded-full" onClick={() => (a.kind === 'ask' ? onAsk(a.query) : onSearch(a.query))}>
          <Icon name={a.icon} className="size-3.5" />{a.label}
        </Button>
      ))}
    </div>
  );
}

export function Citations({ node }: { node: Of<'citations'> }) {
  const { results } = useCard();
  const items = node.refs.map((r) => ({ n: r, r: results[r - 1] })).filter((x) => x.r);
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-muted-foreground">Sources</span>
      {items.map(({ n, r }) => (
        <a key={n} href={r!.url} target="_blank" rel="noreferrer" title={r!.title} className="inline-flex items-center gap-1.5 rounded-full border bg-card py-0.5 pl-1 pr-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <img src={`https://icons.duckduckgo.com/ip3/${r!.domain}.ico`} alt="" className="size-4 rounded-full" />
          {r!.domain.replace(/^en\./, '')}
        </a>
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
