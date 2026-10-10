import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from 'recharts';
import type { CardNode } from '../../shared/card';
import { undupeParen, unitAlreadyInTitle } from '../../shared/fitChart';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

function axisText(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${(n / 1000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  return n.toLocaleString('en-US', { maximumFractionDigits: abs >= 100 ? 0 : 2 });
}

const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

export default function ChartView({ node }: { node: Extract<CardNode, { type: 'chart' }> }) {
  const config = { value: { label: node.unit ?? node.title ?? 'Value', color: 'var(--chart-1)' } } satisfies ChartConfig;
  const axis = <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} tickFormatter={(v: string) => (v.length > 6 ? v.slice(0, 6) : v)} />;
  const tooltip = <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel={false} />} />;
  // Lines and areas show change, so the axis fits the data instead of starting at zero (which flattens prices).
  const fitted = (
    <YAxis
      domain={['auto', 'auto']}
      tickFormatter={axisText}
      tickLine={false}
      axisLine={false}
      width={48}
      fontSize={10}
      tickCount={4}
    />
  );

  const chart = (() => {
    switch (node.kind) {
      case 'line':
        return (
          <LineChart data={node.data} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />{axis}{fitted}{tooltip}
            <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} dot={node.data.length <= 12 ? { r: 3 } : false} isAnimationActive={false} />
          </LineChart>
        );
      case 'area':
        return (
          <AreaChart data={node.data} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />{axis}{fitted}{tooltip}
            <Area dataKey="value" type="monotone" stroke="var(--color-value)" fill="var(--color-value)" fillOpacity={0.15} strokeWidth={2} />
          </AreaChart>
        );
      case 'hbar':
        return (
          <BarChart data={node.data} layout="vertical" margin={{ left: 4, right: 16 }}>
            <XAxis type="number" hide />
            <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} width={96} fontSize={11} tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)} />
            {tooltip}
            <Bar dataKey="value" fill="var(--color-value)" radius={5} />
          </BarChart>
        );
      case 'pie': {
        const pieConfig = Object.fromEntries(node.data.map((d, i) => [d.label, { label: d.label, color: PALETTE[i % PALETTE.length] }])) satisfies ChartConfig;
        return (
          <ChartContainer config={pieConfig} className="mx-auto aspect-square h-56">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent nameKey="label" hideLabel />} />
              <Pie data={node.data} dataKey="value" nameKey="label" innerRadius={48} strokeWidth={2}>
                {node.data.map((d, i) => <Cell key={d.label} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie>
              <ChartLegend content={<ChartLegendContent nameKey="label" />} className="flex-wrap gap-2" />
            </PieChart>
          </ChartContainer>
        );
      }
      case 'bar':
        return (
          <BarChart data={node.data} margin={{ top: 8 }}>
            <CartesianGrid vertical={false} />{axis}{tooltip}
            <Bar dataKey="value" fill="var(--color-value)" radius={6} />
          </BarChart>
        );
      default: {
        const unreachable: never = node.kind;
        return unreachable;
      }
    }
  })();

  const title = node.title ? undupeParen(node.title) : undefined;
  const unit = node.unit && !unitAlreadyInTitle(title, node.unit) ? node.unit : undefined;
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      {title && <div className="mb-3 text-sm font-medium">{title}{unit && <span className="ml-1 text-muted-foreground">({unit})</span>}</div>}
      {node.kind === 'pie' ? chart : (
        <ChartContainer config={config} className={node.kind === 'hbar' ? 'aspect-auto w-full' : 'aspect-auto h-40 w-full sm:h-44'} style={node.kind === 'hbar' ? { height: Math.max(120, node.data.length * 34) } : undefined}>
          {chart}
        </ChartContainer>
      )}
    </div>
  );
}
