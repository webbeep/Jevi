import { Component, useRef, type ReactNode, Suspense, lazy } from 'react';
import type { CardNode, Gap } from '../../shared/card';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DiagramView } from './DiagramView';
import { Icon } from './Icon';
import { AccordionNode, Choices, Pricing, Reveal, Scaler, SliderNode } from './interactive';
import {
  Actions, Badges, Callout, CodeView, Draft, Gallery, Heading, Hero, ImageView, KeyValue, Links, List, Profile,
  ProgressView, ProsCons, Quote, Rating, SlotView, StatView, Steps, TableView, Text, Tile, Timeline, TONE_TEXT, VideoView,
  TilePictures, wantsPicture,
} from './primitives';

const ChartView = lazy(() => import('./ChartView'));
const TickerView = lazy(() => import('./TickerView'));

const GAP: Record<Gap, string> = { sm: 'gap-1.5 sm:gap-2', md: 'gap-2 sm:gap-3', lg: 'gap-3 sm:gap-5' };
/** A 2-column grid with an odd last child spans that child, so the row does not end in an empty cell. The class is written out in full so the stylesheet picks it up. */
const COLS = { 2: 'grid-cols-2 [&>*:last-child:nth-child(odd)]:col-span-2', 3: 'grid-cols-2 sm:grid-cols-3 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2', 4: 'grid-cols-2 sm:grid-cols-4' } as const;
const WIDE_COLS = { 2: 'sm:grid-cols-2 sm:[&>*:last-child:nth-child(odd)]:col-span-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' } as const;
const ALIGN = { start: 'sm:items-start', center: 'sm:items-center', end: 'sm:items-end', between: 'sm:items-center sm:justify-between' } as const;

/** Whether a node is (or contains) a placeholder, so swapping it for real content remounts and animates it. */
function hasSlot(n: CardNode): boolean {
  return n.type === 'slot' || ('children' in n && n.children.some(hasSlot));
}

/** A video row skips the rise. That animation is a transform, and a transformed ancestor makes the embed update late. */
export function hasVideo(n: CardNode): boolean {
  if (n.type === 'video') return true;
  if (n.type === 'tabs') return n.tabs.some((tab) => tab.children.some(hasVideo));
  return 'children' in n && n.children.some(hasVideo);
}

/** Small nodes that should stay side by side even on phones. */
function isCompact(n: CardNode): boolean {
  return n.type === 'tile' || n.type === 'stat' || (n.type === 'slot' && n.shape === 'tile');
}

/**
 * The cell fills the row. The row is only as tall as its tallest content, so a short
 * sibling lines its border up instead of leaving a hole under itself.
 * flex-1 reports that content as the cell's minimum size, then grows into the row.
 */
const FILL_CELL = 'flex min-w-0 flex-col [&>*]:max-w-full [&>*]:flex-1';

/**
 * One width for every kind of cell. It is as wide as its own content, at least a
 * tap target, and never wider than the card allows (18rem, or 78% of the strip on
 * a phone so the next cell peeks). A new component follows this without being named.
 */
/**
 * The border hugs the text. w-full here stretched a short tile out to the cap, so the
 * next cell's centered text sat past the peek and the peek looked like an empty box.
 */
const STRIP_CELL = 'w-max min-w-[7.5rem] max-w-[min(18rem,78cqw)] shrink-0 snap-start [&>*]:w-max [&>*]:max-w-full';

/** A sideways strip scrolls by touch. The bar itself is hidden: it was drawing in the hole under a short cell and adding height the content does not need. */
const TRACK = 'no-scrollbar min-w-0 max-w-full touch-pan-x overflow-x-auto overscroll-x-contain';

