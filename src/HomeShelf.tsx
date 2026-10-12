import { useCallback, useEffect, useState } from 'react';
import { Bookmark, Trash2, TrendingUp } from 'lucide-react';
import type { AnswerCard } from '../shared/card';
import { readHistory } from '../shared/personal';
import { tailorTrends, TRENDING_LIMIT, TRENDING_POOL, type TrendQuery } from '../shared/trending';
import { COPY } from './auth/copy';
import { requestSaves } from './auth/gatebus';
import type { OpenedSave } from './auth/SavedPanel';
import { forgetSave, rememberSave } from './auth/saves';
import { track } from './auth/events';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type HomeTab = 'trending' | 'saved';

interface SaveRow {
  id: string;
  query: string;
  title: string;
  created_at: string;
}

const CLIENT_TTL_MS = 10 * 60 * 1000;

function recentQueries(): string[] {
  if (typeof localStorage === 'undefined') return [];
  return readHistory(localStorage).slice(0, 8).map((item) => item.q);
}
let trendCache: { at: number; items: TrendQuery[] } | null = null;

function asTrends(value: unknown): TrendQuery[] {
  if (!value || typeof value !== 'object') return [];
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: TrendQuery[] = [];
  for (const row of items) {
    if (!row || typeof row !== 'object') continue;
    const query = (row as { query?: unknown }).query;
    if (typeof query !== 'string' || !query.trim()) continue;
    out.push({ query: query.trim() });
    if (out.length >= TRENDING_POOL) break;
  }
  return out;
}

function asRows(value: unknown): SaveRow[] {
  if (!value || typeof value !== 'object') return [];
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const rows: SaveRow[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { id?: unknown; query?: unknown; title?: unknown; created_at?: unknown };
    if (row.id == null || typeof row.query !== 'string') continue;
    rows.push({
      id: String(row.id),
      query: row.query,
      title: typeof row.title === 'string' && row.title.trim() ? row.title : row.query,
      created_at: typeof row.created_at === 'string' ? row.created_at : '',
    });
  }
  return rows;
}

function relativeDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(t);
}

