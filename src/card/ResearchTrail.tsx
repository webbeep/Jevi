import { Search } from 'lucide-react';
import type { SearchResponse } from '../../shared/types';
import type { PeekRow } from '../sse';
import { favicon } from '../Sources';

const shortDomain = (d: string) => d.replace(/^(www|en|m)\./, '');
/** The list grows as results arrive, and stops adding once it would take over the card. */
const MAX_ROWS = 8;

/**
 * The wait before a layout exists, inside the card: first the searches themselves ("Searching for"
 * the question and its expanded queries), then the sources, each new one animating onto the list.
 */
export function ResearchTrail({ question, intent, peek, search }: {
  question: string;
  intent?: { intent: string; queries: string[] };
  peek?: PeekRow[];
  search?: SearchResponse;
}) {
  const queries = [question, ...(intent?.queries ?? [])]
    .map((q) => q.trim())
    .filter((q, i, all) => q && all.findIndex((x) => x.toLowerCase() === q.toLowerCase()) === i)
    .slice(0, 4);
  const seen = new Set<string>();
  const rows: PeekRow[] = [];
  for (const row of [...(peek ?? []), ...(search?.results ?? [])]) {
    if (!row.url || seen.has(row.url)) continue;
    seen.add(row.url);
    rows.push(row);
    if (rows.length === MAX_ROWS) break;
  }
  const searching = rows.length === 0;

  return (
    <div data-testid="research-trail" aria-live="polite" className="space-y-3">
      <div>
        <p className={searching ? 'zo-shimmer-text text-[13px] font-medium' : 'text-[12.5px] font-medium text-muted-foreground'}>
          {searching ? 'Searching for' : 'Searched'}
        </p>
        <ul className="mt-1.5 space-y-1">
          {queries.map((q, i) => (
            <li key={q} style={{ animationDelay: `${i * 80}ms` }} className="flex min-w-0 items-center gap-2 text-[13.5px] leading-snug animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-300">
              <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{q}</span>
            </li>
          ))}
        </ul>
      </div>
      {rows.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {rows.map((r, i) => (
            <li key={r.url} style={{ animationDelay: `${Math.min(i, 6) * 50}ms` }} className="flex min-w-0 items-center gap-2.5 px-3 py-2 animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-300">
              <img src={favicon(r.domain)} alt="" loading="lazy" className="size-4 shrink-0 rounded-[3px]" />
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{r.title}</span>
              <span className="zo-meta shrink-0">{shortDomain(r.domain)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
