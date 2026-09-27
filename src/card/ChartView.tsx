import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis } from 'recharts';
import type { CardNode } from '../../shared/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

export default function ChartView({ node }: { node: Extract<CardNode, { type: 'chart' }> }) {
  const config = { value: { label: node.unit ?? node.title ?? 'Value', color: 'var(--chart-1)' } } satisfies ChartConfig;
  const axis = <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} tickFormatter={(v: string) => (v.length > 6 ? v.slice(0, 6) : v)} />;
  const tooltip = <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel={false} />} />;
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4">
      {node.title && <div className="mb-3 text-sm font-medium">{node.title}{node.unit && <span className="ml-1 text-muted-foreground">({node.unit})</span>}</div>}
      <ChartContainer config={config} className="aspect-auto h-40 w-full sm:h-44">
        {node.kind === 'line' ? (
          <LineChart data={node.data} margin={{ left: 8, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />{axis}{tooltip}
            <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        ) : node.kind === 'area' ? (
          <AreaChart data={node.data} margin={{ left: 8, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />{axis}{tooltip}
            <Area dataKey="value" type="monotone" stroke="var(--color-value)" fill="var(--color-value)" fillOpacity={0.15} strokeWidth={2} />
          </AreaChart>
        ) : (
          <BarChart data={node.data} margin={{ top: 8 }}>
            <CartesianGrid vertical={false} />{axis}{tooltip}
            <Bar dataKey="value" fill="var(--color-value)" radius={6} />
          </BarChart>
        )}
      </ChartContainer>
    </div>
  );
}

