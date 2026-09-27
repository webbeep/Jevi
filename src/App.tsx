import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Lightbulb, Loader2, Moon, Pin, Search, Sparkles, Sun, Wand2 } from 'lucide-react';
import type { AnswerCard, CardNode, CardResponse, LayoutPlan } from '../shared/card';
import type { Freshness, SearchResponse, SearchResult } from '../shared/types';
import { api } from './api';
import { withBrowserFallback } from './fallback';
import { AnswerCardView } from './card/AnswerCardView';
import { CardContext } from './card/context';
import { Sources } from './Sources';
import { type Thread, ThreadCard } from './ui';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TooltipProvider } from '@/components/ui/tooltip';

const FRESHNESS: { id: Freshness; label: string }[] = [
  { id: 'any', label: 'Any time' }, { id: 'day', label: 'Today' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'year', label: 'Year' },
];
const SUGGESTIONS = ['weather in Tokyo', 'how to make sourdough bread', 'iPhone 17 vs Pixel 10', 'history of the Roman Empire', 'what is quantum computing', 'best budget running shoes'];

const LOADING_SKELETON: CardNode[] = [
  { type: 'slot', hint: 'answer', shape: 'hero' },
  { type: 'slot', hint: 'details', shape: 'block' },
];

let threadSeq = 0;

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && matchMedia('(prefers-color-scheme: dark)').matches));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);
  return [dark, setDark] as const;
}

