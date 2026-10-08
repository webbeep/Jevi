import { useMemo } from 'react';
import { ChevronRight, Image as ImageIcon, Loader2, MoreHorizontal, RefreshCw } from 'lucide-react';
import type { AnswerCard, CardNode, CardPattern } from '../../shared/card';
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { citedRefs } from '../library';
import { LogoMark } from '../Logo';
import { FaviconStack } from '../Sources';
import { useCard } from './context';
import { Icon } from './Icon';
import { Nodes } from './render';

/** Every picture shown on the card, by URL. */
function pictureSources(body: CardNode[], images: { thumb: string }[]): string[] {
  const out: string[] = [];
  const ref = (i?: number) => (i !== undefined ? images[i]?.thumb : undefined);
  const walk = (n: CardNode) => {
    switch (n.type) {
      case 'tile':
      case 'profile':
        out.push(n.imageSrc ?? ref(n.imageRef) ?? '');
        break;
      case 'list':
        n.items.forEach((i) => out.push(i.imageSrc ?? ref(i.imageRef) ?? ''));
        break;
      case 'image':
        out.push(n.src ?? ref(n.ref) ?? '');
        break;
      case 'gallery':
        (n.pics?.length ? n.pics.map((p) => p.src) : n.refs.map((r) => ref(r) ?? '')).forEach((src) => out.push(src));
        break;
      case 'tabs':
        n.tabs.forEach((t) => t.children.forEach(walk));
        break;
      default:
        if ('children' in n) n.children.forEach(walk);
    }
  };
  body.forEach(walk);
  return [...new Set(out.filter(Boolean))];
}

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
  const { images, credits, results, onSources } = useCard();
  const credited = useMemo(
    () => (filling ? [] : pictureSources(card.body, images).flatMap((src) => (credits[src] ? [{ src, ...credits[src] }] : []))),
    [filling, card.body, images, credits],
  );
  const cited = useMemo(() => (filling ? [] : citedRefs(card).flatMap((n) => (results[n - 1] ? [results[n - 1]] : []))), [filling, card, results]);
  return (
    <div className="relative isolate rounded-2xl">
    <div className="zo-aura" data-on={filling} />
    <Card className="relative gap-0 overflow-hidden rounded-2xl py-0 shadow-card">
      <div className="flex items-start gap-2.5 pb-1 pl-4 pr-2 pt-3.5 sm:gap-3 sm:pl-6 sm:pr-3 sm:pt-5">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background sm:size-9">
          {filling && !card.icon ? <LogoMark className="size-4 animate-pulse" /> : <Icon name={card.icon} fallback="layout-grid" className="size-4 text-foreground/80 sm:size-[18px]" />}
        </div>
        <div className="min-w-0 flex-1 self-center">
          <h2 className="text-balance text-[16.5px] font-semibold leading-[1.3] tracking-[-0.02em] sm:text-[17px]">{card.title}</h2>
          {filling && !card.subtitle ? <Skeleton className="mt-1 h-3 w-32" /> : card.subtitle && <p className="mt-0.5 text-pretty text-[13px] leading-snug text-muted-foreground">{card.subtitle}</p>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label="Card options">
<MoreHorizontal className="size-4" />
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
            {credited.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><ImageIcon className="size-4 text-muted-foreground" />Image credits</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 w-72 overflow-y-auto">
                  {credited.map((c) => (
                    <DropdownMenuItem key={c.src} asChild>
                      <a href={c.link} target="_blank" rel="noopener noreferrer" className="gap-2.5">
                        <img src={c.src} alt="" className="size-8 shrink-0 rounded-md object-cover" />
                        <span className="min-w-0 flex-1 truncate text-xs">{c.credit}</span>
                      </a>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {engine && (
              <>
                <DropdownMenuSeparator />
                <p className="whitespace-pre-line px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">{engine}</p>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {status && (
        <div className="mx-4 mt-2 flex items-center gap-2 text-[13px] text-muted-foreground animate-in fade-in sm:mx-6">
          <Loader2 className="size-3.5 animate-spin" />
          <span className="truncate">{status}</span>
        </div>
      )}

      <div className={cn('px-4 pb-5 pt-3.5 transition-[opacity,filter] duration-300 sm:px-6 sm:pb-6 sm:pt-4', status && !streaming && 'pointer-events-none opacity-50 blur-[1px]', cited.length && 'pb-4 sm:pb-5')}>
        <Nodes key={version} nodes={card.body} className="gap-5" stagger={!streaming} />
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
