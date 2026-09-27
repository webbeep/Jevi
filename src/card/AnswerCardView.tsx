import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { AnswerCard, CardPattern } from '../../shared/card';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from './Icon';
import { Nodes } from './render';

export function AnswerCardView({ card, version, filling, status, pattern, alternatives, engine, onPattern, simple, onSimple, onRegenerate }: {
  card: AnswerCard;
  /** Changes whenever a freshly designed card arrives, replaying the entrance animation. */
  version: string;
  filling: boolean;
  /** Shown while an existing card is being redesigned. */
  status?: string;
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
      <div className="flex items-start gap-3 border-b px-5 py-4 sm:px-6">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted/50">
          {filling && !card.icon ? <Sparkles className="size-4 animate-pulse text-muted-foreground" /> : <Icon name={card.icon} fallback="sparkles" className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold tracking-tight">{card.title}</h2>
          {filling && !card.subtitle ? <Skeleton className="mt-1.5 h-3 w-40" /> : <p className="truncate text-sm text-muted-foreground">{card.subtitle}</p>}
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
        <div className="flex items-center gap-2 border-b bg-brand/5 px-5 py-2 text-xs text-brand animate-in fade-in slide-in-from-top-1 sm:px-6">
          <Loader2 className="size-3.5 animate-spin" />
          <span className="truncate">{status}</span>
        </div>
      )}

      <CardContent className={cn('px-5 py-5 transition-[opacity,filter] duration-300 sm:px-6', status && 'pointer-events-none opacity-50 blur-[1px]')}>
        <Nodes key={version} nodes={card.body} className="gap-5" stagger />
      </CardContent>

      {alternatives.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-5 py-2.5 sm:px-6">
          <span className="text-xs text-muted-foreground">Layout</span>
          <ToggleGroup type="single" size="sm" value={pattern} disabled={filling} onValueChange={(v) => v && v !== pattern && onPattern(v)} className="flex-wrap">
            {alternatives.map((a) => (
              <ToggleGroupItem key={a.id} value={a.id} className="h-7 px-2.5 text-xs" title={a.description}>{a.label}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup type="multiple" size="sm" disabled={filling} value={simple ? ['simple'] : []} onValueChange={(v) => onSimple(v.includes('simple'))}>
            <ToggleGroupItem value="simple" className="h-7 px-2.5 text-xs">Simpler</ToggleGroupItem>
          </ToggleGroup>
          {engine && <Badge variant="outline" className="ml-auto font-normal text-muted-foreground">{engine}</Badge>}
        </div>
      )}
    </Card>
  );
}
