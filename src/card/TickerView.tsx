import { useCallback, useEffect, useMemo, useState } from 'react';
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CardNode } from '../../shared/card';
import { GAIN as UP, LOSS as DOWN } from './returnColor';
import { TICKER_RANGES, type TickerRange, type TickerSeries, priceText, rangeChange } from '../../shared/ticker';

type TickerNode = Extract<CardNode, { type: 'ticker' }>;

/** Today's line keeps moving while the card is open, for a while. */
const LIVE_REFRESH_MS = 30_000;
const LIVE_FOR_MS = 10 * 60_000;

const RANGE_WORD: Record<TickerRange, string> = {
  '1D': 'Today',
  '1W': 'Past week',
  '1M': 'Past month',
  '3M': 'Past 3 months',
  '1Y': 'Past year',
  '5Y': 'Past 5 years',
};

function timeLabel(t: number, range: TickerRange): string {
  const d = new Date(t * 1000);
  if (range === '1D') return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (range === '1W' || range === '1M') return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function money(n: number, node: TickerNode): string {
  const text = priceText(n);
  if (node.kind === 'fx' || node.kind === 'index') return text;
  return node.currency === 'USD' ? `$${text}` : `${text} ${node.currency}`;
}

function signedMoney(n: number, node: TickerNode): string {
  const sign = n >= 0 ? '+' : '−';
  return `${sign}${money(Math.abs(n), node)}`;
}

/** Axis ticks: whole numbers once prices are large, so labels stay short. */
function axisText(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 10_000) return Math.round(n).toLocaleString('en-US');
  if (abs >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return n.toPrecision(3);
}

/** Reports the point under the finger or pointer; renders nothing (the header shows it, like Robinhood). */
function Scrub({ active, payload, onPoint }: { active?: boolean; payload?: { payload?: { t: number; v: number } }[]; onPoint: (p: { t: number; v: number } | undefined) => void }) {
  const point = active ? payload?.[0]?.payload : undefined;
  const t = point?.t;
  useEffect(() => onPoint(point), [t]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function TickerView({ node }: { node: TickerNode }) {
  const [range, setRange] = useState<TickerRange>(node.series.range);
  const [loaded, setLoaded] = useState<Partial<Record<TickerRange, TickerSeries>>>({ [node.series.range]: node.series });
  const [loading, setLoading] = useState<TickerRange | undefined>();
  const [failed, setFailed] = useState<TickerRange | undefined>();
  const [hover, setHover] = useState<{ t: number; v: number } | undefined>();
  const series = loaded[range] ?? node.series;

  const load = useCallback(async (r: TickerRange, quiet = false) => {
    if (!quiet) setLoading(r);
    try {
      const res = await fetch(`/api/quote?symbol=${encodeURIComponent(node.symbol)}&range=${r}`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { series: TickerSeries };
      setLoaded((prev) => ({ ...prev, [r]: body.series }));
      setFailed(undefined);
    } catch {
      if (!quiet) setFailed(r);
    } finally {
      if (!quiet) setLoading(undefined);
    }
  }, [node.symbol]);

  const pick = (r: TickerRange) => {
    setRange(r);
    setHover(undefined);
    if (!loaded[r]) void load(r);
  };

  // A saved card reopened later starts from its old line: catch up once.
  useEffect(() => {
    if (Date.now() - Date.parse(node.series.at) > LIVE_REFRESH_MS) void load(node.series.range, true);
  }, [node.series, load]);

  useEffect(() => {
    if (range !== '1D') return;
    const started = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - started > LIVE_FOR_MS) return window.clearInterval(id);
      if (document.visibilityState === 'visible') void load('1D', true);
    }, LIVE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [range, load]);

  const data = useMemo(() => series.points.map(([t, v]) => ({ t, v })), [series]);
  const { domain, ticks } = useMemo(() => {
    const values = data.map((d) => d.v).concat(range === '1D' ? [series.base] : []);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1;
    return { domain: [lo - pad, hi + pad] as [number, number], ticks: [lo, (lo + hi) / 2, hi] };
  }, [data, range, series.base]);

  const whole = rangeChange(series.price, series.base);
  const color = whole.amount >= 0 ? UP : DOWN;
  const shown = hover?.v ?? series.price;
  const change = rangeChange(shown, series.base);
  const changeColor = change.amount >= 0 ? UP : DOWN;
  const label = node.kind === 'crypto' ? `${node.name} · ${node.symbol.split('-')[0]}` : node.kind === 'stock' ? `${node.name} · ${node.symbol}` : node.name;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">{money(shown, node)}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm font-medium tabular-nums">
        <span style={{ color: changeColor }}>
          {signedMoney(change.amount, node)} ({change.pct >= 0 ? '+' : '−'}{Math.abs(change.pct).toFixed(2)}%)
        </span>
        <span className="text-muted-foreground">{hover ? timeLabel(hover.t, range) : RANGE_WORD[range]}</span>
      </div>

      <div className={`mt-3 h-52 w-full transition-opacity sm:h-60 ${loading ? 'opacity-40' : ''}`} onMouseLeave={() => setHover(undefined)}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="t" hide />
            <YAxis
              orientation="right"
              domain={domain}
              ticks={ticks}
              tickFormatter={axisText}
              tickLine={false}
              axisLine={false}
              width={58}
              fontSize={10}
              tick={{ fill: 'var(--muted-foreground)' }}
            />
            {range === '1D' && <ReferenceLine y={series.base} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeDasharray="2 4" />}
            <Tooltip content={<Scrub onPoint={setHover} />} cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1 }} isAnimationActive={false} />
            <Line dataKey="v" type="linear" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: color, stroke: 'var(--card)', strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex items-center justify-between border-b pb-1" role="tablist" aria-label="Chart range">
        {TICKER_RANGES.map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={r === range}
            onClick={() => pick(r)}
            className="relative px-2 py-1.5 text-xs font-semibold transition-colors"
            style={{ color: r === range ? color : 'var(--muted-foreground)' }}
          >
            {r}
            {r === range && <span className="absolute inset-x-1 -bottom-[5px] h-0.5 rounded-full" style={{ background: color }} />}
          </button>
        ))}
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        {failed === range ? 'Could not load this range. Try again.' : `${node.feed} · as of ${new Date(series.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
      </div>
    </div>
  );
}
