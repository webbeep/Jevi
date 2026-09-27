import { useEffect, useState } from 'react';
import { ExternalLink, FileText, LayoutGrid, List } from 'lucide-react';
import type { EngineStatus, SearchResult } from '../shared/types';
import { api } from './api';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const favicon = (domain: string) => `https://icons.duckduckgo.com/ip3/${domain}.ico`;

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

function Reader({ result, query, onClose, onDigest }: { result: SearchResult | null; query: string; onClose: () => void; onDigest: (r: SearchResult) => void }) {
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
                {result.domain}
              </div>
              <SheetTitle className="text-base leading-snug">{result.title}</SheetTitle>
              <SheetDescription className="sr-only">Readable text of this source</SheetDescription>
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="h-8 rounded-full" onClick={() => { onDigest(result); onClose(); }}><LayoutGrid className="size-3.5" />Make it a card</Button>
                <Button size="sm" variant="outline" className="h-8 rounded-full" asChild>
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

export function Sources({ results, engines, query, onDigest }: { results: SearchResult[]; engines: EngineStatus[]; query: string; onDigest: (r: SearchResult) => void }) {
  const [reading, setReading] = useState<SearchResult | null>(null);
  const [all, setAll] = useState(false);
  const withText = results.filter((r) => r.content).length;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sources</h3>
        <span className="text-xs text-muted-foreground">{results.length}{withText ? ` · ${withText} read in full` : ''}</span>
        <div className="ml-auto flex items-center gap-1">
          {engines.map((e) => (
            <Tooltip key={e.name}>
              <TooltipTrigger asChild>
                <span className={cn('size-1.5 rounded-full', e.ok && e.count ? 'bg-positive' : 'bg-muted-foreground/30')} />
              </TooltipTrigger>
              <TooltipContent>{e.name}: {e.ok ? `${e.count} results · ${e.ms}ms` : e.error}</TooltipContent>
            </Tooltip>
          ))}
          <Button variant="ghost" size="sm" className="ml-1 h-7 px-2 text-xs" onClick={() => setAll(true)}><List className="size-3.5" />All</Button>
        </div>
      </div>

      <div className="no-scrollbar -mx-3 flex snap-x gap-2 overflow-x-auto px-3 pb-1 sm:-mx-4 sm:px-4">
        {results.slice(0, 10).map((r, i) => (
          <button key={r.url} onClick={() => setReading(r)} className="group flex w-52 shrink-0 snap-start flex-col gap-1.5 rounded-xl border bg-card p-3 text-left transition-colors hover:border-foreground/20 sm:w-60">
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="tabular-nums">{i + 1}</span>
              <img src={favicon(r.domain)} alt="" className="size-3.5 rounded-sm" loading="lazy" />
              <span className="truncate">{r.domain.replace(/^en\./, '')}</span>
              {r.content && <FileText className="ml-auto size-3 shrink-0 text-brand" aria-label="Full text available" />}
            </span>
            <span className="line-clamp-2 text-[13px] font-medium leading-snug">{r.title}</span>
            <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{r.snippet}</span>
          </button>
        ))}
      </div>

      <Sheet open={all} onOpenChange={setAll}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b p-4">
            <SheetTitle>All sources</SheetTitle>
            <SheetDescription>{results.length} results merged from {engines.filter((e) => e.ok && e.count).length} engines</SheetDescription>
          </SheetHeader>
          <div className="flex-1 divide-y overflow-y-auto">
            {results.map((r, i) => (
              <button key={r.url} onClick={() => { setAll(false); setReading(r); }} className="flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/40">
                <span className="w-4 shrink-0 pt-0.5 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <img src={favicon(r.domain)} alt="" className="size-3.5 rounded-sm" loading="lazy" />{r.domain}
                    {r.engines.length > 1 && <Badge variant="secondary" className="h-4 px-1 text-[10px]">×{r.engines.length}</Badge>}
                  </span>
                  <span className="mt-0.5 line-clamp-1 block text-sm font-medium">{r.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{r.snippet}</span>
                </span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <Reader result={reading} query={query} onClose={() => setReading(null)} onDigest={onDigest} />
    </section>
  );
}
