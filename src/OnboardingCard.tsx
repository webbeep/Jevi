import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { CornerDownRight, Play, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { GAIN } from './card/returnColor';
import { ONBOARD_STEPS } from './onboarding';

type StepId = (typeof ONBOARD_STEPS)[number]['id'];

const SHAPE_HOLDS = [1800, 1800, 1800];
const TAP_HOLDS = [720, 420, 680, 420, 680, 420, 1700];
const HIGHLIGHT_HOLDS = [720, 680, 1900];

const SHAPE_FRAMES = [
  { kind: 'chart', ask: 'Tesla stock price' },
  { kind: 'compare', ask: 'Is renting or buying cheaper?' },
  { kind: 'steps', ask: 'How to make a sourdough starter' },
] as const;

type ShapeKind = (typeof SHAPE_FRAMES)[number]['kind'];
type TapTarget = 'section' | 'stat' | 'button';

const CHART_POINTS = [30, 28, 34, 32, 40, 38, 46, 44, 52, 58, 55, 62] as const;

const TAP_BEATS: { target: TapTarget; press: boolean; ask: string }[] = [
  { target: 'section', press: false, ask: '' },
  { target: 'section', press: true, ask: 'Who were the standouts?' },
  { target: 'stat', press: false, ask: 'Who were the standouts?' },
  { target: 'stat', press: true, ask: 'How did he score 28?' },
  { target: 'button', press: false, ask: 'How did he score 28?' },
  { target: 'button', press: true, ask: 'What were the preseason highlights?' },
  { target: 'button', press: false, ask: 'What were the preseason highlights?' },
];

const TAP_AIM: Record<TapTarget, number> = { section: 0.7, stat: 0.55, button: 0.62 };

const SHORTCUTS = ['Explain', 'Expand', 'Search', 'Save'] as const;

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

/** Where the pointer tip should sit, relative to the demo. */
function anchorSpot(root: HTMLElement | null, el: HTMLElement | null, ax: number, ay: number) {
  if (!root || !el) return null;
  const a = root.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  return { x: b.left - a.left + b.width * ax, y: b.top - a.top + b.height * ay };
}

function Pointer({ x, y, pressing }: { x: number; y: number; pressing: boolean }) {
  return (
    <svg
      aria-hidden
      data-testid="onboard-cursor"
      data-pressing={pressing ? '' : undefined}
      viewBox="0 0 16 16"
      className="pointer-events-none absolute z-20 size-[18px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)] transition-[left,top] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{ left: x, top: y, transform: pressing ? 'translate(1px, 3px) scale(0.9)' : undefined }}
    >
      <path d="M1.4 1.2 1.6 13.2 5.4 9.6 8.3 14.6 10.2 13.6 7.3 8.6 12.2 8.2Z" fill="currentColor" stroke="var(--background)" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function ChartFrame() {
  return (
    <>
      <p className="text-[12px] text-muted-foreground">Tesla · TSLA</p>
      <p className="mt-0.5 text-[20px] font-semibold tracking-tight tabular-nums">$412.80</p>
      <p className="text-[11px] font-medium tabular-nums" style={{ color: GAIN }}>+7.40 (+1.82%)</p>
      <svg viewBox="0 0 280 56" className="zo-rise mt-1 h-9 w-full" aria-hidden>
        <path d={sparkPath(CHART_POINTS)} fill="none" stroke={GAIN} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </>
  );
}

function ShapeBody({ kind }: { kind: ShapeKind }) {
  switch (kind) {
    case 'chart':
      return <ChartFrame />;
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
    <div className="flex h-full flex-col justify-center px-4" data-testid="onboard-visual" data-step="shape">
      <p className="mb-2 truncate text-center text-[11px] text-muted-foreground">{frame.ask}</p>
      <div key={frame.kind} className="zo-rise rounded-xl border bg-card px-3 py-2.5 shadow-card">
        <ShapeBody kind={frame.kind} />
      </div>
    </div>
  );
}

function tapEl(target: TapTarget, section: HTMLDivElement | null, stat: HTMLDivElement | null, button: HTMLDivElement | null) {
  switch (target) {
    case 'section': return section;
    case 'stat': return stat;
    case 'button': return button;
    default: {
      const unknown: never = target;
      return unknown;
    }
  }
}

function TapDemo({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const phase = useLoop(active, TAP_HOLDS, reduced);
  const beat = TAP_BEATS[phase]!;
  const root = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const statRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = tapEl(beat.target, sectionRef.current, statRef.current, buttonRef.current);
    setSpot(anchorSpot(root.current, el, TAP_AIM[beat.target], 0.62));
  }, [beat.target, phase, active]);
  const pressed = (target: TapTarget) => beat.press && beat.target === target;
  return (
    <div ref={root} className="relative flex h-full flex-col justify-start px-3.5 pt-3" data-testid="onboard-visual" data-step="tap">
      <div className="rounded-xl border bg-card px-2.5 py-2 shadow-card">
        <div className="flex">
          <div ref={sectionRef} className={cn('rounded-md px-1.5 py-0.5', pressed('section') && 'bg-foreground/[0.06] ring-2 ring-foreground/20')}>
            <p className="zo-label">Standouts</p>
          </div>
        </div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <div ref={statRef} className={cn('rounded-lg border px-2 py-1.5', pressed('stat') && 'ring-2 ring-foreground/25')}>
            <p className="text-[10px] text-muted-foreground">Points</p>
            <p className="text-[16px] font-semibold tabular-nums tracking-tight">28</p>
          </div>
          <div className="rounded-lg border px-2 py-1.5">
            <p className="text-[10px] text-muted-foreground">Rebounds</p>
            <p className="text-[16px] font-semibold tabular-nums tracking-tight">9</p>
          </div>
        </div>
        <div className="mt-1.5">
          <div ref={buttonRef} className={cn('inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-[12px] font-medium', pressed('button') && 'bg-foreground/[0.06] ring-2 ring-foreground/25')}>
            <Play className="size-3 fill-current" aria-hidden />
            Highlights
          </div>
        </div>
      </div>
      {beat.ask && (
        <div className="zo-rise mt-2 flex items-start gap-2 px-1 text-[12.5px] leading-snug text-foreground/85">
          <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span>{beat.ask}</span>
        </div>
      )}
      {spot && <Pointer x={spot.x} y={spot.y} pressing={beat.press} />}
    </div>
  );
}

function HighlightDemo({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const phase = useLoop(active, HIGHLIGHT_HOLDS, reduced);
  const root = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const selected = phase >= 1;
  useLayoutEffect(() => {
    setSpot(anchorSpot(root.current, wordRef.current, selected ? 0.92 : 0.08, 0.72));
  }, [selected, phase, active]);
  return (
    <div ref={root} className="relative flex h-full flex-col justify-start px-3.5 pt-3.5" data-testid="onboard-visual" data-step="highlight">
      <p className="rounded-xl border bg-card px-3 py-2.5 text-[13px] leading-snug shadow-card">
        Feed the{' '}
        <span ref={wordRef} className="relative inline-block">
          <span aria-hidden className={cn('absolute inset-y-0 -inset-x-0.5 rounded-sm bg-[color-mix(in_oklch,var(--brand)_28%,transparent)] origin-left transition-transform duration-500', selected ? 'scale-x-100' : 'scale-x-0')} />
          <span className="relative">starter</span>
        </span>
        {' '}each day until it doubles.
      </p>
      {phase >= 2 && (
        <div className="zo-rise mt-2 overflow-hidden rounded-xl border bg-popover shadow-float">
          <div className="flex items-start gap-1.5 border-b px-2.5 py-2">
            <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">starter</p>
            <X className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </div>
          <div className="flex gap-1 overflow-hidden px-2 py-1.5">
            {SHORTCUTS.map((label) => (
              <span key={label} className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium', label === 'Explain' ? 'bg-foreground/[0.08] text-foreground' : 'text-muted-foreground')}>{label}</span>
            ))}
          </div>
          <p className="px-2.5 pb-2 text-[11px] text-muted-foreground">Add a note</p>
        </div>
      )}
      {spot && <Pointer x={spot.x} y={spot.y} pressing={false} />}
    </div>
  );
}

function StepVisual({ id, active }: { id: StepId; active: boolean }) {
  switch (id) {
    case 'shape': return <ShapeDemo active={active} />;
    case 'tap': return <TapDemo active={active} />;
    case 'highlight': return <HighlightDemo active={active} />;
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
                <div className="h-[248px] overflow-hidden rounded-xl bg-muted/50">
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
