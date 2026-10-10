import { Search } from 'lucide-react';
import type { SearchResponse } from '../../shared/types';
import type { PeekRow } from '../sse';
import { favicon } from '../Sources';

const shortDomain = (d: string) => d.replace(/^(www|en|m)\./, '');
/** The list grows as results arrive, and stops adding once it would take over the card. */
const MAX_ROWS = 8;

/**
 * The wait before a layout exists, inside the card: the searches themselves, then the sources,
 * each one settling into place. The label never changes, so the list can arrive under it.
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

  return (
    <div data-testid="research-trail" aria-live="polite" className="space-y-3.5">
      <div>
        <p className="zo-shimmer-text text-[13px] font-medium">Searching for</p>
        <ul className="mt-1.5">
          {queries.map((q, i) => (
            <li key={q} style={{ animationDelay: `${i * 70}ms` }} className="zo-row">
              <div>
                <div className="flex min-w-0 items-center gap-2 py-0.5 text-[13.5px] leading-snug text-foreground/85">
                  <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{q}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {rows.length > 0 && (
        <ul>
          {rows.map((r, i) => (
            <li key={r.url} style={{ animationDelay: `${Math.min(i, 7) * 48}ms` }} className="zo-row">
              <div>
                <div className="zo-read-once flex min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1.5" style={{ animationDelay: `${420 + i * 220}ms` }}>
                  <img src={favicon(r.domain)} alt="" loading="lazy" className="size-4 shrink-0 rounded-[4px]" />
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">{r.title}</span>
                  <span className="zo-meta shrink-0">{shortDomain(r.domain)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
