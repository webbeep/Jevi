import { useEffect, useState } from 'react';
import { FileText, X } from 'lucide-react';
import type { LibraryEntry } from './library';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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

function FilterToggle({ value, onChange, cited, all }: { value: SourceFilter; onChange: (v: SourceFilter) => void; cited: number; all: number }) {
  return (
    <ToggleGroup type="single" size="sm" value={value} onValueChange={(v) => v && onChange(v as SourceFilter)} className="rounded-lg bg-foreground/[0.05] p-0.5">
      {(['cited', 'all'] as const).map((f) => (
        <ToggleGroupItem key={f} value={f} disabled={f === 'cited' && !cited} className="relative min-w-11 h-6 rounded-md px-2 text-[11.5px] text-muted-foreground after:absolute after:inset-x-0 after:-inset-y-[10px] after:content-[''] data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm">
          {f === 'cited' ? 'Cited' : 'All'}
          <span className="zo-meta">{f === 'cited' ? cited : all}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function SourceRow({ entry, detail = false }: { entry: LibraryEntry; detail?: boolean }) {
  const r = entry.result;
  return (
    <a href={r.url} target="_blank" rel="noopener noreferrer" className={cn('flex min-h-11 w-full flex-col gap-1 text-left transition-colors hover:bg-foreground/[0.04]', detail ? 'px-4 py-3' : 'rounded-lg px-2 py-2.5')}>
      <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <img src={favicon(r.domain)} alt="" className="size-3.5 rounded-[3px]" loading="lazy" />
        <span className="truncate">{shortDomain(r.domain)}</span>
        {r.content && <FileText className="size-3 shrink-0 opacity-60" aria-label="Full text read" />}
        {entry.citedBy.length > 0 && <span className="zo-meta ml-auto shrink-0 text-foreground/60">cited{entry.citedBy.length > 1 ? ` ×${entry.citedBy.length}` : ''}</span>}
      </span>
      <span className="line-clamp-2 text-[13px] font-medium leading-snug">{r.title}</span>
      {detail && r.snippet && <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{r.snippet}</span>}
    </a>
  );
}

/** Desktop side rail: the conversation's sources, cited ones first. */
export function SourcesRail({ entries, onAll }: { entries: LibraryEntry[]; onAll: () => void }) {
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
        <div className="ml-auto">
          <FilterToggle value={active} onChange={(v) => { setTouched(true); setFilter(v); }} cited={cited.length} all={entries.length} />
        </div>
      </div>
      <ol className="-mx-2">
        {shown.map((e) => <li key={e.result.url}><SourceRow entry={e} /></li>)}
      </ol>
      {entries.length > shown.length && (
        <button onClick={onAll} className="px-0 text-xs text-muted-foreground transition-colors hover:text-foreground">Show all {entries.length} sources</button>
      )}
    </section>
  );
}

/** Every source in the conversation; optionally narrowed to the ones one card cites. */
export function SourcesSheet({ open, onOpenChange, entries, scope, onClearScope }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: LibraryEntry[];
  scope?: { id: number; title: string };
  onClearScope: () => void;
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
          {shown.map((e) => <SourceRow key={e.result.url} entry={e} detail />)}
          {!shown.length && <p className="p-6 text-center text-sm text-muted-foreground">No cited sources yet.</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
