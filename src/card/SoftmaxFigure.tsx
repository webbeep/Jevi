import { SOFTMAX_SCORES, softmax } from '../../shared/figure';

const DIM = [0.16, 0.22, 0.12, 0.2, 0.14];

function shade(alpha: number): string {
  return `rgba(244,244,245,${alpha.toFixed(3)})`;
}

/** A drawn softmax row. Brighter cells are the tokens that row listens to. Not a photo, and not a measured run. */
export function SoftmaxFigure({ caption }: { caption?: string }) {
  const weights = softmax(SOFTMAX_SCORES);
  const peak = Math.max(...weights);
  const focus = weights.map((weight) => 0.22 + 0.78 * (weight / peak));
  const rows = [DIM, focus, DIM.map((value) => value * 0.8), DIM.map((value) => value * 1.05)];
  return (
    <figure className="overflow-hidden rounded-xl border bg-card" aria-label="Schematic of softmax attention. One row of scores becomes weights. Brighter cells are the tokens that row listens to most.">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3.5">
        <div className="text-[13px] font-medium tracking-tight">softmax(QKᵀ)</div>
        <div className="text-[11px] text-muted-foreground">schematic</div>
      </div>
      <div className="grid gap-1.5 px-4 py-3" style={{ gridTemplateColumns: `repeat(${SOFTMAX_SCORES.length}, minmax(0, 1fr))` }}>
        {rows.flatMap((row, r) => row.map((alpha, c) => (
          <div
            key={`${r}-${c}`}
            className={r === 1 ? 'aspect-square rounded-md ring-1 ring-foreground/20' : 'aspect-square rounded-md'}
            style={{ background: shade(alpha) }}
          />
        )))}
      </div>
      <figcaption className="px-4 pb-3.5 text-xs leading-relaxed text-muted-foreground">
        <span className="block text-foreground/85">{caption ?? 'Each row is a token. Brighter cells are the tokens it listens to most.'}</span>
        <span className="mt-1 block text-[11px]">One row, after softmax. Not a measured run.</span>
      </figcaption>
    </figure>
  );
}
