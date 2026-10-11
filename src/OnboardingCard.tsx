import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { CornerDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { GAIN } from './card/returnColor';
import { ONBOARD_STEPS } from './onboarding';

type StepId = (typeof ONBOARD_STEPS)[number]['id'];

const SHAPE_HOLDS = [1500, 1500, 1700];
const TAP_HOLDS = [700, 480, 1900];
const LIVE_HOLDS = [1100, 1100, 1100, 1500];
const LIVE_RANGES = ['1D', '1W', '1M', '1Y'] as const;

const SHAPE_FRAMES = [
  { kind: 'compare', ask: 'Is renting or buying cheaper?' },
  { kind: 'price', ask: 'Tesla stock price' },
  { kind: 'steps', ask: 'How to make a sourdough starter' },
] as const;

type ShapeKind = (typeof SHAPE_FRAMES)[number]['kind'];

const LIVE_FRAMES = [
  { change: '+7.40 (+1.82%)', points: [30, 28, 34, 32, 40, 38, 46, 44, 52, 58, 55, 62] },
  { change: '+18.10 (+4.59%)', points: [20, 24, 22, 30, 36, 33, 42, 48, 45, 55, 60, 62] },
  { change: '+41.20 (+11.09%)', points: [12, 18, 16, 22, 28, 26, 34, 40, 38, 48, 54, 62] },
  { change: '+164.40 (+66.2%)', points: [8, 10, 14, 12, 18, 24, 22, 30, 36, 44, 52, 62] },
] as const;

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

function sparkPath(points: readonly number[]): string {
  const w = 280;
  const h = 56;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  return points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((p - min) / span) * (h - 6) - 3;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function ShapeBody({ kind }: { kind: ShapeKind }) {
  switch (kind) {
    case 'compare':
      return (
        <>
          <p className="text-[12px] font-medium">Renting vs buying</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
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
        </>
      );
    case 'price':
      return (
        <>
          <p className="text-[12px] text-muted-foreground">TSLA · Tesla</p>
          <p className="mt-0.5 text-[22px] font-semibold tracking-tight tabular-nums">$412.80</p>
          <p className="text-[11px] font-medium tabular-nums" style={{ color: GAIN }}>+$7.40 today</p>
        </>
      );
    case 'steps':
      return (
        <>
          <p className="text-[12px] font-medium">Sourdough starter</p>
          <ol className="mt-2 space-y-1.5">
            {['Mix flour and water', 'Feed it each day', 'Wait until it rises'].map((step, i) => (
              <li key={step} className="flex items-center gap-2 text-[12px]">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground text-[9px] font-medium text-background">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </>
      );
    default: {
      const unknown: never = kind;
      return unknown;
    }
  }
}

function ShapeDemo({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const phase = useLoop(active, SHAPE_HOLDS, reduced);
  const frame = SHAPE_FRAMES[reduced ? 0 : phase]!;
  return (
    <div className="flex h-full flex-col justify-center px-4">
      <p className="mb-2 truncate text-center text-[11px] text-muted-foreground">{frame.ask}</p>
      <div key={frame.kind} className="zo-rise rounded-xl border bg-card px-3 py-2.5 shadow-card">
        <ShapeBody kind={frame.kind} />
      </div>
    </div>
  );
}

function TapDemo({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const phase = useLoop(active, TAP_HOLDS, reduced);
  const pressed = phase >= 1;
  return (
    <div className="flex h-full flex-col justify-start px-4 pt-8">
      <div className={cn('rounded-xl border bg-card px-2.5 py-2 shadow-card transition-shadow', pressed && 'ring-2 ring-foreground/25')}>
        <div className="flex items-center gap-2">
          <span className="flex size-4 shrink-0 items-center justify-center rounded bg-foreground/10 text-[9px] font-medium">N</span>
          <span className="min-w-0 flex-1 truncate text-[12.5px]">NBA&apos;s Top 10 Plays — Oct 7</span>
          <span className="zo-meta shrink-0">youtube.com</span>
        </div>
      </div>
      {phase >= 2 && (
        <div className="zo-rise mt-2.5 flex items-start gap-2 px-1 text-[12.5px] leading-snug text-foreground/85">
          <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span>What happened in that video from Oct 7?</span>
        </div>
      )}
    </div>
  );
}

function LiveDemo({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const phase = useLoop(active, LIVE_HOLDS, reduced);
  const frame = LIVE_FRAMES[phase]!;
  return (
    <div className="flex h-full flex-col justify-center px-4">
      <div className="rounded-xl border bg-card px-3 py-2.5 shadow-card">
        <p className="text-[12px] text-muted-foreground">Tesla · TSLA</p>
        <p className="mt-0.5 text-[22px] font-semibold tracking-tight tabular-nums">$412.80</p>
        <p className="text-[11px] font-medium tabular-nums" style={{ color: GAIN }}>{frame.change}</p>
        <svg key={phase} viewBox="0 0 280 56" className="zo-rise mt-1 h-12 w-full" aria-hidden>
          <path d={sparkPath(frame.points)} fill="none" stroke={GAIN} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <div className="mt-1 flex items-center justify-between border-b" role="tablist" aria-label="Chart range">
          {LIVE_RANGES.map((range, i) => (
            <span key={range} className="relative px-1.5 py-1 text-[11px] font-semibold" style={{ color: i === phase ? GAIN : 'var(--muted-foreground)' }}>
              {range}
              {i === phase && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full" style={{ background: GAIN }} />}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepVisual({ id, active }: { id: StepId; active: boolean }) {
  switch (id) {
    case 'shape': return <ShapeDemo active={active} />;
    case 'tap': return <TapDemo active={active} />;
    case 'live': return <LiveDemo active={active} />;
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