export default function App() {
  const initial = useMemo(() => new URLSearchParams(location.search), []);
  const [dark, setDark] = useTheme();
  const [input, setInput] = useState(initial.get('q') ?? '');
  const [query, setQuery] = useState('');
  const [freshness, setFreshness] = useState<Freshness>((initial.get('t') as Freshness) || 'any');
  const [plan, setPlan] = useState<LayoutPlan | null>(null);
  const [pattern, setPattern] = useState<string>();
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [result, setResult] = useState<CardResponse | null>(null);
  const [filling, setFilling] = useState(false);
  const [simple, setSimple] = useState(false);
  const [pins, setPins] = useState<CardNode[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [error, setError] = useState<string>();
  const [selection, setSelection] = useState('');
  const [followup, setFollowup] = useState('');
  const [asking, setAsking] = useState(false);
  const runId = useRef(0);
  const areaRef = useRef<HTMLDivElement>(null);
  const home = !query;

  const design = useCallback(async (s: SearchResponse, p: LayoutPlan, patternId: string, simpleMode: boolean, id: number) => {
    setFilling(true);
    try {
      const out = await api.card({ query: s.query, pattern: patternId, depth: p.depth, readPages: p.readPages, search: s, simple: simpleMode });
      if (id === runId.current) setResult(out);
    } catch (err) {
      if (id === runId.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === runId.current) setFilling(false);
    }
  }, []);

  const runSearch = useCallback(async (q: string, t: Freshness = freshness) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const id = ++runId.current;
    setInput(trimmed); setQuery(trimmed); setError(undefined);
    setPlan(null); setPattern(undefined); setSearch(null); setResult(null); setSimple(false); setPins([]); setThreads([]); setFilling(true);
    const params = new URLSearchParams({ q: trimmed });
    if (t !== 'any') params.set('t', t);
    history.pushState(null, '', `?${params}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const planP = api.plan(trimmed).then((p) => {
      if (id === runId.current) { setPlan(p); setPattern(p.pattern); }
      return p;
    });
    try {
      const s = await withBrowserFallback(await api.search(trimmed, t));
      if (id !== runId.current) return;
      setSearch(s);
      if (!s.results.length) throw new Error('No results from any engine. Try rephrasing.');
      const p = await planP;
      if (id !== runId.current) return;
      await design(s, p, p.pattern, false, id);
    } catch (err) {
      if (id !== runId.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setFilling(false);
    }
  }, [freshness, design]);

  useEffect(() => {
    const q = initial.get('q');
    if (q) void runSearch(q);
    const onPop = () => {
      const next = new URLSearchParams(location.search).get('q');
      if (next) void runSearch(next);
    };
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

  const addThread = (t: Omit<Thread, 'id'>) => {
    const id = ++threadSeq;
    setThreads((all) => [{ ...t, id }, ...all]);
    return id;
  };
  const updateThread = (id: number, patch: Partial<Thread>) => setThreads((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

  const ask = async (question: string) => {
    if (!search || !question.trim()) return;
    setAsking(true);
    setFollowup('');
    const id = addThread({ icon: 'message-circle-question', title: question, loading: true });
    try {
      const out = await api.ask({ query, question, results: search.results.slice(0, 10) });
      if (out.kind === 'answer') updateThread(id, { body: out.answer, loading: false });
      else {
        setThreads((all) => all.filter((t) => t.id !== id));
        void runSearch(out.query);
      }
    } catch (err) {
      updateThread(id, { error: errMsg(err), loading: false });
    } finally {
      setAsking(false);
    }
  };

  const digest = async (r: SearchResult) => {
    const id = addThread({ icon: 'book-open', title: r.title, url: r.url, loading: true });
    try {
      const out = await api.read(r.url, query);
      updateThread(id, { body: out.tldr, bullets: out.bullets, loading: false });
    } catch (err) {
      updateThread(id, { error: errMsg(err), loading: false });
    }
  };

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelection('');
  };

  const pin = (node: CardNode) => setPins((p) => [...p, node]);

  const place = async (text: string) => {
    clearSelection();
    try {
      const out = await api.slot(query, text);
      switch (out.slot) {
        case 'key_point': pin({ type: 'list', style: 'icon', items: [{ text, icon: 'pin' }] }); break;
        case 'stat': if (out.stat) pin({ type: 'stat', label: out.stat.label, value: out.stat.value, icon: 'hash' }); break;
        case 'timeline': if (out.timeline) pin({ type: 'timeline', items: [{ when: out.timeline.when, title: out.timeline.text }] }); break;
        case 'search': void runSearch(text); break;
        case 'explain': void ask(`Explain in plain words: "${text}"`); break;
        default: {
          const unreachable: never = out.slot;
          throw new Error(`Unknown slot ${unreachable}`);
        }
      }
    } catch {
      pin({ type: 'list', style: 'icon', items: [{ text, icon: 'pin' }] });
    }
  };

  const redesign = (patternId: string, simpleMode: boolean) => {
    setPattern(patternId);
    setSimple(simpleMode);
    if (search && plan) void design(search, plan, patternId, simpleMode, runId.current);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void runSearch(input);
  };

  const card: AnswerCard = useMemo(() => {
    const base = result?.card ?? plan?.skeleton ?? { title: query, body: LOADING_SKELETON };
    return pins.length ? { ...base, body: [...base.body, { type: 'section', title: 'Pinned by you', icon: 'pin', children: pins }] } : base;
  }, [result, plan, query, pins]);

  const searchBox = (
    <form onSubmit={onSubmit} className="relative w-full">
      <Search className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground', home ? 'left-4 size-5' : 'left-3 size-4')} />
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Ask anything…"
        enterKeyHint="search"
        autoFocus={home}
        className={cn('rounded-full bg-card shadow-xs', home ? 'h-14 pl-12 pr-14 text-base md:text-base' : 'h-10 pl-9 pr-11')}
      />
      <Button type="submit" size="icon" className={cn('absolute top-1/2 -translate-y-1/2 rounded-full', home ? 'right-2 size-10' : 'right-1 size-8')} aria-label="Search">
        {filling && !home ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
      </Button>
    </form>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-dvh">
        <header className={cn('z-30', home ? '' : 'sticky top-0 border-b bg-background/80 backdrop-blur-xl')}>
          <div className={cn('mx-auto flex max-w-2xl items-center gap-3 px-4', home ? 'justify-end py-4' : 'py-2.5')}>
            {!home && (
              <button onClick={() => { runId.current++; setQuery(''); setInput(''); history.pushState(null, '', '/'); }} className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
                <span className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background"><Sparkles className="size-3.5" /></span>
                <span className="hidden sm:inline">Jevi</span>
              </button>
            )}
            {!home && searchBox}
            <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full" onClick={() => setDark(!dark)} aria-label="Toggle theme">
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </header>

        {home ? (
          <main className="mx-auto flex min-h-[80dvh] max-w-xl flex-col items-center justify-center px-4 pb-24">
            <span className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-foreground text-background shadow-lg"><Sparkles className="size-5" /></span>
            <h1 className="text-3xl font-semibold tracking-tight">What do you want to see?</h1>
            <p className="mt-2 text-center text-sm text-muted-foreground">Every answer is a card designed for your question.</p>
            <div className="mt-8 w-full">{searchBox}</div>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="outline" size="sm" className="rounded-full font-normal text-muted-foreground" onClick={() => runSearch(s)}>{s}</Button>
              ))}
            </div>
          </main>
        ) : (
          <main ref={areaRef} className="mx-auto max-w-2xl space-y-4 px-4 pb-36 pt-4">
            <ToggleGroup type="single" size="sm" value={freshness} onValueChange={(v) => { if (v) { setFreshness(v as Freshness); void runSearch(query, v as Freshness); } }} className="no-scrollbar -mx-4 w-auto justify-start overflow-x-auto px-4">
              {FRESHNESS.map((f) => <ToggleGroupItem key={f.id} value={f.id} className="h-7 shrink-0 rounded-full px-3 text-xs data-[state=on]:bg-foreground data-[state=on]:text-background">{f.label}</ToggleGroupItem>)}
            </ToggleGroup>

            {threads.map((t) => <ThreadCard key={t.id} thread={t} onClose={() => setThreads((all) => all.filter((x) => x.id !== t.id))} />)}

            {error && !result ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{error}</div>
            ) : (
              <CardContext.Provider value={{ results: search?.results ?? [], images: search?.images ?? [], onSearch: (q) => void runSearch(q), onAsk: (q) => void ask(q) }}>
                <div key={query} className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <AnswerCardView
                    card={card}
                    filling={filling}
                    pattern={pattern}
                    alternatives={plan?.alternatives ?? []}
                    engine={result ? [result.engine === 'deepseek' ? 'DeepSeek' : 'Extractive', result.pagesRead ? `${result.pagesRead} pages read` : '', result.removed ? `${result.removed} unverified removed` : '', `${(result.ms / 1000).toFixed(1)}s`].filter(Boolean).join(' · ') : plan ? `${plan.engine === 'jev' ? 'Jev' : 'Auto'} layout · ${plan.ms}ms` : undefined}
                    onPattern={(id) => redesign(id, simple)}
                    simple={simple}
                    onSimple={(v) => redesign(pattern ?? plan?.pattern ?? 'answer', v)}
                    onRegenerate={() => redesign(pattern ?? plan?.pattern ?? 'answer', simple)}
                  />
                </div>
              </CardContext.Provider>
            )}

            {result && result.followups.length > 0 && (
              <div className="flex flex-col gap-1">
                {result.followups.map((f) => (
                  <button key={f} onClick={() => ask(f)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                    <Lightbulb className="size-3.5 shrink-0" />{f}
                  </button>
                ))}
              </div>
            )}

            {search && search.results.length > 0 && <Sources results={search.results} engines={search.engines} onDigest={digest} />}
          </main>
        )}

        {!home && search && (
          <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-background via-background/90 to-transparent px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-8">
            {selection ? (
              <div onMouseDown={(e) => e.preventDefault()} className="mx-auto flex max-w-2xl items-center gap-1.5 rounded-full border bg-popover p-1.5 shadow-lg animate-in fade-in slide-in-from-bottom-2">
                <span className="min-w-0 flex-1 truncate px-3 text-xs text-muted-foreground">“{selection}”</span>
                <Button size="sm" className="h-8 rounded-full" onClick={() => place(selection)}><Wand2 className="size-3.5" />Place</Button>
                <Button size="icon" variant="ghost" className="size-8 rounded-full" onClick={() => { pin({ type: 'list', style: 'icon', items: [{ text: selection, icon: 'pin' }] }); clearSelection(); }} aria-label="Pin"><Pin className="size-4" /></Button>
                <Button size="icon" variant="ghost" className="size-8 rounded-full" onClick={() => { const t = selection; clearSelection(); void ask(`Explain in plain words: "${t}"`); }} aria-label="Explain"><Lightbulb className="size-4" /></Button>
                <Button size="icon" variant="ghost" className="size-8 rounded-full" onClick={() => { const t = selection; clearSelection(); void runSearch(t); }} aria-label="Search"><Search className="size-4" /></Button>
              </div>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); void ask(followup); }} className="mx-auto flex max-w-2xl items-center gap-1.5 rounded-full border bg-popover p-1.5 pl-4 shadow-lg">
                <input value={followup} onChange={(e) => setFollowup(e.target.value)} placeholder="Ask a follow-up…" enterKeyHint="send" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm" />
                <Button type="submit" size="icon" className="size-8 rounded-full" disabled={asking || !followup.trim()} aria-label="Send">
                  {asking ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                </Button>
              </form>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