/** One malformed node from the model hides itself instead of taking down the card (or the app). */
class NodeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error('card node failed to render', err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The entrance runs once, when the row mounts. Turning stagger on later (the stream finishing, a
 * review landing) must not set animation-delay after the fact: that restarts zo-rise, flashes the
 * card, and a transform on this row pauses or reloads a video that is already playing.
 */
function EnterRow({ play, delayMs, children }: { play: boolean; delayMs?: number; children: ReactNode }) {
  const once = useRef({ play, delayMs });
  const entered = once.current.play;
  const delay = once.current.delayMs;
  return (
    <div className={cn('min-w-0', entered && 'zo-rise')} style={entered && delay != null ? { animationDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

export function Nodes({ nodes, className, stagger = false }: { nodes: CardNode[]; className?: string; stagger?: boolean }) {
  // Real nodes are keyed by type and occurrence, not position: parallel regions arrive out of order and
  // leave gaps, and a positional key would remount (and reset) every node after a gap that fills in.
  // A placeholder is keyed by the number of real nodes before it, so the skeleton trailing the revealed
  // prefix is a NEW element each time one lands — a moved skeleton would count as a layout shift.
  const seen: Record<string, number> = {};
  let real = 0;
  return (
    <div className={cn('flex w-full min-w-0 flex-col gap-4', className)}>
      {nodes.filter((n) => n.type !== 'citations').map((n, i) => {
        const placeholder = hasSlot(n);
        if (!placeholder) seen[n.type] = (seen[n.type] ?? 0) + 1;
        const key = placeholder ? `placeholder-${i}-${real}` : `${n.type}-${seen[n.type]}`;
        if (!placeholder) real += 1;
        const enter = (!placeholder || stagger) && !hasVideo(n);
        return (
          <EnterRow key={key} play={enter} delayMs={enter && stagger ? i * 55 : undefined}>
            <NodeBoundary>
              <NodeView node={n} />
            </NodeBoundary>
          </EnterRow>
        );
      })}
    </div>
  );
}

export function NodeView({ node }: { node: CardNode }): ReactNode {
  switch (node.type) {
    case 'stack': {
      if (!node.children.length) return null;
      const row = node.direction === 'row';
      const compact = row && node.children.every(isCompact);
      // Three or more small cells can't share a phone's width (labels overflowed ~90px tiles): two-up there, one row from sm.
      if (compact && node.children.length > 2) {
        const n = node.children.length;
        return (
          <TilePictures.Provider value={node.children.some(wantsPicture)}>
            <div className={cn('grid min-w-0 items-stretch grid-cols-2', n % 2 === 1 && '[&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1', n <= 4 ? (n === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4') : 'sm:grid-cols-3', GAP[node.gap ?? 'md'])}>
              {node.children.map((c, i) => <div key={i} className={cn(FILL_CELL, '[&>*]:min-w-0')}><NodeView node={c} /></div>)}
            </div>
          </TilePictures.Provider>
        );
      }
      return (
        <TilePictures.Provider value={node.children.some(wantsPicture)}>
          <div className={cn('flex min-w-0 max-w-full items-stretch', GAP[node.gap ?? 'md'], compact ? TRACK : row ? cn('flex-col sm:flex-row', ALIGN[node.align ?? 'start'], node.wrap && 'sm:flex-wrap') : 'flex-col')}>
            {node.children.map((c, i) => <div key={i} className={cn(FILL_CELL, '[&>*]:min-w-0', compact ? 'flex-1' : row && 'sm:flex-1')}><NodeView node={c} /></div>)}
          </div>
        </TilePictures.Provider>
      );
    }
    case 'grid':
      if (!node.children.length) return null;
      // Only small cells (tiles, stats) stay two-up on phones; larger blocks get the full width.
      // Each cell fills the row so a one-line tile lines up with a neighbor that wraps.
      return (
        <TilePictures.Provider value={node.children.some(wantsPicture)}>
          <div className={cn('grid min-w-0 items-stretch', node.children.every(isCompact) ? COLS[node.cols] : WIDE_COLS[node.cols], GAP[node.gap ?? 'md'])}>
            {node.children.map((c, i) => <div key={i} className={cn(FILL_CELL, '[&>*]:min-w-0')}><NodeView node={c} /></div>)}
          </div>
        </TilePictures.Provider>
      );
    case 'section':
      return (
        <section className="space-y-2 sm:space-y-3">
          {node.title && (
            <h3 className={cn('flex items-center gap-2 zo-label', node.tone && TONE_TEXT[node.tone])}>
              <Icon name={node.icon} className="size-3.5" />{node.title}
            </h3>
          )}
          <Nodes nodes={node.children} className="gap-2.5 sm:gap-3" />
        </section>
      );
    case 'tabs':
      return (
        <Tabs defaultValue="0" className="gap-3">
          <div className="no-scrollbar w-full overflow-x-auto overscroll-x-contain">
            <TabsList className="w-max">
              {node.tabs.map((t, i) => <TabsTrigger key={i} value={String(i)}>{t.label}</TabsTrigger>)}
            </TabsList>
          </div>
          {node.tabs.map((t, i) => <TabsContent key={i} value={String(i)}><Nodes nodes={t.children} className="gap-3" /></TabsContent>)}
        </Tabs>
      );
    case 'scroller': {
      if (!node.children.length) return null;
      // One cell has nothing to scroll to. A strip would leave it short, with empty card beside it.
      if (node.children.length === 1) {
        return (
          <TilePictures.Provider value={node.children.some(wantsPicture)}>
            <div className={cn(FILL_CELL, '[&>*]:min-w-0')}><NodeView node={node.children[0]!} /></div>
          </TilePictures.Provider>
        );
      }
      return (
        <TilePictures.Provider value={node.children.some(wantsPicture)}>
          <div className={cn('@container snap-x snap-mandatory', TRACK)}>
            <div className="flex w-max items-stretch gap-2">
              {node.children.map((c, i) => (
                <div key={i} className={cn(FILL_CELL, STRIP_CELL)}>
                  <NodeView node={c} />
                </div>
              ))}
            </div>
          </div>
        </TilePictures.Provider>
      );
    }
    case 'divider':
      return <Separator />;
    case 'hero': return <Hero node={node} />;
    case 'heading': return <Heading node={node} />;
    case 'text': return <Text node={node} />;
    case 'stat': return <StatView node={node} />;
    case 'tile': return <Tile node={node} />;
    case 'keyvalue': return <KeyValue node={node} />;
    case 'list': return <List node={node} />;
    case 'chart': return <Suspense fallback={<SlotView node={{ type: 'slot', hint: 'chart', shape: 'chart' }} />}><ChartView node={node} /></Suspense>;
    case 'ticker': return <Suspense fallback={<SlotView node={{ type: 'slot', hint: 'chart', shape: 'chart' }} />}><TickerView node={node} /></Suspense>;
    case 'progress': return <ProgressView node={node} />;
    case 'rating': return <Rating node={node} />;
    case 'table': return <TableView node={node} />;
    case 'timeline': return <Timeline node={node} />;
    case 'steps': return <Steps node={node} />;
    case 'diagram': return <DiagramView node={node} />;
    case 'proscons': return <ProsCons node={node} />;
    case 'badges': return <Badges node={node} />;
    case 'quote': return <Quote node={node} />;
    case 'callout': return <Callout node={node} />;
    case 'draft': return <Draft node={node} />;
    case 'links': return <Links node={node} />;
    case 'video': return <VideoView node={node} />;
    case 'code': return <CodeView node={node} />;
    case 'image': return <ImageView node={node} />;
    case 'gallery': return <Gallery node={node} />;
    case 'profile': return <Profile node={node} />;
    case 'actions': return <Actions node={node} />;
    // Cited sources are listed once, in the card's footer.
    case 'citations': return null;
    case 'slot': return <SlotView node={node} />;
    case 'choices': return <Choices node={node} />;
    case 'slider': return <SliderNode node={node} />;
    case 'scaler': return <Scaler node={node} />;
    case 'pricing': return <Pricing node={node} />;
    case 'accordion': return <AccordionNode node={node} />;
    case 'reveal': return <Reveal node={node} />;
    default: {
      const unreachable: never = node;
      throw new Error(`Unknown node ${JSON.stringify(unreachable)}`);
    }
  }
}
