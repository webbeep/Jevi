import { useState } from 'react';
import { Minus, Plus, RotateCw } from 'lucide-react';
import type { CardNode } from '../../shared/card';
import { billingLabel, formatMoney, monthlyTotal, priceForBasis, publishedLabel, type BillingBasis, type Price } from '../../shared/pricing';
import { cn } from '@/lib/utils';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
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
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
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
    <div className="rounded-xl border bg-card p-3 sm:p-4">
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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function PriceFacts({ price, seats }: { price: Price | undefined; seats: number }) {
  if (!price) {
    return (
      <div className="min-w-0">
        <div className="text-sm text-muted-foreground">—</div>
        <div className="text-[11px] text-muted-foreground">No price on this billing basis</div>
      </div>
    );
  }
  const floor = price.minSeats != null && seats < price.minSeats;
  return (
    <div className="min-w-0">
      <div className="text-[13px] leading-snug text-foreground/85">
        {publishedLabel(price)}
        <span className="text-muted-foreground"> · {billingLabel(price.billing)}</span>
      </div>
      {floor && <div className="text-[11px] text-muted-foreground">Minimum {price.minSeats} seats</div>}
      {price.sourceUrl ? (
        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          <a href={price.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-foreground/20 underline-offset-2 hover:text-foreground">
            {hostOf(price.sourceUrl)}
          </a>
          {price.asOf ? <span> · as of {price.asOf}</span> : null}
        </div>
      ) : (
        <div className="mt-0.5 text-[11px] text-muted-foreground">No source</div>
      )}
    </div>
  );
}

/** Seat count and billing stay on this card. Nothing here calls the network. */
export function Pricing({ node }: { node: Of<'pricing'> }) {
  const [seats, setSeats] = useState(node.seats);
  const [billing, setBilling] = useState<BillingBasis>(node.billing);
  const min = node.min ?? 1;
  const max = node.max ?? Math.max(50, node.seats);
  const setClamped = (n: number) => setSeats(Math.min(max, Math.max(min, n)));
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{node.label ?? 'Team size'}</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={billing}
            onValueChange={(v) => {
              if (v === 'monthly' || v === 'annual') setBilling(v);
            }}
            className="justify-start"
          >
            <ToggleGroupItem value="monthly" className="h-8 px-3 text-xs data-[state=on]:bg-foreground data-[state=on]:text-background">Monthly</ToggleGroupItem>
            <ToggleGroupItem value="annual" className="h-8 px-3 text-xs data-[state=on]:bg-foreground data-[state=on]:text-background">Annual</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon-sm" aria-label="Fewer seats" onClick={() => setClamped(seats - 1)} disabled={seats <= min}>
            <Minus />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Seats</span>
              <span className="font-semibold tabular-nums">{seats}</span>
            </div>
            <Slider min={min} max={max} step={1} value={[seats]} onValueChange={([v]) => v !== undefined && setClamped(v)} />
          </div>
          <Button type="button" variant="outline" size="icon-sm" aria-label="More seats" onClick={() => setClamped(seats + 1)} disabled={seats >= max}>
            <Plus />
          </Button>
        </div>
      </div>
      <ul className="mt-3 divide-y">
        {node.plans.map((plan, i) => {
          const price = priceForBasis(plan.prices, billing);
          const total = price ? monthlyTotal(price, seats) : null;
          return (
            <li key={`${plan.name}-${i}`} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">{plan.name}</div>
                {plan.note && <div className="text-[11px] text-muted-foreground">{plan.note}</div>}
                <PriceFacts price={price} seats={seats} />
              </div>
              <div className="shrink-0 sm:text-right">
                <div className="text-lg font-semibold tabular-nums tracking-[-0.03em]">{total == null ? '—' : `${formatMoney(total, price?.currency)}/mo`}</div>
                <div className="text-[11px] text-muted-foreground">team total</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function AccordionNode({ node }: { node: Of<'accordion'> }) {
  return (
    <Accordion type="multiple" className="rounded-xl border bg-card px-3 sm:px-4">
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
        <button key={i} onClick={() => toggle(i)} className="group h-28 [perspective:800px] sm:h-32" aria-pressed={flipped.has(i)}>
          <span className={cn('relative block size-full transition-transform duration-500 [transform-style:preserve-3d]', flipped.has(i) && '[transform:rotateY(180deg)]')}>
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl border bg-card p-4 text-center text-sm font-medium [backface-visibility:hidden]">
              {item.front}
              <RotateCw className="size-3.5 text-muted-foreground" />
            </span>
            <span className="absolute inset-0 flex items-center justify-center overflow-y-auto rounded-xl border border-brand/30 bg-brand/8 p-4 text-center text-sm [backface-visibility:hidden] [transform:rotateY(180deg)]">
              <RichText text={item.back} inline noLinks />
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
