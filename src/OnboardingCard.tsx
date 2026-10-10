import { useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ONBOARD_STEPS } from './onboarding';

/** The app intro, as the same numbered steps an answer card uses. */
export function OnboardingCard({ onDone }: { onDone: () => void }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (i: number) => {
    const next = new Set(done);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setDone(next);
    if (next.size === ONBOARD_STEPS.length) onDone();
  };
  return (
    <section data-testid="onboarding" aria-label="Start here" className="rounded-2xl border bg-card px-3 py-3 shadow-card sm:px-4">
      <div className="mb-1 flex items-center justify-between gap-2 pl-1">
        <h2 className="text-[15px] font-medium tracking-[-0.01em]">Start here</h2>
        <button
          type="button"
          onClick={onDone}
          className="inline-flex min-h-11 items-center rounded-xl px-3 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
        >
          Got it
        </button>
      </div>
      <ol className="space-y-1">
        {ONBOARD_STEPS.map((step, i) => (
          <li key={step.title}>
            <button
              type="button"
              onClick={() => toggle(i)}
              aria-pressed={done.has(i)}
              className="flex w-full items-start gap-2.5 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-muted/60 sm:gap-3 sm:p-2"
            >
              <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors', done.has(i) ? 'border-positive bg-positive text-white' : 'bg-card')}>
                {done.has(i) ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn('min-w-0', done.has(i) && 'opacity-50')}>
                <span className={cn('block text-sm font-medium', done.has(i) && 'line-through')}>{step.title}</span>
                <span className="block text-sm text-muted-foreground">{step.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
