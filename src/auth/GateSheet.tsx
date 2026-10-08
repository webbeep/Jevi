import { COPY } from './copy';
import { GoogleButton } from './GoogleButton';
import { CloseButton, Panel, useBackToClose } from './panel';
import { resetLabel } from './reset';
import { startSignIn } from './signin';
import { useAuth } from './store';

export function GateSheet({
  open,
  waiting,
  onOpenChange,
}: {
  open: boolean;
  waiting: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const auth = useAuth();
  useBackToClose(open, onOpenChange);
  const showUsed = waiting || auth.remaining <= 0;
  return (
    <Panel open={open} onOpenChange={onOpenChange} title={COPY.s1} maxWidth="sm:max-w-[420px]">
      <CloseButton onClick={() => onOpenChange(false)} />
      <div className="flex flex-col gap-3 pr-8">
        {showUsed && auth.limit > 0 && <p className="text-sm leading-snug">{COPY.s2(auth.limit)}</p>}
        <p className="text-sm leading-snug text-muted-foreground">{waiting ? COPY.s3 : COPY.s3b}</p>
        <GoogleButton className="w-full" onClick={() => startSignIn(waiting ? 'wall' : 'soft')} />
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="inline-flex h-11 w-full items-center justify-center rounded-md text-sm font-medium text-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {COPY.notNow}
        </button>
        <p className="text-[13px] leading-snug text-muted-foreground">{COPY.s6(resetLabel())}</p>
        <p className="text-[13px] leading-snug text-muted-foreground">
          By continuing you agree to the{' '}
          <a href="/terms" className="underline underline-offset-2">{COPY.terms}</a>
          {' '}and{' '}
          <a href="/privacy" className="underline underline-offset-2">{COPY.privacy}</a>.
        </p>
      </div>
    </Panel>
  );
}
