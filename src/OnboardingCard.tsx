import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ArrowUp, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ONBOARD_STEPS } from './onboarding';

type StepId = (typeof ONBOARD_STEPS)[number]['id'];

const ASK = 'renting vs buying';
const LOOK_HOLDS = [420, 620, 620, 1700];
const CARD_HOLDS = [380, 700, 760, 1600];

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Plays a short loop while this step is on screen. Reduced motion holds the last frame. */
function useLoop(active: boolean, holds: readonly number[], reduced: boolean) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (reduced) {
      setPhase(holds.length - 1);
      return;
    }
    let i = 0;
    setPhase(0);
    let timer = 0;
    const tick = () => {
      timer = window.setTimeout(() => {
        i = (i + 1) % holds.length;
        setPhase(i);
        tick();
      }, holds[i]);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [active, reduced, holds]);
  return phase;
}

function AskDemo({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    if (reduced) {
      setN(ASK.length);
      return;
    }
    setN(0);
    let count = 0;
    let timer = 0;
    const tick = () => {
      const wait = count >= ASK.length ? 1400 : 68;
      timer = window.setTimeout(() => {
        count = count >= ASK.length ? 0 : count + 1;
        setN(count);
        tick();
      }, wait);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [active, reduced]);
  const typed = ASK.slice(0, n);
  const sent = n >= ASK.length;
  return (
    <div className="flex h-full flex-col justify-center px-5">
      <div className={cn('flex h-12 items-center gap-2 rounded-2xl border bg-card pl-3.5 pr-1.5 shadow-card', sent && 'ring-1 ring-foreground/15')}>
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-left text-[14px] text-foreground">
          {typed}
          {!sent && <span className="ml-px inline-block h-4 w-px translate-y-0.5 bg-foreground align-middle" />}
        </span>
        <span className={cn('flex size-9 items-center justify-center rounded-xl bg-foreground text-background transition-transform', sent && 'scale-90')}>
          <ArrowUp className="size-4" />
        </span>
      </div>
    </div>
  );
}

function LookDemo({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const phase = useLoop(active, LOOK_HOLDS, reduced);
  const queries = ['renting vs buying a home', 'rent vs buy monthly cost'];
  const sources = [
    { name: 'Cost comparison', domain: 'example.com' },
    { name: 'Rent or buy calculator', domain: 'housing.example' },
  ];
  return (
    <div className="flex h-full flex-col justify-start gap-2.5 px-5 pt-5 text-left">
      <p className="zo-shimmer-text text-[12px] font-medium">Searching for</p>
      {queries.map((q, i) => phase > i && (
        <div key={q} className="zo-row">
          <p className="truncate text-[13px] text-foreground/80">{q}</p>
        </div>
      ))}
      {phase >= 3 && sources.map((s, i) => (
        <div key={s.domain} className="zo-row" style={{ animationDelay: `${i * 90}ms` }}>
          <div className="flex items-center gap-2 py-0.5">
            <span className="flex size-4 shrink-0 items-center justify-center rounded bg-foreground/10 text-[9px] font-medium">{s.name.slice(0, 1)}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px]">{s.name}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{s.domain}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function CardDemo({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const phase = useLoop(active, CARD_HOLDS, reduced);
  return (
    <div className="flex h-full flex-col justify-start px-4 pt-4">
      <div className="rounded-xl border bg-card px-3 py-2.5 shadow-card">
        <p className="text-[12px] font-medium">Renting vs buying</p>
        {phase >= 1 && (
          <div className="zo-rise mt-2 grid grid-cols-2 gap-1.5">
            {[
              { label: 'Rent', bar: 'w-4/5' },
              { label: 'Buy', bar: 'w-3/5' },
            ].map((tile) => (
              <div key={tile.label} className="rounded-lg border px-2 py-1.5">
                <p className="text-[10px] text-muted-foreground">{tile.label}</p>
                <span className={cn('mt-1.5 block h-1.5 rounded-full bg-foreground/80', tile.bar)} />
              </div>
            ))}
          </div>
        )}
        {phase >= 2 && (
          <div className="zo-cover mt-2 space-y-1 border-t pt-2">
            {['Monthly', 'Upfront'].map((row) => (
              <div key={row} className="grid grid-cols-[64px_1fr_1fr] items-center gap-2">
                <span className="text-[10px] text-muted-foreground">{row}</span>
                <span className="h-1.5 rounded-full bg-foreground/25" />
                <span className="h-1.5 w-2/3 rounded-full bg-foreground/70" />
              </div>
            ))}
          </div>
        )}
        {phase >= 3 && (
          <div className="zo-rise mt-2 flex justify-end">
            <span className="rounded-md border px-2 py-0.5 text-[10px] text-muted-foreground">Save</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StepVisual({ id, active }: { id: StepId; active: boolean }) {
  switch (id) {
    case 'ask': return <AskDemo active={active} />;
    case 'look': return <LookDemo active={active} />;
    case 'card': return <CardDemo active={active} />;
    default: {
      const unknown: never = id;
      return unknown;
    }
  }
}

/** First-run intro: one full card per step, the motion on top, a line under it. */
export function OnboardingCard({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const startX = useRef<number | null>(null);
  const last = index === ONBOARD_STEPS.length - 1;
  const step = ONBOARD_STEPS[index]!;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDone();
      else if (event.key === 'ArrowRight') setIndex((i) => Math.min(ONBOARD_STEPS.length - 1, i + 1));
      else if (event.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    startX.current = event.clientX;
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (startX.current == null) return;
    const dx = event.clientX - startX.current;
    startX.current = null;
    if (dx <= -48) setIndex((i) => Math.min(ONBOARD_STEPS.length - 1, i + 1));
    else if (dx >= 48) setIndex((i) => Math.max(0, i - 1));
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/75 px-4 py-6 backdrop-blur-md">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboard-title"
        data-testid="onboarding"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        className="zo-rise w-full max-w-[400px] overflow-hidden rounded-2xl border bg-card shadow-card"
      >
        <div className="flex justify-end pr-1 pt-1">
          <button
            type="button"
            onClick={onDone}
            className="inline-flex min-h-11 items-center rounded-xl px-3 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
          >
            Skip
          </button>
        </div>
        <div className="overflow-hidden">
          <div
            className="flex transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {ONBOARD_STEPS.map((item, i) => (
              <section key={item.id} className="w-full shrink-0 px-4" aria-hidden={i !== index}>
                <div className="h-[232px] overflow-hidden rounded-xl bg-muted/50">
                  <StepVisual id={item.id} active={i === index} />
                </div>
                <h2 id={i === index ? 'onboard-title' : undefined} className="mt-4 text-[17px] font-semibold tracking-[-0.02em]">
                  {item.title}
                </h2>
                <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{item.line}</p>
              </section>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 pb-4 pt-4">
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Intro steps">
            {ONBOARD_STEPS.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={item.title}
                onClick={() => setIndex(i)}
                className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-5 bg-foreground' : 'w-1.5 bg-foreground/25')}
              />
            ))}
          </div>
          <Button
            type="button"
            data-testid="onboarding-next"
            className="ml-auto h-11 min-w-28 rounded-xl px-5"
            autoFocus
            onClick={() => (last ? onDone() : setIndex((i) => i + 1))}
          >
            {last ? 'Ask something' : 'Next'}
          </Button>
        </div>
        <p className="sr-only" aria-live="polite">{step.title}. {step.line}</p>
      </div>
    </div>
  );
}
