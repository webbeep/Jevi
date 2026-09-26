import { useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Hash,
  Layers,
  ListChecks,
  MessageSquare,
  Pin,
  Quote,
  Scale,
  Sparkles,
  Star,
  Table,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
} from 'lucide-react';
import type {
  Comparison,
  Discussion,
  ImageResult,
  KeyPoint,
  Knowledge,
  SearchResult,
  Stat,
  SummaryLength,
  TimelineItem,
} from '../shared/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { RichText } from './ui';

export function Favicon({ domain, className }: { domain: string; className?: string }) {
  return <img src={`https://icons.duckduckgo.com/ip3/${domain}.ico`} alt="" loading="lazy" className={cn('size-4 rounded-sm', className)} />;
}

export function timeAgo(date: string): string {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return date;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const ICONS = {
  answer: Quote, summary: Sparkles, knowledge: Star, stats: Hash, timeline: Clock,
  gallery: Layers, key_points: Pin, comparison: Scale, steps: ListChecks,
  pros_cons: ThumbsUp, discussion: MessageSquare, results: Table,
} as const;

export function BlockShell({ kind, title, extra, children, className }: {
  kind: keyof typeof ICONS;
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = ICONS[kind];
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {extra && <div className="ml-auto flex items-center gap-1.5">{extra}</div>}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function AnswerBlock({ answer }: { answer: KeyPoint & { confidence: number } }) {
  return (
    <Card className="border-primary/40 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
      <CardContent className="pt-5">
        <Badge variant="secondary" className="mb-2 text-[10px] uppercase tracking-wider">Quick answer</Badge>
        <p className="text-lg font-medium leading-snug">{answer.text}</p>
        {answer.url && (
          <a href={answer.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            {answer.domain && <Favicon domain={answer.domain} />} {answer.domain}
          </a>
        )}
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-primary/15">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(answer.confidence * 100)}%` }} />
        </div>
      </CardContent>
    </Card>
  );
}

export function SummaryBlock(props: {
  text?: string; loading: boolean; length: SummaryLength; simple: boolean;
  results: SearchResult[]; onLength: (l: SummaryLength) => void; onSimple: (s: boolean) => void;
}) {
  const { text, loading, length, simple, results, onLength, onSimple } = props;
  return (
    <BlockShell
      kind="summary"
      title="Overview"
      extra={
        <>
          <div className="flex items-center rounded-full border bg-muted/40 p-0.5 text-[11px]">
            {(['short', 'medium', 'long'] as const).map((l) => (
              <button key={l} onClick={() => onLength(l)} className={cn('rounded-full px-2 py-0.5 font-medium', length === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{l === 'short' ? 'S' : l === 'medium' ? 'M' : 'L'}</button>
            ))}
          </div>
          <Button size="sm" variant={simple ? 'default' : 'outline'} className="h-6 px-2 text-[11px]" onClick={() => onSimple(!simple)}>🧸 Simple</Button>
        </>
      }
    >
      {loading || !text ? (
        <div className="space-y-2.5"><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-[95%]" /><Skeleton className="h-3.5 w-[80%]" /><Skeleton className="h-3.5 w-[88%]" /></div>
      ) : (
        <div className="prose-sm max-w-none text-sm leading-relaxed [&_p]:my-2 [&_strong]:font-semibold">
          <RichText text={text} results={results} />
        </div>
      )}
    </BlockShell>
  );
}

export function KnowledgeBlock({ k }: { k: Knowledge }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex gap-4 p-4">
        {k.image && <img src={k.image} alt={k.title} className="size-28 shrink-0 rounded-xl object-cover" />}
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{k.title}</h3>
        {k.description && <p className="text-xs text-muted-foreground">{k.description}</p>}
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{k.extract.length > 460 ? `${k.extract.slice(0, 460)}…` : k.extract}</p>
          <a href={k.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-medium text-primary hover:underline">Read more →</a>
        </div>
      </div>
    </Card>
  );
}

export function StatsBlock({ stats, fresh }: { stats: Stat[]; fresh?: string }) {
  return (
    <BlockShell kind="stats" title="By the numbers">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {stats.map((s) => (
          <a key={s.value + s.label} href={s.url} target="_blank" rel="noreferrer" className={cn('rounded-xl border bg-muted/30 p-3 transition-colors hover:bg-muted/60', fresh === s.value && 'ring-2 ring-primary')}>
            <div className="text-xl font-bold text-primary">{s.value}</div>
            <div className="mt-1 text-xs leading-snug text-muted-foreground">{s.label}</div>
          </a>
        ))}
      </div>
    </BlockShell>
  );
}

export function TimelineBlock({ items, fresh }: { items: TimelineItem[]; fresh?: string }) {
  return (
    <BlockShell kind="timeline" title="Timeline">
      <ol className="ml-1 space-y-3 border-l-2 border-border pl-5">
        {items.map((t) => (
          <li key={t.when + t.text} className={cn('relative', fresh === t.text && 'rounded-md bg-primary/10 -ml-2 pl-2 pr-2 -mr-2', fresh === t.text && 'ring-1 ring-primary/40')}>
            <span className="absolute -left-[27px] top-0.5 size-3 rounded-full border-2 border-background bg-primary" />
            <div className="text-xs font-bold text-primary">{t.when}</div>
            <div className="text-sm leading-snug">{t.text}{t.url && <a href={t.url} target="_blank" rel="noreferrer" className="ml-1 text-primary">↗</a>}</div>
          </li>
        ))}
      </ol>
    </BlockShell>
  );
}

export function GalleryBlock({ images }: { images: ImageResult[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const current = open === null ? undefined : images[open];
  return (
    <BlockShell kind="gallery" title="Pictures">
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {images.slice(0, 12).map((img, i) => (
          <button key={img.thumb} onClick={() => setOpen(i)} className="aspect-square overflow-hidden rounded-lg bg-muted">
            <img src={img.thumb} alt={img.title} loading="lazy" className="size-full object-cover transition-transform hover:scale-105" onError={(e) => ((e.target as HTMLElement).parentElement!.style.display = 'none')} />
          </button>
        ))}
      </div>
      <Dialog open={current !== undefined} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle className="truncate text-sm">{current?.title || current?.source}</DialogTitle></DialogHeader>
          {current && <img src={current.thumb} alt={current.title} className="mx-auto max-h-[70vh] rounded-lg" />}
          <div className="flex items-center justify-between">
            <Button variant="outline" size="icon" onClick={() => setOpen((open! - 1 + images.length) % images.length)}><ChevronLeft /></Button>
            <a href={current?.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Open source ↗</a>
            <Button variant="outline" size="icon" onClick={() => setOpen((open! + 1) % images.length)}><ChevronRight /></Button>
          </div>
        </DialogContent>
      </Dialog>
    </BlockShell>
  );
}

export function KeyPointsBlock({ points, fresh }: { points: KeyPoint[]; fresh?: string }) {
  return (
    <BlockShell kind="key_points" title="Key points">
      <ul className="space-y-1.5">
        {points.map((p) => (
          <li key={p.text} className={cn('flex items-start gap-2 rounded-lg p-2 text-sm leading-snug', fresh === p.text ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-muted/50')}>
            <Pin className="mt-0.5 size-3.5 shrink-0 text-primary/70" />
            <span className="flex-1">{p.text}</span>
            {p.domain && p.url && <a href={p.url} target="_blank" rel="noreferrer" className="shrink-0"><Favicon domain={p.domain} /></a>}
          </li>
        ))}
      </ul>
    </BlockShell>
  );
}

export function ComparisonBlock({ data, loading }: { data?: Comparison; loading: boolean }) {
  const [highlight, setHighlight] = useState<number | null>(null);
  if (loading || !data) {
    return <BlockShell kind="comparison" title="Side by side"><div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div></BlockShell>;
  }
  return (
    <BlockShell kind="comparison" title="Side by side">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th />
              {data.columns.map((c, i) => (
                <th key={c} onClick={() => setHighlight(highlight === i ? null : i)} className={cn('cursor-pointer p-2 text-left font-semibold text-primary', highlight === i && 'rounded-md bg-primary/10')}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.label} className="border-t border-border">
                <th className="p-2 text-left text-xs font-medium text-muted-foreground">{r.label}</th>
                {r.values.map((v, i) => <td key={i} className={cn('p-2 align-top', highlight === i && 'rounded-md bg-primary/10')}>{v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BlockShell>
  );
}

export function StepsBlock({ steps, loading }: { steps?: { title: string; detail: string }[]; loading: boolean }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setDone((d) => { const n = new Set(d); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  if (loading || !steps) {
    return <BlockShell kind="steps" title="Step by step"><div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div></BlockShell>;
  }
  return (
    <BlockShell kind="steps" title="Step by step" extra={<span className="text-xs text-muted-foreground">{done.size}/{steps.length}</span>}>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.title} onClick={() => toggle(i)} className={cn('flex cursor-pointer items-start gap-3 rounded-xl p-2.5 transition-colors hover:bg-muted/50', done.has(i) && 'opacity-50')}>
            <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold', done.has(i) ? 'bg-emerald-500 text-white' : 'bg-primary text-primary-foreground')}>
              {done.has(i) ? <Check className="size-4" /> : i + 1}
            </span>
            <div className="min-w-0">
              <div className={cn('text-sm font-medium', done.has(i) && 'line-through')}>{s.title}</div>
              <div className="text-xs text-muted-foreground">{s.detail}</div>
            </div>
          </li>
        ))}
      </ol>
    </BlockShell>
  );
}

export function ProsConsBlock({ pros, cons, loading }: { pros?: string[]; cons?: string[]; loading: boolean }) {
  if (loading || !pros) {
    return <BlockShell kind="pros_cons" title="Pros & cons"><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" /></div><div className="space-y-2"><Skeleton className="h-6 w-full" /><Skeleton className="h-6 w-full" /></div></div></BlockShell>;
  }
  return (
    <BlockShell kind="pros_cons" title="Pros & cons">
      <div className="grid gap-3 sm:grid-cols-2">
        <ul className="space-y-1.5 rounded-xl bg-emerald-500/10 p-3">
          {pros.map((p) => <li key={p} className="flex items-start gap-2 text-sm"><ThumbsUp className="mt-0.5 size-3.5 shrink-0 text-emerald-500" /><span>{p}</span></li>)}
        </ul>
        <ul className="space-y-1.5 rounded-xl bg-red-500/10 p-3">
          {(cons ?? []).map((c) => <li key={c} className="flex items-start gap-2 text-sm"><ThumbsDown className="mt-0.5 size-3.5 shrink-0 text-red-500" /><span>{c}</span></li>)}
        </ul>
      </div>
    </BlockShell>
  );
}

export function DiscussionBlock({ items }: { items: Discussion[] }) {
  const max = Math.max(...items.map((d) => d.points), 1);
  return (
    <BlockShell kind="discussion" title="People are discussing">
      <ul className="space-y-3">
        {items.map((d) => (
          <li key={d.url}>
            <a href={d.url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline">{d.title}</a>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"><div className="h-full bg-orange-500" style={{ width: `${(d.points / max) * 100}%` }} /></div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><TrendingUp className="size-3" /> {d.points} · {d.comments} comments · {timeAgo(d.date)}</div>
          </li>
        ))}
      </ul>
    </BlockShell>
  );
}

export function ResultsBlock({ results, onRead, onSearch }: {
  results: SearchResult[]; onRead: (r: SearchResult) => void; onSearch: (q: string) => void;
}) {
  const [site, setSite] = useState<string | null>(null);
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const domains = useMemo(() => {
    const counts = new Map<string, number>();
    results.forEach((r) => counts.set(r.domain, (counts.get(r.domain) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([d]) => d);
  }, [results]);
  const shown = site ? results.filter((r) => r.domain === site) : results;
  return (
    <BlockShell kind="results" title="Sources" extra={
      <div className="flex items-center rounded-full border bg-muted/40 p-0.5">
        <button onClick={() => setView('cards')} className={cn('rounded-full p-1', view === 'cards' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')} aria-label="Cards"><Layers className="size-3.5" /></button>
        <button onClick={() => setView('list')} className={cn('rounded-full p-1', view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')} aria-label="List"><Table className="size-3.5" /></button>
      </div>
    }>
      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex gap-1.5 pb-1">
          <Button size="sm" variant={site === null ? 'default' : 'outline'} className="h-7 rounded-full px-2.5 text-xs" onClick={() => setSite(null)}>All {results.length}</Button>
          {domains.map((d) => (
            <Button key={d} size="sm" variant={site === d ? 'default' : 'outline'} className="h-7 rounded-full px-2.5 text-xs" onClick={() => setSite(site === d ? null : d)}><Favicon domain={d} /> {d}</Button>
          ))}
        </div>
      </ScrollArea>
      <div className={cn('mt-3 grid gap-2.5', view === 'cards' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')}>
        {shown.map((r) => (
          <article key={r.url} className={cn('flex flex-col gap-1.5 rounded-xl border p-3 transition-colors hover:bg-muted/30', view === 'list' && 'border-0 border-b rounded-none pb-3')}>
            {view === 'cards' && r.image && <img src={r.image} alt="" loading="lazy" className="h-28 w-full rounded-lg object-cover" onError={(e) => ((e.target as HTMLElement).style.display = 'none')} />}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Favicon domain={r.domain} /> {r.domain}{r.date && <span>· {timeAgo(r.date)}</span>}
              {r.engines.length > 1 && <Badge variant="secondary" className="ml-auto text-[10px]">×{r.engines.length}</Badge>}
            </div>
            <a href={r.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary hover:underline line-clamp-2">{r.title}</a>
            <p className="text-xs leading-relaxed text-muted-foreground line-clamp-3">{r.snippet}</p>
            <div className="mt-auto flex gap-1.5 pt-1">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onRead(r)}>📖 Digest</Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onSearch(`site:${r.domain} `)}>🔎 More</Button>
            </div>
          </article>
        ))}
      </div>
    </BlockShell>
  );
}
