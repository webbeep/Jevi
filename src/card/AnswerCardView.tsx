import { Loader2, MoreHorizontal, RefreshCw } from 'lucide-react';
import type { AnswerCard, CardPattern } from '../../shared/card';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { LogoMark } from '../Logo';
import { Icon } from './Icon';
import { Nodes } from './render';

export function AnswerCardView({ card, version, filling, streaming, status, pattern, alternatives, engine, onPattern, simple, onSimple, onRegenerate }: {
  card: AnswerCard;
  /** Changes whenever a fresh design starts, replaying the entrance animation. */
  version: string;
  filling: boolean;
  /** True while nodes are still arriving. */
  streaming: boolean;
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
      <div className={cn('absolute inset-x-0 top-0 h-0.5', filling && 'designing-bar')} />
      <div className="flex items-center gap-3 px-4 pb-1 pt-3.5 sm:px-6 sm:pt-5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60">
          {filling && !card.icon ? <LogoMark className="size-4" animated /> : <Icon name={card.icon} fallback="layout-grid" className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold leading-tight tracking-tight">{card.title}</h2>
          {filling && !card.subtitle ? <Skeleton className="mt-1 h-3 w-32" /> : card.subtitle && <p className="truncate text-xs text-muted-foreground">{card.subtitle}</p>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label="Card options">
              {filling ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {alternatives.length > 0 && (
              <>
                <DropdownMenuLabel className="text-xs text-muted-foreground">Layout</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={pattern} onValueChange={(v) => v !== pattern && onPattern(v)}>
                  {alternatives.map((a) => (
                    <DropdownMenuRadioItem key={a.id} value={a.id} disabled={filling}>{a.label}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={simple} disabled={filling} onCheckedChange={(v) => onSimple(!!v)}>Explain simpler</DropdownMenuCheckboxItem>
              </>
            )}
            <DropdownMenuItem disabled={filling} onSelect={onRegenerate}><RefreshCw className="size-4" />Redesign</DropdownMenuItem>
            {engine && (
              <>
                <DropdownMenuSeparator />
                <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">{engine}</p>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {status && (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg bg-brand/8 px-3 py-1.5 text-xs text-brand animate-in fade-in slide-in-from-top-1 sm:mx-6">
          <Loader2 className="size-3.5 animate-spin" />
          <span className="truncate">{status}</span>
        </div>
      )}

      <div className={cn('px-4 pb-4 pt-3 transition-[opacity,filter] duration-300 sm:px-6 sm:pb-6 sm:pt-4', status && !streaming && 'pointer-events-none opacity-50 blur-[1px]')}>
        <Nodes key={version} nodes={card.body} className="gap-4 sm:gap-5" stagger={!streaming} />
      </div>
    </Card>
  );
}