function useTrending(): { items: TrendQuery[]; pending: boolean } {
  const cached = trendCache && Date.now() - trendCache.at < CLIENT_TTL_MS ? trendCache.items : null;
  const [items, setItems] = useState<TrendQuery[]>(cached ?? []);
  const [pending, setPending] = useState(cached == null);
  useEffect(() => {
    if (trendCache && Date.now() - trendCache.at < CLIENT_TTL_MS) return;
    const ac = new AbortController();
    void fetch('/api/trending', { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => {
        const next = asTrends(data);
        trendCache = { at: Date.now(), items: next };
        setItems(next);
      })
      .catch(() => {
        if (!ac.signal.aborted) setItems([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setPending(false);
      });
    return () => ac.abort();
  }, []);
  return { items, pending };
}

function TabButton({
  id,
  selected,
  controls,
  onSelect,
  children,
}: {
  id: string;
  selected: boolean;
  controls: string;
  onSelect: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={selected}
      aria-controls={controls}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={cn(
        'relative inline-flex min-h-11 items-center rounded-xl px-3 text-[13px] font-medium transition-colors',
        selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
      <span className={cn('absolute inset-x-3 bottom-1.5 h-0.5 rounded-full bg-foreground', selected ? 'opacity-100' : 'opacity-0')} aria-hidden />
    </button>
  );
}

function RowSkeleton({ width }: { width: string }) {
  return (
    <div className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5" aria-hidden="true">
      <Skeleton className="size-4 shrink-0 rounded-md" />
      <Skeleton className="h-3 rounded-full" style={{ width }} />
    </div>
  );
}

/**
 * Under the search bar: trending searches, and saved answers once someone is signed in.
 * The trending list is a fixed handful of rows, so it has no scroller of its own.
 * Up to two of those rows move up when they share a topic with a recent search on this device.
 */
export function HomeShelf({
  signedIn,
  onSearch,
  onOpenSaved,
}: {
  signedIn: boolean;
  onSearch: (query: string) => void;
  onOpenSaved: (saved: OpenedSave) => void;
}) {
  const { items, pending } = useTrending();
  const shown = tailorTrends(items, recentQueries());
  const [tab, setTab] = useState<HomeTab>('trending');
  const [saves, setSaves] = useState<SaveRow[]>([]);
  const [more, setMore] = useState(false);
  const [savesPending, setSavesPending] = useState(false);
  const [savesError, setSavesError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) setTab('trending');
  }, [signedIn]);

  const loadSaves = useCallback(async () => {
    setSavesPending(true);
    setSavesError(null);
    try {
      const res = await fetch('/api/saves?limit=8', { credentials: 'same-origin' });
      if (!res.ok) {
        setSavesError(COPY.savesError);
        return;
      }
      const data = (await res.json()) as { next?: unknown };
      const rows = asRows(data);
      for (const row of rows) rememberSave(row.query, row.id);
      setSaves(rows);
      setMore(typeof data.next === 'string' && !!data.next);
    } catch {
      setSavesError(COPY.savesError);
    } finally {
      setSavesPending(false);
    }
  }, []);

  useEffect(() => {
    if (signedIn) void loadSaves();
  }, [signedIn, loadSaves]);

  const openSave = async (row: SaveRow) => {
    setOpening(row.id);
    setSavesError(null);
    try {
      const res = await fetch(`/api/saves/${encodeURIComponent(row.id)}`, { credentials: 'same-origin' });
      if (!res.ok) {
        setSavesError(COPY.openSaveError);
        return;
      }
      const data = (await res.json()) as { id?: unknown; query?: unknown; title?: unknown; card?: AnswerCard };
      if (!data.card || typeof data.query !== 'string') {
        setSavesError(COPY.openSaveError);
        return;
      }
      onOpenSaved({
        id: data.id == null ? row.id : String(data.id),
        query: data.query,
        title: typeof data.title === 'string' && data.title.trim() ? data.title : row.title,
        card: data.card,
      });
    } catch {
      setSavesError(COPY.openSaveError);
    } finally {
      setOpening(null);
    }
  };

  const removeSave = async (row: SaveRow) => {
    track('unsave_click');
    const res = await fetch(`/api/saves/${encodeURIComponent(row.id)}`, { method: 'DELETE', credentials: 'same-origin' });
    if (res.ok || res.status === 404) {
      forgetSave(row.query);
      setSaves((prev) => prev.filter((item) => item.id !== row.id));
    }
  };

  const showSaved = signedIn && tab === 'saved';

  return (
    <div className="mt-5 sm:mt-6">
      {signedIn ? (
        <div role="tablist" aria-label="Home" className="flex items-center gap-1 px-1" data-testid="home-tabs">
          <TabButton id="home-tab-trending" selected={tab === 'trending'} controls="home-panel" onSelect={() => setTab('trending')}>
            Trending
          </TabButton>
          <TabButton id="home-tab-saved" selected={tab === 'saved'} controls="home-panel" onSelect={() => setTab('saved')}>
            Saved
          </TabButton>
        </div>
      ) : (
        <h2 className="zo-label flex min-h-11 items-center px-3" id="home-tab-trending">Trending</h2>
      )}
      <div
        role={signedIn ? 'tabpanel' : undefined}
        id="home-panel"
        aria-labelledby={showSaved ? 'home-tab-saved' : 'home-tab-trending'}
        className="mt-1"
      >
        {showSaved ? (
          <SavedList
            rows={saves}
            pending={savesPending}
            error={savesError}
            more={more}
            opening={opening}
            onOpen={(row) => void openSave(row)}
            onRemove={(row) => void removeSave(row)}
          />
        ) : (
          <TrendingList items={shown} pending={pending} onSearch={onSearch} />
        )}
      </div>
    </div>
  );
}

function TrendingList({
  items,
  pending,
  onSearch,
}: {
  items: TrendQuery[];
  pending: boolean;
  onSearch: (query: string) => void;
}) {
  if (pending) {
    return (
      <>
        <p className="sr-only" aria-live="polite">Loading trending</p>
        <ul className="flex flex-col" aria-busy="true" data-testid="home-trending">
          {Array.from({ length: TRENDING_LIMIT }, (_, i) => (
            <li key={`trend-wait-${i}`}>
              <RowSkeleton width={`${58 + (i % 3) * 12}%`} />
            </li>
          ))}
        </ul>
      </>
    );
  }
  if (!items.length) {
    return <p className="px-4 py-3 text-[14px] text-muted-foreground" data-testid="home-trending">Nothing trending right now.</p>;
  }
  return (
    <ul className="flex flex-col" data-testid="home-trending">
      {items.map((item) => (
        <li key={item.query}>
          <button
            type="button"
            onClick={() => onSearch(item.query)}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] leading-snug text-foreground/80 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
          >
            <TrendingUp className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 break-words">{item.query}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function SavedList({
  rows,
  pending,
  error,
  more,
  opening,
  onOpen,
  onRemove,
}: {
  rows: SaveRow[];
  pending: boolean;
  error: string | null;
  more: boolean;
  opening: string | null;
  onOpen: (row: SaveRow) => void;
  onRemove: (row: SaveRow) => void;
}) {
  if (pending && rows.length === 0) {
    return (
      <ul className="flex flex-col" aria-busy="true" data-testid="home-saved">
        {Array.from({ length: 3 }, (_, i) => (
          <li key={`save-wait-${i}`}>
            <RowSkeleton width={`${48 + i * 14}%`} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div data-testid="home-saved">
      {error && <p className="px-4 py-2 text-[13px] leading-snug text-muted-foreground">{error}</p>}
      {!pending && rows.length === 0 && !error && <p className="px-4 py-3 text-[14px] text-muted-foreground">{COPY.emptySaves}</p>}
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.id} className="flex items-stretch gap-0.5 rounded-xl hover:bg-foreground/[0.04]">
            <button
              type="button"
              disabled={opening === row.id}
              onClick={() => onOpen(row)}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] leading-snug text-foreground/80 transition-colors hover:text-foreground disabled:opacity-50"
            >
              <Bookmark className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block break-words">{row.title}</span>
                {row.created_at && <span className="block text-[12px] text-muted-foreground">{relativeDate(row.created_at)}</span>}
              </span>
            </button>
            <button
              type="button"
              aria-label={`Delete ${row.title}`}
              onClick={() => onRemove(row)}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:text-foreground"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      {more && (
        <button
          type="button"
          onClick={() => requestSaves()}
          className="inline-flex min-h-11 items-center rounded-xl px-4 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {COPY.savedAnswers}
        </button>
      )}
    </div>
  );
}
