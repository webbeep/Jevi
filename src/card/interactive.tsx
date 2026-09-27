import { useState } from 'react';
import { RotateCw, Wand2 } from 'lucide-react';
import type { CardNode } from '../../shared/card';
import { cn } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useCard } from './context';
import { RichText } from './RichText';

type Of<T extends CardNode['type']> = Extract<CardNode, { type: T }>;

export function Choices({ node }: { node: Of<'choices'> }) {
  const { onRefine, busy } = useCard();
  const initial = node.options.find((o) => o.selected)?.label ?? '';
  const [value, setValue] = useState(initial);
  return (
    <div className="space-y-2">
      {node.label && <div className="text-xs font-medium text-muted-foreground">{node.label}</div>}
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value}
        disabled={busy}
        onValueChange={(v) => {
          const option = node.options.find((o) => o.label === v);
          if (!option || v === value) return;
          setValue(v);
          onRefine(option.prompt);
        }}
        className="no-scrollbar w-full justify-start overflow-x-auto"
      >
        {node.options.map((o) => (
          <ToggleGroupItem key={o.label} value={o.label} className="h-8 shrink-0 px-3 text-xs data-[state=on]:bg-foreground data-[state=on]:text-background">
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

const fmt = (n: number, unit?: string) => `${Number.isInteger(n) ? n : n.toFixed(1)}${unit ? ` ${unit}` : ''}`;

export function SliderNode({ node }: { node: Of<'slider'> }) {
  const { onRefine, busy } = useCard();
  const [value, setValue] = useState(node.value);
  const changed = value !== node.value;
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{node.label}</span>
        <span className="font-semibold tabular-nums">{fmt(value, node.unit)}</span>
      </div>
      <Slider
        min={node.min}
        max={node.max}
        step={node.step ?? 1}
        value={[value]}
        disabled={busy}
        onValueChange={([v]) => setValue(v)}
        onValueCommit={([v]) => v !== node.value && onRefine(node.prompt.replace('{value}', fmt(v, node.unit)))}
      />
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>{fmt(node.min, node.unit)}</span>
        {changed && busy && <span className="inline-flex items-center gap-1"><Wand2 className="size-3" />Redesigning…</span>}
        <span>{fmt(node.max, node.unit)}</span>
      </div>
    </div>
  );
}

function scaled(amount: number, factor: number): string {
  const v = amount * factor;
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return String(Math.round(v * 10) / 10);
  return String(Math.round(v * 100) / 100);
}

export function Scaler({ node }: { node: Of<'scaler'> }) {
  const [value, setValue] = useState(node.value ?? node.base);
  const factor = value / node.base;
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{node.label}</span>
        <span className="font-semibold tabular-nums">{fmt(value, node.unit)}</span>
      </div>
      <Slider min={node.min} max={node.max} step={node.step ?? 1} value={[value]} onValueChange={([v]) => setValue(v)} />
      <ul className="mt-4 divide-y">
        {node.items.map((i) => (
          <li key={i.name} className="flex items-baseline justify-between gap-3 py-2 text-sm">
            <span className="text-foreground/85">{i.name}</span>
            <span className={cn('font-medium tabular-nums transition-colors', factor !== 1 && 'text-brand')}>
              {scaled(i.amount, factor)}{i.unit ? ` ${i.unit}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AccordionNode({ node }: { node: Of<'accordion'> }) {
  return (
    <Accordion type="multiple" className="rounded-xl border bg-card px-4">
      {node.items.map((i, idx) => (
        <AccordionItem key={idx} value={String(idx)}>
          <AccordionTrigger className="text-sm">{i.title}</AccordionTrigger>
          <AccordionContent className="text-sm leading-relaxed text-foreground/80"><RichText text={i.text} /></AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

export function Reveal({ node }: { node: Of<'reveal'> }) {
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setFlipped((f) => {
    const next = new Set(f);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {node.items.map((item, i) => (
        <button key={i} onClick={() => toggle(i)} className="group h-32 [perspective:800px]" aria-pressed={flipped.has(i)}>
          <span className={cn('relative block size-full transition-transform duration-500 [transform-style:preserve-3d]', flipped.has(i) && '[transform:rotateY(180deg)]')}>
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl border bg-card p-4 text-center text-sm font-medium [backface-visibility:hidden]">
              {item.front}
              <RotateCw className="size-3.5 text-muted-foreground" />
            </span>
            <span className="absolute inset-0 flex items-center justify-center overflow-y-auto rounded-xl border border-brand/30 bg-brand/8 p-4 text-center text-sm [backface-visibility:hidden] [transform:rotateY(180deg)]">
              <RichText text={item.back} inline />
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
