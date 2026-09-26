import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Loader2, Search } from 'lucide-react';
import type {
  AiResult, AiTask, ComponentKind, FillResult, Freshness, HealthResponse,
  KeyPoint, Layout, SearchResponse, SearchResult, Stat, SummaryLength, TimelineItem,
} from '../shared/types';
import { api } from './api';
import { withBrowserFallback } from './fallback';
import { ThreadCard, PlaceholderCard } from './ui';
import {
  AnswerBlock, ComparisonBlock, DiscussionBlock, GalleryBlock, KeyPointsBlock,
  KnowledgeBlock, ProsConsBlock, ResultsBlock, StatsBlock, StepsBlock, SummaryBlock, TimelineBlock,
} from './blocks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Card {
  id: number; icon: string; title: string; body?: string; bullets?: string[];
  url?: string; loading: boolean; error?: string;
}
interface Pinned { keyPoints: KeyPoint[]; stats: Stat[]; timeline: TimelineItem[] }
const EMPTY_PINS: Pinned = { keyPoints: [], stats: [], timeline: [] };

const FRESHNESS: { id: Freshness; label: string }[] = [
  { id: 'any', label: 'Any time' }, { id: 'day', label: '24h' }, { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' }, { id: 'year', label: 'Year' },
];
const SUGGESTIONS = ['iPhone 17 vs Pixel 10', 'how to make sourdough bread', 'history of the Roman Empire', 'Tokyo', 'what is quantum computing', 'best budget running shoes'];
const BLOCK_TITLES: Record<ComponentKind, string> = {
  answer: 'Quick answer', summary: 'Overview', knowledge: 'Profile', stats: 'By the numbers',
  timeline: 'Timeline', gallery: 'Pictures', key_points: 'Key points', comparison: 'Side by side',
  steps: 'Step by step', pros_cons: 'Pros & cons', discussion: 'Discussion', results: 'Sources',
};

let cardSeq = 0;

export default function App() {
  const initial = new URLSearchParams(location.search);
  const [input, setInput] = useState(initial.get('q') ?? '');
  const [query, setQuery] = useState('');
  const [freshness, setFreshness] = useState<Freshness>((initial.get('t') as Freshness) || 'any');
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [fill, setFill] = useState<FillResult | null>(null);
  const [ai, setAi] = useState<AiResult>({});
  const [aiPending, setAiPending] = useState<Set<AiTask>>(new Set());
  const [length, setLength] = useState<SummaryLength>('medium');
  const [simple, setSimple] = useState(false);
  const [pins, setPins] = useState<Pinned>(EMPTY_PINS);
  const [fresh, setFresh] = useState<string>();
  const [cards, setCards] = useState<Card[]>([]);
  const [phase, setPhase] = useState<'idle' | 'layout' | 'searching' | 'ready'>('idle');
  const [error, setError] = useState<string>();
  const [health, setHealth] = useState<HealthResponse>();
  const [selection, setSelection] = useState('');
  const [followup, setFollowup] = useState('');
  const [asking, setAsking] = useState(false);
  const runId = useRef(0);
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.health().then(setHealth).catch(() => undefined); }, []);

  const runGenerate = useCallback(async (s: SearchResponse, tasks: AiTask[], len: SummaryLength, simpleMode: boolean, id: number) => {
    if (!tasks.length) return;
    setAiPending((p) => new Set([...p, ...tasks]));
    try {
      const out = await api.generate({ query: s.query, tasks, length: len, simple: simpleMode, results: s.results.slice(0, 10), knowledge: s.knowledge });
      if (id === runId.current) setAi((prev) => ({ ...prev, ...out }));
    } catch (err) { console.error(err); } finally {
      if (id === runId.current) setAiPending((p) => new Set([...p].filter((t) => !tasks.includes(t))));
    }
  }, []);

  const runSearch = useCallback(async (q: string, t: Freshness = freshness) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const id = ++runId.current;
    setInput(trimmed); setQuery(trimmed);
    setPhase('layout'); setError(undefined);
    setSearch(null); setLayout(null); setFill(null); setAi({}); setAiPending(new Set());
    setPins(EMPTY_PINS); setCards([]); setSimple(false);
    const params = new URLSearchParams({ q: trimmed });
    if (t !== 'any') params.set('t', t);
    history.pushState(null, '', `?${params}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Phase 1: Jev picks layout from query alone (instant placeholders) + search in parallel.
    const layoutP = api.layout(trimmed).then((l) => { if (id === runId.current) { setLayout(l); setLength(l.summaryLength); } return l; }).catch((err) => { console.error('layout', err); return null; });
    setPhase('searching');

    let s: SearchResponse;
    try {
      s = await withBrowserFallback(await api.search(trimmed, t));
    } catch (err) {
      if (id !== runId.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase('ready'); return;
    }
    if (id !== runId.current) return;
    setSearch(s);
    if (!s.results.length) { setPhase('ready'); setError('No results from any engine. Try rephrasing.'); return; }

    const l = await layoutP;
    if (id !== runId.current) return;
    const planned = l?.blocks ?? ['results'];

    // Phase 2: fill from results + AI generate in parallel.
    setPhase('ready');
    api.fill(trimmed, s, planned).then((f) => { if (id === runId.current) setFill(f); }).catch((err) => console.error('fill', err));
    if (l) void runGenerate(s, l.aiTasks, l.summaryLength, false, id);
  }, [freshness, runGenerate]);

  useEffect(() => {
    if (initial.get('q')) void runSearch(initial.get('q')!);
    const onPop = () => { const q = new URLSearchParams(location.search).get('q'); if (q) void runSearch(q); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onSelect = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (text.length >= 3 && sel?.anchorNode && areaRef.current?.contains(sel.anchorNode)) setSelection(text.slice(0, 1200));
      else if (!text) setSelection('');
    };
    document.addEventListener('selectionchange', onSelect);
    return () => document.removeEventListener('selectionchange', onSelect);
  }, []);

  const addCard = (card: Omit<Card, 'id'>) => { const id = ++cardSeq; setCards((c) => [{ ...card, id }, ...c]); return id; };
  const updateCard = (id: number, patch: Partial<Card>) => setCards((c) => c.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const flash = (k: string) => { setFresh(k); setTimeout(() => setFresh(undefined), 1600); };
  const pinKeyPoint = (text: string) => { setPins((p) => ({ ...p, keyPoints: [{ text }, ...p.keyPoints] })); flash(text); };
  const clearSelection = () => { window.getSelection()?.removeAllRanges(); setSelection(''); };

  const explain = async (text: string) => {
    if (!search) return;
    const id = addCard({ icon: '💡', title: `Explain: “${text.length > 60 ? `${text.slice(0, 60)}…` : text}”`, loading: true });
    try {
      const out = await api.ask({ query, question: `Explain this in plain words: "${text}"`, results: search.results.slice(0, 8) });
      if (out.kind === 'answer') updateCard(id, { body: out.answer, loading: false });
      else updateCard(id, { body: 'Not enough context — searching instead.', loading: false });
      if (out.kind === 'search') void runSearch(out.query);
    } catch (err) { updateCard(id, { error: String(err), loading: false }); }
  };

  const autoPlace = async (text: string) => {
    clearSelection();
    try {
      const out = await api.slot(query, text);
      switch (out.slot) {
        case 'key_point': pinKeyPoint(text); break;
        case 'stat': if (out.stat) { setPins((p) => ({ ...p, stats: [out.stat!, ...p.stats] })); flash(out.stat.value); } break;
        case 'timeline': if (out.timeline) { setPins((p) => ({ ...p, timeline: [...p.timeline, out.timeline!] })); flash(out.timeline.text); } break;
        case 'search': void runSearch(text); break;
        case 'explain': void explain(text); break;
        default: { const u: never = out.slot; throw new Error(`Unknown slot ${u}`); }
      }
    } catch { pinKeyPoint(text); }
  };

  const digest = async (r: SearchResult) => {
    const id = addCard({ icon: '📖', title: r.title, url: r.url, loading: true });
    try { const out = await api.read(r.url, query); updateCard(id, { body: out.tldr, bullets: out.bullets, loading: false }); }
    catch (err) { updateCard(id, { error: err instanceof Error ? err.message : String(err), loading: false }); }
  };

  const askFollowup = async (question: string) => {
    if (!search || !question.trim()) return;
    setAsking(true); setFollowup('');
    const id = addCard({ icon: '🙋', title: question, loading: true });
    try {
      const out = await api.ask({ query, question, results: search.results.slice(0, 10) });
      if (out.kind === 'answer') updateCard(id, { body: out.answer, loading: false });
      else { setCards((c) => c.filter((x) => x.id !== id)); void runSearch(out.query); }
    } catch (err) { updateCard(id, { error: err instanceof Error ? err.message : String(err), loading: false }); }
    finally { setAsking(false); }
  };

  const regenSummary = (len: SummaryLength, simpleMode: boolean) => {
    setLength(len); setSimple(simpleMode);
    if (search) void runGenerate(search, ['summary'], len, simpleMode, runId.current);
  };

  const onSubmit = (e: FormEvent) => { e.preventDefault(); void runSearch(input); };

  // Resolve final blocks: start from layout plan, override with fill's pruned blocks, add pinned.
  const plannedBlocks = layout?.blocks ?? (search ? ['results'] : []);
  const blocks: ComponentKind[] = fill?.blocks ?? plannedBlocks;
  const ensure = (kind: ComponentKind, has: boolean) => { if (has && !blocks.includes(kind)) blocks.splice(Math.max(blocks.indexOf('results'), 0), 0, kind); };
  ensure('key_points', pins.keyPoints.length > 0);
  ensure('stats', pins.stats.length > 0);
  ensure('timeline', pins.timeline.length > 0);

  const statsData = [...pins.stats, ...(fill?.stats ?? [])];
  const timelineData = [...(fill?.timeline ?? []), ...pins.timeline].sort((a, b) => Number(a.when) - Number(b.when));
  const keyPointsData = [...pins.keyPoints, ...(fill?.keyPoints ?? [])];
  const searching = phase === 'layout' || phase === 'searching';

  const renderBlock = (kind: ComponentKind): ReactNode => {
    if (!search && kind !== 'results') return <PlaceholderCard key={kind} kind={kind} title={BLOCK_TITLES[kind]} />;
    switch (kind) {
      case 'answer': return fill?.answer ? <AnswerBlock answer={fill.answer} /> : null;
      case 'summary':
        return <SummaryBlock text={ai.summary} loading={aiPending.has('summary') || (!fill && !!layout)} length={length} simple={simple} results={search?.results ?? []} onLength={(l) => regenSummary(l, simple)} onSimple={(s) => regenSummary(length, s)} />;
      case 'knowledge': return search?.knowledge ? <KnowledgeBlock k={search.knowledge} /> : null;
      case 'stats': return statsData.length ? <StatsBlock stats={statsData} fresh={fresh} /> : null;
      case 'timeline': return timelineData.length ? <TimelineBlock items={timelineData} fresh={fresh} /> : null;
      case 'gallery': return search?.images?.length ? <GalleryBlock images={search.images} /> : null;
      case 'key_points': return keyPointsData.length ? <KeyPointsBlock points={keyPointsData} fresh={fresh} /> : null;
      case 'comparison': return <ComparisonBlock data={ai.comparison} loading={aiPending.has('comparison') || (!fill && !!layout)} />;
      case 'steps': return <StepsBlock steps={ai.steps} loading={aiPending.has('steps') || (!fill && !!layout)} />;
      case 'pros_cons': return <ProsConsBlock pros={ai.pros} cons={ai.cons} loading={aiPending.has('pros_cons') || (!fill && !!layout)} />;
      case 'discussion': return search?.discussions?.length ? <DiscussionBlock items={search.discussions} /> : null;
      case 'results': return search ? <ResultsBlock results={search.results} onRead={digest} onSearch={(prefix) => runSearch(prefix + query)} /> : null;
      default: { const u: never = kind; throw new Error(`Unknown block ${u}`); }
    }
  };

  const home = phase === 'idle';

  return (
    <div className={cn('mx-auto max-w-3xl px-3 pb-28', home && 'flex min-h-screen flex-col items-center justify-center')}>
      <header className={cn('sticky top-0 z-20 bg-background/80 backdrop-blur-xl', home ? 'static w-full max-w-xl' : 'py-3')}>
        {!home ? (
          <div className="flex items-center gap-2">
            <button onClick={() => { runId.current++; setPhase('idle'); setSearch(null); setInput(''); history.pushState(null, '', '/'); }} className="flex items-center gap-1.5 text-lg font-bold">
              <span className="text-xl">🔮</span> Jevi
            </button>
            <form className="flex flex-1 items-center gap-1.5" onSubmit={onSubmit}>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search anything, see it visually…" className="h-11 rounded-full pl-9 pr-12" enterKeyHint="search" />
                <Button type="submit" size="icon" className="absolute right-1 top-1/2 size-9 -translate-y-1/2 rounded-full">
                  {searching ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-2 text-4xl font-bold"><span className="text-5xl">🔮</span> Jevi</div>
            <form className="relative w-full" onSubmit={onSubmit}>
              <Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
              <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search anything, see it visually…" className="h-14 rounded-full pl-12 pr-14 text-base shadow-lg" autoFocus enterKeyHint="search" />
              <Button type="submit" size="icon" className="absolute right-2 top-1/2 size-10 -translate-y-1/2 rounded-full">
                {searching ? <Loader2 className="size-5 animate-spin" /> : <ArrowRight className="size-5" />}
              </Button>
            </form>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => <Button key={s} variant="secondary" className="rounded-full text-sm" onClick={() => runSearch(s)}>{s}</Button>)}
            </div>
          </>
        )}
        {!home && (
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FRESHNESS.map((f) => (
              <Button key={f.id} size="sm" variant={freshness === f.id ? 'default' : 'outline'} className="h-7 shrink-0 rounded-full px-2.5 text-xs" onClick={() => { setFreshness(f.id); void runSearch(query, f.id); }}>{f.label}</Button>
            ))}
          </div>
        )}
      </header>

      {!home && (
        <main ref={areaRef} className="mt-2 space-y-3">
          {layout && (
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="secondary" className="capitalize">{layout.engine === 'jev' ? '🧠 Jev' : '⚙️ Auto'} · {layout.intent.replace('_', ' ')}</Badge>
              {layout.intentConfidence > 0 && <span className="text-muted-foreground">{Math.round(layout.intentConfidence * 100)}% confidence</span>}
              <span className="ml-auto text-muted-foreground">{search ? `${search.results.length} results` : 'searching…'}</span>
            </div>
          )}

          {layout && layout.actions.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {layout.actions.map((a) => (
                <Button key={a.id} size="sm" variant="secondary" className="h-7 shrink-0 rounded-full px-3 text-xs" onClick={() => runSearch(a.query)}>{a.label}</Button>
              ))}
            </div>
          )}

          {error && <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

          {cards.map((c) => (
            <ThreadCard key={c.id} icon={c.icon} title={c.title} body={c.body} bullets={c.bullets} url={c.url} loading={c.loading} error={c.error} onClose={() => setCards((cs) => cs.filter((x) => x.id !== c.id))} />
          ))}

          <div className="grid gap-3 lg:grid-cols-2">
            {blocks.map((k) => {
              const node = renderBlock(k);
              return node ? <div key={k} className={cn('animate-in fade-in slide-in-from-bottom-2 duration-500', (k === 'answer' || k === 'summary' || k === 'results' || k === 'comparison' || k === 'gallery') && 'lg:col-span-2')}>{node}</div> : null;
            })}
          </div>

          {search && search.results.length > 0 && (
            <>
              {(ai.followups?.length ?? 0) > 0 && (
                <div className="flex flex-wrap justify-center gap-2 pt-2">
                  {ai.followups!.map((f) => <Button key={f} variant="outline" className="rounded-full text-sm" onClick={() => askFollowup(f)}>💭 {f}</Button>)}
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-1.5 pt-1 text-[11px]">
                {search.engines.map((e) => (
                  <span key={e.name} title={e.ok ? `${e.count} results in ${e.ms}ms` : e.error} className={cn('rounded-full border px-2 py-0.5', e.ok && e.count ? 'text-emerald-500' : 'text-muted-foreground')}>● {e.name}</span>
                ))}
                {health && !health.deepseek && <span className="rounded-full border px-2 py-0.5 text-muted-foreground">● deepseek off</span>}
                {health && !health.jev && <span className="rounded-full border px-2 py-0.5 text-muted-foreground">● jev off</span>}
              </div>
              <p className="pt-1 text-center text-xs text-muted-foreground">Tip: highlight any text above to pin it, explain it, or search it.</p>
            </>
          )}
        </main>
      )}

      {!home && search && (
        <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-background via-background/80 to-transparent px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-6">
          {selection ? (
            <div className="mx-auto flex max-w-2xl items-center gap-1.5 rounded-full border bg-card p-1.5 shadow-lg" onMouseDown={(e) => e.preventDefault()}>
              <span className="flex-1 truncate px-2 text-xs text-muted-foreground">“{selection.length > 40 ? `${selection.slice(0, 40)}…` : selection}”</span>
              <Button size="sm" className="h-7 rounded-full px-3 text-xs" onClick={() => autoPlace(selection)}>🧠 Place</Button>
              <Button size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-xs" onClick={() => { pinKeyPoint(selection); clearSelection(); }}>📌</Button>
              <Button size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-xs" onClick={() => { const t = selection; clearSelection(); void explain(t); }}>💡</Button>
              <Button size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-xs" onClick={() => { const t = selection; clearSelection(); void runSearch(t); }}>🔎</Button>
            </div>
          ) : (
            <form className="mx-auto flex max-w-2xl items-center gap-1.5 rounded-full border bg-card p-1.5 shadow-lg" onSubmit={(e) => { e.preventDefault(); void askFollowup(followup); }}>
              <Input value={followup} onChange={(e) => setFollowup(e.target.value)} placeholder="Ask a follow-up…" className="h-9 flex-1 border-0 bg-transparent focus-visible:ring-0" enterKeyHint="send" />
              <Button type="submit" size="icon" className="size-9 rounded-full" disabled={asking || !followup.trim()}>{asking ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}</Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
