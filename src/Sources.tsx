import { useEffect, useState } from 'react';
import { ExternalLink, FileText, LayoutGrid, X } from 'lucide-react';
import type { EngineStatus, SearchResult } from '../shared/types';
import { api } from './api';
import type { LibraryEntry } from './library';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
export const favicon = (domain: string) => `https://icons.duckduckgo.com/ip3/${domain}.ico`;
const shortDomain = (d: string) => d.replace(/^(www|en|m)\./, '');

export type SourceFilter = 'cited' | 'all';

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() => matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const mq = matchMedia('(min-width: 768px)');
    const on = () => setDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return desktop;
}

/** Overlapping favicons of the first few sources. */
export function FaviconStack({ domains, size = 'sm' }: { domains: string[]; size?: 'sm' | 'md' }) {
  return (
    <span className="flex shrink-0 -space-x-1.5">
      {[...new Set(domains)].slice(0, 4).map((d) => (
        <img key={d} src={favicon(d)} alt="" loading="lazy" className={cn('rounded-full bg-background ring-2 ring-card', size === 'sm' ? 'size-4' : 'size-[18px]')} />
      ))}
    </span>
  );
}

export function Reader({ result, query, onClose, onDigest }: { result: SearchResult | null; query: string; onClose: () => void; onDigest: (r: SearchResult) => void }) {
  const desktop = useIsDesktop();
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setError(undefined);
    setText(result?.content);
    if (!result || result.content) return;
    let live = true;
    api.read(result.url, query, undefined, true)
      .then((page) => live && setText(page.text))
      .catch((err) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [result, query]);

  return (
    <Sheet open={!!result} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={desktop ? 'right' : 'bottom'} className={cn('gap-0 p-0', desktop ? 'w-full sm:max-w-lg' : 'h-[88dvh] rounded-t-2xl')}>
        {result && (
          <>
            <SheetHeader className="border-b p-4 pr-12">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <img src={favicon(result.domain)} alt="" className="size-4 rounded-sm" />
                {shortDomain(result.domain)}
              </div>
              <SheetTitle className="text-base leading-snug">{result.title}</SheetTitle>
              <SheetDescription className="sr-only">Readable text of this source</SheetDescription>
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="h-8 rounded-lg" onClick={() => { onDigest(result); onClose(); }}><LayoutGrid className="size-3.5" />Make it a card</Button>
                <Button size="sm" variant="outline" className="h-8 rounded-lg" asChild>
                  <a href={result.url} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" />Open site</a>
                </Button>
              </div>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {error ? (
                <p className="text-sm text-muted-foreground">{error}. <a className="underline" href={result.url} target="_blank" rel="noreferrer">Open the site</a> instead.</p>
              ) : !text ? (
                <div className="space-y-2.5">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-3.5" style={{ width: `${95 - (i % 3) * 12}%` }} />)}</div>
              ) : (
                <article className="space-y-3 text-[15px] leading-relaxed text-foreground/85">
                  {text.split('\n').filter((p) => p.trim()).map((p, i) => <p key={i}>{p}</p>)}
                </article>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FilterToggle({ value, onChange, cited, all }: { value: SourceFilter; onChange: (v: SourceFilter) => void; cited: number; all: number }) {
  return (
    <ToggleGroup type="single" size="sm" value={value} onValueChange={(v) => v && onChange(v as SourceFilter)} className="rounded-lg bg-foreground/[0.05] p-0.5">
      {(['cited', 'all'] as const).map((f) => (
        <ToggleGroupItem key={f} value={f} disabled={f === 'cited' && !cited} className="h-6 rounded-md px-2 text-[11.5px] text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm">
          {f === 'cited' ? 'Cited' : 'All'}
          <span className="zo-meta">{f === 'cited' ? cited : all}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function SourceRow({ entry, onRead, detail = false }: { entry: LibraryEntry; onRead: (e: LibraryEntry) => void; detail?: boolean }) {
  const r = entry.result;
  return (
    <button onClick={() => onRead(entry)} className={cn('flex w-full flex-col gap-1 text-left transition-colors hover:bg-foreground/[0.04]', detail ? 'px-4 py-3' : 'rounded-lg px-2 py-2.5')}>
      <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <img src={favicon(r.domain)} alt="" className="size-3.5 rounded-[3px]" loading="lazy" />
        <span className="truncate">{shortDomain(r.domain)}</span>
        {r.content && <FileText className="size-3 shrink-0 opacity-60" aria-label="Full text read" />}
        {entry.citedBy.length > 0 && <span className="zo-meta ml-auto shrink-0 text-foreground/60">cited{entry.citedBy.length > 1 ? ` ×${entry.citedBy.length}` : ''}</span>}
      </span>
      <span className="line-clamp-2 text-[13px] font-medium leading-snug">{r.title}</span>
      {detail && r.snippet && <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{r.snippet}</span>}
    </button>
  );
}

/** Desktop side rail: the conversation's sources, cited ones first. */
export function SourcesRail({ entries, engines, onRead, onAll }: { entries: LibraryEntry[]; engines: EngineStatus[]; onRead: (e: LibraryEntry) => void; onAll: () => void }) {
  const cited = entries.filter((e) => e.citedBy.length);
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [touched, setTouched] = useState(false);
  // Once cards cite something, show what they used — unless the person already picked a filter.
  const active: SourceFilter = touched ? filter : cited.length ? 'cited' : 'all';
  const shown = (active === 'cited' ? cited : entries).slice(0, 10);

  return (
    <section className="space-y-2">
      <div className="flex h-7 items-center gap-2">
        <h3 className="zo-label text-foreground">Sources</h3>
        <div className="flex items-center gap-1">
          {engines.map((e) => (
            <span
              key={e.name}
              role="img"
              title={`${e.name}: ${e.ok ? `${e.count} results · ${e.ms}ms` : e.error}`}
              aria-label={`${e.name}: ${e.ok ? `${e.count} results` : 'unavailable'}`}
              className={cn('size-1.5 rounded-full', e.ok && e.count ? 'bg-positive' : 'bg-muted-foreground/30')}
            />
          ))}
        </div>
        <div className="ml-auto">
          <FilterToggle value={active} onChange={(v) => { setTouched(true); setFilter(v); }} cited={cited.length} all={entries.length} />
        </div>
      </div>
      <ol className="-mx-2">
        {shown.map((e) => <li key={e.result.url}><SourceRow entry={e} onRead={onRead} /></li>)}
      </ol>
      {entries.length > shown.length && (
        <button onClick={onAll} className="px-0 text-xs text-muted-foreground transition-colors hover:text-foreground">Show all {entries.length} sources</button>
      )}
    </section>
  );
}

/** Every source in the conversation; optionally narrowed to the ones one card cites. */
export function SourcesSheet({ open, onOpenChange, entries, scope, onClearScope, onRead }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: LibraryEntry[];
  scope?: { id: number; title: string };
  onClearScope: () => void;
  onRead: (e: LibraryEntry) => void;
}) {
  const desktop = useIsDesktop();
  const cited = entries.filter((e) => e.citedBy.length);
  const [filter, setFilter] = useState<SourceFilter>('cited');
  useEffect(() => {
    if (open) setFilter(scope || cited.length ? 'cited' : 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope?.id]);
  const scoped = scope ? entries.filter((e) => e.citedBy.includes(scope.id)) : cited;
  const shown = filter === 'cited' ? scoped : entries;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={desktop ? 'right' : 'bottom'} className={cn('gap-0 p-0', desktop ? 'w-full sm:max-w-md' : 'h-[85dvh] rounded-t-2xl')}>
        <SheetHeader className="gap-3 border-b px-4 pb-3 pt-4">
          <SheetTitle className="text-base">Sources</SheetTitle>
          <SheetDescription className="sr-only">Sources gathered in this conversation</SheetDescription>
          <div className="flex flex-wrap items-center gap-2">
            <FilterToggle value={filter} onChange={setFilter} cited={scoped.length} all={entries.length} />
            {scope && filter === 'cited' && (
              <button onClick={onClearScope} className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-foreground/[0.05] py-1 pl-2 pr-1.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground">
                <span className="truncate">In “{scope.title}”</span>
                <X className="size-3 shrink-0" />
              </button>
            )}
          </div>
        </SheetHeader>
        <div className="flex-1 divide-y overflow-y-auto pb-[env(safe-area-inset-bottom)]">
          {shown.map((e) => <SourceRow key={e.result.url} entry={e} onRead={onRead} detail />)}
          {!shown.length && <p className="p-6 text-center text-sm text-muted-foreground">No cited sources yet.</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
