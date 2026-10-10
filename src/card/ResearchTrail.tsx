import type { ReactNode } from 'react';
import { Check, Search } from 'lucide-react';
import type { SearchResponse } from '../../shared/types';
import type { PeekRow } from '../sse';
import { favicon } from '../Sources';
import { cn } from '@/lib/utils';

type Stage = 'understand' | 'search' | 'read' | 'layout';
const ORDER: Stage[] = ['understand', 'search', 'read', 'layout'];

const shortDomain = (d: string) => d.replace(/^(www|en|m)\./, '');
const SHOWN_ROWS = 5;

/**
 * What a search is doing before its card can be laid out: the question as understood, the searches and
 * the sources as they land, the reading, then the layout. Every line is real progress from the stream,
 * so the wait shows work instead of a guessed skeleton.
 */
export function ResearchTrail({ question, intent, peek, search, designing }: {
  question: string;
  intent?: { intent: string; queries: string[] };
  peek?: PeekRow[];
  search?: SearchResponse;
  designing?: { pagesRead: number };
}) {
  // Rows already on screen from the first look keep their place; the full search only adds after them.
  const first = peek ?? [];
  const shown = new Set(first.map((r) => r.url));
  const rows: PeekRow[] = [...first, ...(search?.results ?? []).filter((r) => !shown.has(r.url))];
  const stage: Stage = designing ? 'layout' : search ? 'read' : peek?.length || intent ? 'search' : 'understand';
  const at = ORDER.indexOf(stage);
  const state = (s: Stage) => (ORDER.indexOf(s) < at ? 'done' : s === stage ? 'active' : 'todo');
  const queries = [question, ...(intent?.queries ?? [])].filter((q, i, all) => all.findIndex((x) => x.toLowerCase() === q.toLowerCase()) === i).slice(0, 3);
  const read = designing?.pagesRead ?? search?.results.filter((r) => r.content).length ?? 0;
  const count = search?.results.length ?? 0;

  return (
    <ol data-testid="research-trail" aria-live="polite" className="relative space-y-3.5 text-[13px]">
      <Step state={state('understand')} label={intent ? 'Understood' : 'Understanding the question'}>
        {intent?.intent && <p className="text-pretty leading-snug text-muted-foreground animate-in fade-in">{intent.intent}</p>}
      </Step>
      {at >= 1 && (
        <Step state={state('search')} label={count ? `Found ${count} sources` : 'Searching the web'}>
          <div className="flex flex-wrap gap-1.5">
            {queries.map((q, i) => (
              <span key={q} style={{ animationDelay: `${i * 90}ms` }} className="inline-flex max-w-full items-center gap-1 rounded-full bg-foreground/[0.05] px-2.5 py-1 text-[12px] text-muted-foreground animate-in fade-in slide-in-from-bottom-1 fill-mode-both">
                <Search className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{q}</span>
              </span>
            ))}
          </div>
          {rows.length > 0 && (
            <ul className="mt-2 space-y-1">
              {rows.slice(0, SHOWN_ROWS).map((r, i) => (
                <li key={r.url} style={{ animationDelay: `${i * 110}ms` }} className="flex min-w-0 items-center gap-2 animate-in fade-in slide-in-from-left-1 fill-mode-both duration-300">
                  <img src={favicon(r.domain)} alt="" loading="lazy" className="size-3.5 shrink-0 rounded-[3px]" />
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  <span className="zo-meta shrink-0">{shortDomain(r.domain)}</span>
                </li>
              ))}
              {rows.length > SHOWN_ROWS && <li style={{ animationDelay: `${SHOWN_ROWS * 110}ms` }} className="zo-meta pl-5.5 animate-in fade-in fill-mode-both">+{rows.length - SHOWN_ROWS} more</li>}
            </ul>
          )}
        </Step>
      )}
      {at >= 2 && <Step state={state('read')} label={read ? `Read ${read} ${read === 1 ? 'page' : 'pages'}` : 'Reading the sources'} />}
      {at >= 3 && <Step state={state('layout')} label="Laying out the answer" />}
    </ol>
  );
}

function Step({ state, label, children }: { state: 'done' | 'active' | 'todo'; label: string; children?: ReactNode }) {
  return (
    <li className="flex gap-2.5 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <span aria-hidden className={cn('mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-full', state === 'done' ? 'bg-foreground/10 text-foreground/70' : 'border border-foreground/20')}>
        {state === 'done' ? <Check className="size-2.5" strokeWidth={3} /> : state === 'active' ? <span className="size-1.5 animate-pulse rounded-full bg-foreground/60" /> : null}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className={cn('font-medium leading-snug', state === 'active' ? 'zo-shimmer-text' : 'text-foreground/80')}>{label}</p>
        {children}
      </div>
    </li>
  );
}
