import { useState } from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';
import type { EngineStatus, SearchResult } from '../shared/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const COLLAPSED = 5;

export function Sources({ results, engines, onDigest }: { results: SearchResult[]; engines: EngineStatus[]; onDigest: (r: SearchResult) => void }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? results : results.slice(0, COLLAPSED);
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sources · {results.length}</h2>
        <div className="flex items-center gap-1">
          {engines.map((e) => (
            <Tooltip key={e.name}>
              <TooltipTrigger asChild>
                <span className={cn('size-1.5 rounded-full', e.ok && e.count ? 'bg-positive' : 'bg-muted-foreground/30')} />
              </TooltipTrigger>
              <TooltipContent>{e.name}: {e.ok ? `${e.count} results · ${e.ms}ms` : e.error}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {shown.map((r, i) => (
          <article key={r.url} className="group flex gap-3 px-4 py-3">
            <span className="mt-0.5 w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <img src={`https://icons.duckduckgo.com/ip3/${r.domain}.ico`} alt="" className="size-3.5 rounded-sm" loading="lazy" />
                <span className="truncate">{r.domain}</span>
              </div>
              <a href={r.url} target="_blank" rel="noreferrer" className="mt-0.5 line-clamp-1 text-sm font-medium hover:underline">{r.title}</a>
              <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{r.snippet}</p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 shrink-0 opacity-60 group-hover:opacity-100" onClick={() => onDigest(r)} aria-label="Digest page">
                  <BookOpen className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Digest this page</TooltipContent>
            </Tooltip>
          </article>
        ))}
        {results.length > COLLAPSED && (
          <button onClick={() => setExpanded((e) => !e)} className="flex w-full items-center justify-center gap-1 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">
            {expanded ? 'Show less' : `Show ${results.length - COLLAPSED} more`}
            <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        )}
      </div>
    </section>
  );
}
