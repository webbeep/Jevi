import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Copy, Loader2, MoreHorizontal, RefreshCw, RotateCw, Share2 } from 'lucide-react';
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
import { cardPlainText } from '../../shared/cardText';
import { tickerBody } from '../../shared/tickerNotes';
import { citedRefs } from '../library';
import { LogoMark } from '../Logo';
import { FaviconStack } from '../Sources';
import { useCard } from './context';
import { Icon } from './Icon';
import { Nodes } from './render';
import { CardTitle } from './primitives';

export function AnswerCardView({ card, version, filling, streaming, status, pattern, alternatives, onPattern, simple, onSimple, onRegenerate, onRetry, toolbar, provisional = false, trail, revealLayout = false }: {
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
  onPattern: (id: string) => void;
  simple: boolean;
  onSimple: (v: boolean) => void;
  onRegenerate: () => void;
  onRetry: () => void;
  toolbar?: ReactNode;
  /** The title is still the question / plan skeleton, so the header keeps a stable height. */
  provisional?: boolean;
  /** Shown in place of the body while the searches and their results are still arriving. */
  trail?: ReactNode;
  /** The chosen layout is on screen and the answer has not been written yet, so its pieces animate in. */
  revealLayout?: boolean;
}) {
  const { results, onSources } = useCard();
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(timer);
  }, [toast]);
  // Cards saved before the server dropped them can still carry a "no chart" note beside the live chart.
  const body = useMemo(() => tickerBody(card.body), [card.body]);
  const cited = useMemo(() => (filling ? [] : citedRefs(card).flatMap((n) => (results[n - 1] ? [results[n - 1]] : []))), [filling, card, results]);
  const copyAnswer = () => {
    navigator.clipboard.writeText(cardPlainText(card, results)).then(() => setToast('Copied'), () => setToast("Couldn't copy"));
  };
  // Native share sheet where there is one; otherwise (or if it fails) the link is copied. Cancelling the sheet is silent.
  const share = async () => {
    const url = window.location.href;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: card.title, text: card.subtitle ?? card.title, url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setToast('Link copied');
    } catch {
      setToast("Couldn't copy link");
    }
  };
  return (
    <div className="relative isolate rounded-2xl">
    <div className="zo-aura" data-on={filling} />
    <div role="status" aria-live="polite" className="pointer-events-none absolute right-3 top-3 z-20">
      {toast && <span className="block rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background shadow-float animate-in fade-in">{toast}</span>}
    </div>
    <Card className="relative gap-0 overflow-hidden rounded-2xl py-0 shadow-card">
      <div className="flex items-start gap-2.5 pb-1 pl-4 pr-2 pt-3.5 sm:gap-3 sm:pl-6 sm:pr-3 sm:pt-5">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background sm:size-9">
          {filling && !card.icon ? <LogoMark className="size-4 animate-pulse" /> : <Icon name={card.icon} fallback="layout-grid" className="size-4 text-foreground/80 sm:size-[18px]" />}
        </div>
        <div className="min-w-0 flex-1 self-center">
          <h2 className={cn('text-balance text-[16.5px] font-semibold leading-[1.3] tracking-[-0.02em] sm:text-[17px]', provisional && 'line-clamp-1')}>{card.title}</h2>
          {card.subtitle && (
            <p className={cn('mt-0.5 text-pretty text-[13px] leading-snug text-muted-foreground', provisional && 'line-clamp-1')}>{card.subtitle}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center">
          {toolbar}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative size-8 shrink-0 text-muted-foreground after:absolute after:-inset-1.5 after:content-['']" aria-label="Card options">
<MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem className="min-h-11" disabled={filling} onSelect={copyAnswer}><Copy className="size-4" />Copy answer</DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" disabled={filling} onSelect={() => void share()}><Share2 className="size-4" />Share</DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" disabled={filling} onSelect={onRetry}><RotateCw className="size-4" />Retry</DropdownMenuItem>
            <DropdownMenuSeparator />
            {alternatives.length > 0 && (
              <>
                <DropdownMenuLabel className="text-xs text-muted-foreground">Layout</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={pattern} onValueChange={(v) => v !== pattern && onPattern(v)}>
                  {alternatives.map((a) => (
                    <DropdownMenuRadioItem key={a.id} className="min-h-11" value={a.id} disabled={filling}>{a.label}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem className="min-h-11" checked={simple} disabled={filling} onCheckedChange={(v) => onSimple(!!v)}>Explain simpler</DropdownMenuCheckboxItem>
              </>
            )}
            <DropdownMenuItem className="min-h-11" disabled={filling} onSelect={onRegenerate}><RefreshCw className="size-4" />Redesign</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      {status && (
        <div className="mx-4 mt-2 flex items-center gap-2 text-[13px] text-muted-foreground animate-in fade-in sm:mx-6">
          <Loader2 className="size-3.5 animate-spin" />
          <span className="truncate">{status}</span>
        </div>
      )}

      <div className={cn('px-4 pb-5 pt-3.5 transition-[opacity,filter] duration-300 sm:px-6 sm:pb-6 sm:pt-4', status && !streaming && 'pointer-events-none opacity-50 blur-[1px]', cited.length && 'pb-4 sm:pb-5')}>
        <CardTitle.Provider value={card.title}>
          {trail ?? <Nodes key={version} nodes={body} className="gap-5" stagger={revealLayout || !streaming} />}
        </CardTitle.Provider>
      </div>

      {cited.length > 0 && (
        <button onClick={onSources} className="flex h-11 w-full items-center gap-2.5 border-t px-4 text-left text-[13px] text-muted-foreground transition-colors animate-in fade-in hover:bg-foreground/[0.03] hover:text-foreground sm:px-6">
          <FaviconStack domains={cited.map((r) => r.domain)} />
          <span className="min-w-0 flex-1 truncate">
            {cited.length} {cited.length === 1 ? 'source' : 'sources'}
            <span className="text-muted-foreground/70"> · {[...new Set(cited.map((r) => r.domain.replace(/^(www|en|m)\./, '')))].slice(0, 3).join(', ')}</span>
          </span>
          <ChevronRight className="size-4 shrink-0" />
        </button>
      )}
    </Card>
    </div>
  );
}
