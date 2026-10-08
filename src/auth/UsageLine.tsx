import { useEffect, useState } from 'react';
import { COPY } from './copy';
import { track } from './events';
import { requestSheet } from './gatebus';
import { useAuthNotice, setAuthNotice } from './notice';
import { startSignIn } from './signin';
import { ssGet, ssSet } from './storage';
import { useAuth } from './store';

const SEEN = 'zo_soft_seen';
const LATER = 'zo_soft_later';

function seenLeft(left: number): boolean {
  try {
    const list = JSON.parse(ssGet(SEEN) || '[]') as number[];
    return Array.isArray(list) && list.includes(left);
  } catch {
    return false;
  }
}

function markLeft(left: number) {
  let list: number[] = [];
  try {
    const parsed = JSON.parse(ssGet(SEEN) || '[]') as number[];
    if (Array.isArray(parsed)) list = parsed.filter((n): n is number => typeof n === 'number');
  } catch {
    list = [];
  }
  if (!list.includes(left)) list.push(left);
  ssSet(SEEN, JSON.stringify(list));
}

const lineBtn = 'inline-flex h-11 items-center rounded-md px-3 text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** Soft prompt and sign-in notices. Renders nothing when auth is off, so the layout stays put. */
export function UsageLine() {
  const auth = useAuth();
  const notice = useAuthNotice();
  const [later, setLater] = useState(() => ssGet(LATER) === '1');
  const left = auth.enabled && auth.ready && !auth.signedIn && (auth.remaining === 2 || auth.remaining === 1) ? auth.remaining : null;
  const showSoft = left != null && !later && !notice;

  useEffect(() => {
    if (!showSoft || left == null || seenLeft(left)) return;
    markLeft(left);
    track('soft_prompt_shown', { left });
  }, [showSoft, left]);

  if (!auth.enabled || !auth.ready) return null;

  if (notice) {
    const text = notice.kind === 'cancelled' ? COPY.cancelled
      : notice.kind === 'error' ? COPY.failed
        : notice.kind === 'signed' ? COPY.signedCap(notice.limit)
          : COPY.ipCap(notice.limit);
    return (
      <div className="pointer-events-auto mb-2 flex items-start gap-1 px-1">
        <p role="status" className="min-w-0 flex-1 pt-2.5 text-[13px] leading-snug text-muted-foreground">
          {text}
          {notice.kind === 'error' && (
            <>
              {' '}
              <button type="button" onClick={() => startSignIn('header')} className={lineBtn}>{COPY.tryAgain}</button>
            </>
          )}
        </p>
        <button
          type="button"
          aria-label={COPY.dismiss}
          onClick={() => setAuthNotice(null)}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          ×
        </button>
      </div>
    );
  }

  if (!showSoft || left == null) return null;

  const dismiss = () => {
    ssSet(LATER, '1');
    setLater(true);
    track('soft_prompt_dismiss', { left });
  };

  return (
    <div className="pointer-events-auto mb-2 flex flex-wrap items-center gap-x-1 px-1">
      <p className="text-[13px] leading-snug text-muted-foreground">{left === 2 ? COPY.p3 : COPY.p4}</p>
      <button type="button" onClick={() => requestSheet(false)} className={lineBtn}>{COPY.signIn}</button>
      <button type="button" onClick={dismiss} className={lineBtn}>{COPY.later}</button>
    </div>
  );
}
