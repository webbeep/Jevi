import { useState } from 'react';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import type { AnswerCard } from '../../shared/card';
import { COPY } from './copy';
import { track } from './events';
import { forgetSave, rememberPendingSave, rememberSave, useSavedId } from './saves';
import { startSignIn } from './signin';
import { useAuth } from './store';

/** Save control in the card action row. Hidden unless sign-in is on and the user is signed in. */
export function SaveButton({ query, title, card }: { query: string; title: string; card: AnswerCard }) {
  const auth = useAuth();
  const savedId = useSavedId(query);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const saved = !!savedId;

  if (!auth.enabled || !auth.ready || !auth.signedIn) return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    try {
      if (savedId) {
        track('unsave_click');
        const res = await fetch(`/api/saves/${encodeURIComponent(savedId)}`, { method: 'DELETE', credentials: 'same-origin' });
        if (res.ok || res.status === 404) forgetSave(query);
        else setFailed(COPY.saveFail);
        return;
      }
      track('save_click');
      const res = await fetch('/api/saves', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, title, card }),
      });
      if (res.status === 401) {
        rememberPendingSave({ query, title, card });
        startSignIn('save');
        return;
      }
      if (res.status === 413) {
        setFailed(COPY.tooBig);
        return;
      }
      if (!res.ok) {
        setFailed(COPY.saveFail);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { id?: string | number };
      if (data.id != null) rememberSave(query, String(data.id));
    } catch {
      setFailed(COPY.saveFail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={saved}
      aria-invalid={failed ? true : undefined}
      aria-label={saved ? COPY.saved : COPY.save}
      title={failed ?? undefined}
      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
    >
      {saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
      {saved ? COPY.saved : COPY.save}
    </button>
  );
}
