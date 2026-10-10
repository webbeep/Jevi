import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { AnswerCard } from '../../shared/card';
import type { HistorySource } from '../../shared/historyCard';
import { COPY } from './copy';
import { track } from './events';
import { CloseButton, Panel, useBackToClose } from './panel';
import { forgetSave, rememberSave } from './saves';

export interface OpenedSave {
  id: string;
  query: string;
  title: string;
  card: AnswerCard;
  /** Search rows a video or citation on this card points at. */
  results?: HistorySource[];
  /** Set when this came from ask history, so opening it moves that question to the front. */
  fromHistory?: boolean;
}

interface SaveRow {
  id: string;
  query: string;
  title: string;
  created_at: string;
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

export default function SavedPanel({
  open,
  onOpenChange,
  onOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: (saved: OpenedSave) => void;
}) {
  const [rows, setRows] = useState<SaveRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  useBackToClose(open, onOpenChange);

  const load = useCallback(async (before?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (before) params.set('before', before);
      const res = await fetch(`/api/saves?${params}`, { credentials: 'same-origin' });
      if (!res.ok) {
        setError(COPY.savesError);
        return;
      }
      const data = (await res.json()) as { items?: unknown; next?: unknown };
      const page = asRows(data);
      for (const row of page) rememberSave(row.query, row.id);
      setRows((prev) => (before ? [...prev, ...page] : page));
      setNext(typeof data.next === 'string' && data.next ? data.next : null);
    } catch {
      setError(COPY.savesError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const openRow = async (row: SaveRow) => {
    setOpening(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/saves/${encodeURIComponent(row.id)}`, { credentials: 'same-origin' });
      if (!res.ok) {
        setError(COPY.openSaveError);
        return;
      }
      const data = (await res.json()) as { id?: unknown; query?: unknown; title?: unknown; card?: AnswerCard };
      if (!data.card || typeof data.query !== 'string') {
        setError(COPY.openSaveError);
        return;
      }
      onOpen({
        id: data.id == null ? row.id : String(data.id),
        query: data.query,
        title: typeof data.title === 'string' && data.title.trim() ? data.title : row.title,
        card: data.card,
      });
    } catch {
      setError(COPY.openSaveError);
    } finally {
      setOpening(null);
    }
  };

  const remove = async (row: SaveRow) => {
    track('unsave_click');
    const res = await fetch(`/api/saves/${encodeURIComponent(row.id)}`, { method: 'DELETE', credentials: 'same-origin' });
    if (res.ok || res.status === 404) {
      forgetSave(row.query);
      setRows((prev) => prev.filter((item) => item.id !== row.id));
    }
  };

  return (
    <Panel open={open} onOpenChange={onOpenChange} title={COPY.savedAnswers} desktop="right" maxWidth="sm:max-w-md">
      <CloseButton onClick={() => onOpenChange(false)} />
      {error && <p className="text-[13px] leading-snug text-muted-foreground">{error}</p>}
      {!loading && rows.length === 0 && !error && <p className="text-sm text-muted-foreground">{COPY.emptySaves}</p>}
      {loading && rows.length === 0 && <p className="text-[13px] text-muted-foreground">Loading…</p>}
      <ul className="flex max-h-[60dvh] flex-col gap-1 overflow-y-auto">
        {rows.map((row) => (
          <li key={row.id} className="flex items-stretch gap-1">
            <button
              type="button"
              disabled={opening === row.id}
              onClick={() => void openRow(row)}
              className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center rounded-lg px-2 text-left hover:bg-foreground/[0.04] focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            >
              <span className="w-full truncate text-sm">{row.title}</span>
              {row.created_at && <span className="text-xs text-muted-foreground">{relativeDate(row.created_at)}</span>}
            </button>
            <button
              type="button"
              aria-label={`Delete ${row.title}`}
              onClick={() => void remove(row)}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      {next && (
        <button
          type="button"
          onClick={() => void load(next)}
          disabled={loading}
          className="inline-flex h-11 items-center justify-center rounded-md px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {COPY.loadMore}
        </button>
      )}
    </Panel>
  );
}
