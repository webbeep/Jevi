import { useCallback, useEffect, useState } from 'react';
import type { AnswerCard } from '../../shared/card';
import { COPY } from './copy';
import { CloseButton, Panel, useBackToClose } from './panel';
import type { OpenedSave } from './SavedPanel';

/** T446 profile: today's usage (same counter as the gate) and the account's full ask history. */
interface Usage {
  used: number;
  limit: number;
  resetAt: string;
}

interface Row {
  id: string;
  query: string;
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

const clock = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(t) : '';
};

function asUsage(v: unknown): Usage | null {
  if (!v || typeof v !== 'object') return null;
  const u = v as { used?: unknown; limit?: unknown; resetAt?: unknown };
  if (typeof u.used !== 'number' || typeof u.limit !== 'number') return null;
  return { used: u.used, limit: u.limit, resetAt: typeof u.resetAt === 'string' ? u.resetAt : '' };
}

function asRows(v: unknown): Row[] {
  const items = v && typeof v === 'object' ? (v as { items?: unknown }).items : null;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    const r = item as { id?: unknown; query?: unknown; created_at?: unknown } | null;
    return r && typeof r.id === 'string' && typeof r.query === 'string' ? [{ id: r.id, query: r.query, created_at: typeof r.created_at === 'string' ? r.created_at : '' }] : [];
  });
}

export default function ProfilePanel({
  open,
  onOpenChange,
  onOpen,
  onDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpen: (saved: OpenedSave) => void;
  onDraft: (question: string) => void;
}) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  useBackToClose(open, onOpenChange);

  const load = useCallback(async (before?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (before) params.set('before', before);
      const res = await fetch(`/api/history?${params}`, { credentials: 'same-origin' });
      if (!res.ok) {
        setError(COPY.historyError);
        return;
      }
      const data = (await res.json()) as { next?: unknown };
      const page = asRows(data);
      setRows((prev) => (before ? [...prev, ...page] : page));
      setNext(typeof data.next === 'string' && data.next ? data.next : null);
    } catch {
      setError(COPY.historyError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    fetch('/api/account/usage', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUsage(asUsage(data)))
      .catch(() => setUsage(null));
  }, [open, load]);

  const openRow = async (row: Row) => {
    setOpening(row.id);
    try {
      const res = await fetch(`/api/history/${encodeURIComponent(row.id)}`, { credentials: 'same-origin' });
      const data = res.ok ? ((await res.json()) as { query?: unknown; card?: AnswerCard | null }) : null;
      if (data?.card && typeof data.card === 'object') onOpen({ id: row.id, query: row.query, title: data.card.title || row.query, card: data.card });
      else onDraft(row.query);
    } catch {
      onDraft(row.query);
    } finally {
      setOpening(null);
    }
  };

  const pct = usage && usage.limit > 0 ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;

  return (
    <Panel open={open} onOpenChange={onOpenChange} title={COPY.profile} desktop="right" maxWidth="sm:max-w-md">
      <CloseButton onClick={() => onOpenChange(false)} />
      <section aria-label={COPY.today} className="flex flex-col gap-2 rounded-xl border border-border px-3 py-2.5" data-testid="profile-usage">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm">{COPY.today}</span>
          <span className="text-sm tabular-nums">{usage ? `${usage.used} / ${usage.limit}` : '–'}</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-foreground transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <span className="min-h-4 text-xs text-muted-foreground">{usage?.resetAt ? COPY.resets(clock(usage.resetAt)) : ''}</span>
      </section>
      <h3 className="px-1 pt-1 text-xs font-medium text-muted-foreground">{COPY.historyTitle}</h3>
      {error && <p className="px-1 text-[13px] leading-snug text-muted-foreground">{error}</p>}
      {!loading && rows.length === 0 && !error && <p className="px-1 text-sm text-muted-foreground">{COPY.emptyHistory}</p>}
      <ul className="-mt-1 flex max-h-[52dvh] flex-col gap-0.5 overflow-y-auto sm:max-h-none sm:min-h-0 sm:flex-1" data-testid="profile-history">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              disabled={opening === row.id}
              onClick={() => void openRow(row)}
              className="flex min-h-11 w-full min-w-0 flex-col items-start justify-center rounded-lg px-2 py-1 text-left hover:bg-foreground/[0.04] focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            >
              <span className="w-full truncate text-sm">{row.query}</span>
              {row.created_at && <span className="text-xs text-muted-foreground">{relativeDate(row.created_at)}</span>}
            </button>
          </li>
        ))}
        {loading && rows.length === 0 && Array.from({ length: 3 }, (_, i) => <li key={i} className="mx-2 my-2 h-7 animate-pulse rounded-md bg-muted" />)}
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
