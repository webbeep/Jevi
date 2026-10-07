import { useEffect, useState } from 'react';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import type { AnswerCard } from '../../shared/card';
import { COPY, VALUE_ROW_TEXT } from './copy';
import { track } from './events';
import { GoogleButton } from './GoogleButton';
import { rememberPendingSave, rememberSave, forgetSave, useSavedId } from './saves';
import { startSignIn } from './signin';
import { ssGet, ssSet } from './storage';
import { useAuth } from './store';

export function ValueRow({ turnId, askN, query, title, card }: {
  turnId: number;
  askN: number;
  query: string;
  title: string;
  card: AnswerCard;
}) {
  const auth = useAuth();
  const savedId = useSavedId(query);
  const [busy, setBusy] = useState(false);
  const anonymous = auth.enabled && auth.ready && !auth.signedIn;

  useEffect(() => {
    if (!anonymous) return;
    const key = `zo_vp_${turnId}`;
    if (ssGet(key)) return;
    ssSet(key, '1');
    track('value_prompt_shown', { ask_n: askN });
  }, [anonymous, turnId, askN]);

  if (!auth.enabled || !auth.ready) return null;

  if (auth.signedIn) {
    const toggle = async () => {
      if (busy) return;
      setBusy(true);
      try {
        if (savedId) {
          const res = await fetch(`/api/saves/${encodeURIComponent(savedId)}`, { method: 'DELETE', credentials: 'same-origin' });
          if (res.ok || res.status === 404) forgetSave(query);
          return;
        }
        const res = await fetch('/api/saves', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, title, card }),
        });
        if (!res.ok) return;
        const data = (await res.json().catch(() => ({}))) as { id?: string | number };
        if (data.id != null) rememberSave(query, String(data.id));
      } catch {
        /* ignore */
      } finally {
        setBusy(false);
      }
    };
    const saved = !!savedId;
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy}
          aria-pressed={saved}
          className="inline-flex h-11 items-center gap-2 rounded-md border bg-background px-4 text-sm font-medium hover:bg-accent aria-pressed:bg-secondary"
        >
          {saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
          {saved ? COPY.saved : COPY.save}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">{VALUE_ROW_TEXT}</p>
      <GoogleButton
        className="w-full sm:w-auto"
        onClick={() => {
          rememberPendingSave({ query, title, card });
          track('value_prompt_click', { ask_n: askN });
          startSignIn('value');
        }}
      />
    </div>
  );
}
