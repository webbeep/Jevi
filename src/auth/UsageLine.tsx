import { useEffect, useState } from 'react';
import { COPY } from './copy';
import { track } from './events';
import { useAuthNotice } from './notice';
import { resetLabel } from './reset';
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
    if (Array.isArray(parsed)) list = parsed;
  } catch {
    list = [];
  }
  if (!list.includes(left)) list.push(left);
  ssSet(SEEN, JSON.stringify(list));
}

/** One muted line above the composer or the home input. Errors replace the soft prompt. */
export function UsageLine({ onSignIn }: { onSignIn: () => void }) {
  const auth = useAuth();
  const notice = useAuthNotice();
  const [later, setLater] = useState(() => ssGet(LATER) === '1');
  const left = auth.enabled && !auth.signedIn && auth.ready ? auth.limit - auth.used : null;
  const showSoft = left === 2 || left === 1 || (left === 0 && !later) || left === 0;
  const softLeft = left === 2 || left === 1 || left === 0 ? left : null;
  const visibleSoft = !notice && softLeft != null && (softLeft === 0 || !later);

  useEffect(() => {
    if (!visibleSoft || softLeft == null || seenLeft(softLeft)) return;
    markLeft(softLeft);
    track('soft_prompt_shown', { left: softLeft });
  }, [visibleSoft, softLeft]);

  if (!auth.enabled || !auth.ready) return null;

  if (notice?.kind === 'cancelled') {
    return <p className="line-clamp-2 text-[13px] leading-[18px] text-muted-foreground">{COPY.e1}</p>;
  }
  if (notice?.kind === 'error') {
    const text = notice.outOfFree ? COPY.e3(resetLabel()) : COPY.e2;
    return (
      <p className="line-clamp-2 text-[13px] leading-[18px] text-muted-foreground">
        {text}{' '}
        <button type="button" onClick={() => startSignIn('header')} className="relative text-foreground underline underline-offset-2 after:absolute after:-inset-x-1 after:-inset-y-3 after:content-['']">
          {COPY.tryAgain}
        </button>
      </p>
    );
  }

  if (!visibleSoft || softLeft == null || auth.signedIn) return null;
  if (!showSoft) return null;

  const dismiss = () => {
    ssSet(LATER, '1');
    setLater(true);
    track('soft_prompt_dismiss', { left: softLeft });
  };

  if (softLeft === 0) {
    return (
      <p className="line-clamp-2 text-[13px] leading-[18px] text-muted-foreground">
        {COPY.p5}{' '}
        <button type="button" onClick={onSignIn} className="relative text-foreground underline underline-offset-2 after:absolute after:-inset-x-1 after:-inset-y-3 after:content-['']">
          {COPY.p5Link}
        </button>
      </p>
    );
  }

  return (
    <p className="line-clamp-2 text-[13px] leading-[18px] text-muted-foreground">
      {softLeft === 2 ? COPY.p3 : COPY.p4}{' '}
      <button type="button" onClick={onSignIn} className="relative text-foreground underline underline-offset-2 after:absolute after:-inset-x-1 after:-inset-y-3 after:content-['']">
        {COPY.signIn}
      </button>
      {' · '}
      <button type="button" onClick={dismiss} className="relative text-foreground underline underline-offset-2 after:absolute after:-inset-x-1 after:-inset-y-3 after:content-['']">
        {COPY.later}
      </button>
    </p>
  );
}
