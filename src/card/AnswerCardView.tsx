import { Loader2, RefreshCw, Zap } from 'lucide-react';
import type { AnswerCard, CardPattern, QuickAnswer } from '../../shared/card';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LogoMark } from '../Logo';
import { Icon } from './Icon';
import { Nodes } from './render';

export function AnswerCardView({ card, version, filling, streaming, status, quick, pattern, alternatives, engine, onPattern, simple, onSimple, onRegenerate }: {
  card: AnswerCard;
  /** Changes whenever a fresh design starts, replaying the entrance animation. */
  version: string;
  filling: boolean;
  /** True while nodes are still arriving. */
  streaming: boolean;
  /** Shown while an existing card is being redesigned. */
  status?: string;
  /** Jev's instant answer; the caller passes it only until the designed card starts arriving. */
  quick?: QuickAnswer;
  pattern?: string;
  alternatives: CardPattern[];
  engine?: string;
  onPattern: (id: string) => void;
  simple: boolean;
  onSimple: (v: boolean) => void;
  onRegenerate: () => void;
}) {
  return (
    <Card className="relative gap-0 overflow-hidden py-0 shadow-sm">
      <div className={cn('absolute inset-x-0 top-0 h-0.5', filling && 'designing-bar')} />
      <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-muted/40 sm:size-10">
          {filling && !card.icon ? <LogoMark className="size-5" animated /> : <Icon name={card.icon} fallback="layout-grid" className="size-[18px] sm:size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold tracking-tight sm:text-base">{card.title}</h2>
          {filling && !card.subtitle ? <Skeleton className="mt-1.5 h-3 w-40" /> : <p className="truncate text-[13px] text-muted-foreground sm:text-sm">{card.subtitle}</p>}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onRegenerate} disabled={filling} aria-label="Redesign card">
              <RefreshCw className={cn('size-4', filling && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redesign</TooltipContent>
        </Tooltip>
      </div>

      {status && (
        <div className="flex items-center gap-2 border-b bg-brand/5 px-4 py-2 text-xs text-brand animate-in fade-in slide-in-from-top-1 sm:px-6">
          <Loader2 className="size-3.5 animate-spin" />
          <span className="truncate">{status}</span>
        </div>
      )}

      <div className={cn('px-4 py-4 transition-[opacity,filter] duration-300 sm:px-6 sm:py-5', status && !streaming && 'pointer-events-none opacity-50 blur-[1px]')}>
        {quick && (
          <div className="mb-4 rounded-xl border border-brand/20 bg-gradient-to-br from-brand/8 to-brand-2/5 p-3.5 animate-in fade-in slide-in-from-top-1">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-brand">
              <Zap className="size-3" /> Instant answer
            </div>
            <p className="text-[15px] leading-snug">{quick.text}</p>
            {quick.domain && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <img src={`https://icons.duckduckgo.com/ip3/${quick.domain}.ico`} alt="" className="size-3.5 rounded-sm" />
                {quick.domain}
              </div>
            )}
          </div>
        )}
        <Nodes key={version} nodes={card.body} className="gap-4 sm:gap-5" stagger={!streaming} />
      </div>

      {alternatives.length > 0 && (
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto border-t bg-muted/30 px-4 py-2 sm:px-6">
          <span className="shrink-0 text-xs text-muted-foreground">Layout</span>
          <ToggleGroup type="single" size="sm" value={pattern} disabled={filling} onValueChange={(v) => v && v !== pattern && onPattern(v)} className="shrink-0">
            {alternatives.map((a) => (
              <ToggleGroupItem key={a.id} value={a.id} className="h-7 shrink-0 px-2.5 text-xs" title={a.description}>{a.label}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup type="multiple" size="sm" disabled={filling} value={simple ? ['simple'] : []} onValueChange={(v) => onSimple(v.includes('simple'))} className="shrink-0">
            <ToggleGroupItem value="simple" className="h-7 px-2.5 text-xs">Simpler</ToggleGroupItem>
          </ToggleGroup>
          {engine && <Badge variant="outline" className="ml-auto shrink-0 font-normal text-muted-foreground">{engine}</Badge>}
        </div>
      )}
    </Card>
  );
}
