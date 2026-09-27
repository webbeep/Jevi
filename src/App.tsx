import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, CornerDownRight, Lightbulb, Loader2, Moon, Pin, Search, Sparkles, Sun, Wand2 } from 'lucide-react';
import type { AnswerCard, CardNode } from '../shared/card';
import type { Freshness } from '../shared/types';
import { api } from './api';
import { AnswerCardView } from './card/AnswerCardView';
import { CardContext } from './card/context';
import { Sources } from './Sources';
import { type Turn, useSession } from './useSession';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TooltipProvider } from '@/components/ui/tooltip';

const FRESHNESS: { id: Freshness; label: string }[] = [
  { id: 'any', label: 'Any time' }, { id: 'day', label: 'Today' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'year', label: 'Year' },
];
const SUGGESTIONS = ['weather in Tokyo', 'how to make sourdough bread', 'iPhone 17 vs Pixel 10', 'history of the Roman Empire', 'what is quantum computing', 'best budget running shoes'];
const LOADING: CardNode[] = [{ type: 'slot', hint: 'answer', shape: 'hero' }, { type: 'slot', hint: 'details', shape: 'block' }];

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && matchMedia('(prefers-color-scheme: dark)').matches));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);
  return [dark, setDark] as const;
}

function engineLabel(t: Turn): string | undefined {
  const r = t.result;
  if (r) {
    return [r.engine === 'deepseek' ? 'DeepSeek' : 'Extractive', r.pagesRead ? `${r.pagesRead} pages read` : '', r.removed ? `${r.removed} unverified removed` : '', r.ms ? `${(r.ms / 1000).toFixed(1)}s` : '']
      .filter(Boolean)
      .join(' · ');
  }
  return t.plan ? `${t.plan.engine === 'jev' ? 'Jev' : 'Auto'} layout · ${t.plan.ms}ms` : undefined;
}

export default function App() {
  const initial = useMemo(() => new URLSearchParams(location.search), []);
  const [dark, setDark] = useTheme();
  const [freshness, setFreshness] = useState<Freshness>((initial.get('t') as Freshness) || 'any');
  const session = useSession(freshness);
  const { turns } = session;
  const [input, setInput] = useState(initial.get('q') ?? '');
  const [selection, setSelection] = useState<{ text: string; turnId: number } | null>(null);
  const [followup, setFollowup] = useState('');
  const mainRef = useRef<HTMLDivElement>(null);
  const home = turns.length === 0;
  const root = turns[0];
  const busy = turns.some((t) => t.filling);
  const last = [...turns].reverse().find((t) => t.result);

  const startSearch = (q: string, t: Freshness = freshness) => {
    const query = q.trim();
    if (!query) return;
    setInput(query);
    const params = new URLSearchParams({ q: query });
    if (t !== 'any') params.set('t', t);
    history.pushState(null, '', `?${params}`);
    session.search(query, { reset: true, freshness: t });
  };

  useEffect(() => {
    const q = initial.get('q');
    if (q) session.search(q, { reset: true });
    const onPop = () => {
      const next = new URLSearchParams(location.search).get('q');
      if (next) {
        setInput(next);
        session.search(next, { reset: true });
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onSelect = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      const node = sel?.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      const turnEl = el?.closest<HTMLElement>('[data-turn]');
      if (text.length >= 3 && turnEl && mainRef.current?.contains(turnEl)) setSelection({ text: text.slice(0, 1200), turnId: Number(turnEl.dataset.turn) });
      else if (!text) setSelection(null);
    };
    document.addEventListener('selectionchange', onSelect);
    return () => document.removeEventListener('selectionchange', onSelect);
  }, []);

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  const place = async ({ text, turnId }: { text: string; turnId: number }) => {
    clearSelection();
    const pinText = () => session.pin(turnId, { type: 'list', style: 'icon', items: [{ text, icon: 'pin' }] });
    try {
      const out = await api.slot(root?.question ?? '', text);
      switch (out.slot) {
        case 'key_point': return pinText();
        case 'stat': return out.stat ? session.pin(turnId, { type: 'stat', label: out.stat.label, value: out.stat.value, icon: 'hash' }) : pinText();
        case 'timeline': return out.timeline ? session.pin(turnId, { type: 'timeline', items: [{ when: out.timeline.when, title: out.timeline.text }] }) : pinText();
        case 'search': return session.search(text, { reset: false });
        case 'explain': return void session.followup(`Explain in plain words: "${text}"`, turnId);
        default: {
          const unreachable: never = out.slot;
          return unreachable;
        }
      }
    } catch {
      pinText();
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    startSearch(input);
  };

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
        {busy && !home ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
      </Button>
    </form>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-dvh">
        <header className={cn('z-30', home ? '' : 'sticky top-0 border-b bg-background/80 backdrop-blur-xl')}>
          <div className={cn('mx-auto flex max-w-2xl items-center gap-3 px-4', home ? 'justify-end py-4' : 'py-2.5')}>
            {!home && (
              <button onClick={() => { session.clear(); setInput(''); history.pushState(null, '', '/'); }} className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
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
            <p className="mt-2 text-center text-sm text-muted-foreground">Every answer is an interactive card designed for your question.</p>
            <div className="mt-8 w-full">{searchBox}</div>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="outline" size="sm" className="rounded-full font-normal text-muted-foreground" onClick={() => startSearch(s)}>{s}</Button>
              ))}
            </div>
          </main>
        ) : (
          <main ref={mainRef} className="mx-auto max-w-2xl space-y-8 px-4 pb-[60vh] pt-4">
            <ToggleGroup type="single" size="sm" value={freshness} onValueChange={(v) => { if (v && root) { setFreshness(v as Freshness); startSearch(root.question, v as Freshness); } }} className="no-scrollbar -mx-4 -mb-4 w-auto justify-start overflow-x-auto px-4">
              {FRESHNESS.map((f) => <ToggleGroupItem key={f.id} value={f.id} className="h-7 shrink-0 rounded-full px-3 text-xs data-[state=on]:bg-foreground data-[state=on]:text-background">{f.label}</ToggleGroupItem>)}
            </ToggleGroup>

            {turns.map((t, i) => <TurnView key={t.id} turn={t} first={i === 0} session={session} />)}

            {last?.result && last.result.followups.length > 0 && !busy && (
              <div className="-mt-4 flex flex-col gap-1 animate-in fade-in">
                {last.result.followups.map((f) => (
                  <button key={f} onClick={() => session.followup(f, last.id)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                    <Lightbulb className="size-3.5 shrink-0" />{f}
                  </button>
                ))}
              </div>
            )}
          </main>
        )}

        {!home && (
          <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-background via-background/90 to-transparent px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-8">
            {selection ? (
              <div onMouseDown={(e) => e.preventDefault()} className="mx-auto flex max-w-2xl items-center gap-1.5 rounded-full border bg-popover p-1.5 shadow-lg animate-in fade-in slide-in-from-bottom-2">
                <span className="min-w-0 flex-1 truncate px-3 text-xs text-muted-foreground">“{selection.text}”</span>
                <Button size="sm" className="h-8 rounded-full" onClick={() => place(selection)}><Wand2 className="size-3.5" />Place</Button>
                <Button size="icon" variant="ghost" className="size-8 rounded-full" onClick={() => { session.pin(selection.turnId, { type: 'list', style: 'icon', items: [{ text: selection.text, icon: 'pin' }] }); clearSelection(); }} aria-label="Pin"><Pin className="size-4" /></Button>
                <Button size="icon" variant="ghost" className="size-8 rounded-full" onClick={() => { const s = selection; clearSelection(); void session.followup(`Explain in plain words: "${s.text}"`, s.turnId); }} aria-label="Explain"><Lightbulb className="size-4" /></Button>
                <Button size="icon" variant="ghost" className="size-8 rounded-full" onClick={() => { const s = selection; clearSelection(); session.search(s.text, { reset: false }); }} aria-label="Search"><Search className="size-4" /></Button>
              </div>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); void session.followup(followup); setFollowup(''); }} className="mx-auto flex max-w-2xl items-center gap-1.5 rounded-full border bg-popover p-1.5 pl-4 shadow-lg">
                <input value={followup} onChange={(e) => setFollowup(e.target.value)} placeholder="Ask a follow-up, or tell the card what to change…" enterKeyHint="send" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm" />
                <Button type="submit" size="icon" className="size-8 rounded-full" disabled={!followup.trim() || !last} aria-label="Send">
                  <ArrowUp className="size-4" />
                </Button>
              </form>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function TurnView({ turn, first, session }: { turn: Turn; first: boolean; session: ReturnType<typeof useSession> }) {
  const ctx = session.searchOf(turn);
  const card: AnswerCard = useMemo(() => {
    const base = turn.result?.card ?? turn.plan?.skeleton ?? { title: turn.question, body: LOADING };
    const titled = !turn.result && turn.kind !== 'search' ? { ...base, title: turn.question } : base;
    return turn.pins.length ? { ...titled, body: [...titled.body, { type: 'section', title: 'Pinned by you', icon: 'pin', children: turn.pins }] } : titled;
  }, [turn.result, turn.plan, turn.question, turn.kind, turn.pins]);

  return (
    <section id={`turn-${turn.id}`} data-turn={turn.id} className="scroll-mt-20 space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-500">
      {!first && (
        <div className="flex justify-end">
          <div className="flex max-w-[85%] items-center gap-2 rounded-2xl rounded-br-md bg-foreground px-4 py-2 text-sm text-background">
            {turn.kind === 'search' && <Search className="size-3.5 shrink-0 opacity-70" />}
            {turn.question}
          </div>
        </div>
      )}

      {turn.error && !turn.result ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{turn.error}</div>
      ) : (
        <CardContext.Provider
          value={{
            results: ctx?.search?.results ?? [],
            images: ctx?.search?.images ?? [],
            busy: turn.filling,
            onSearch: (q) => session.search(q, { reset: false }),
            onAsk: (q) => void session.followup(q, turn.id),
            onRefine: (instruction) => session.refine(turn.id, instruction),
          }}
        >
          <AnswerCardView
            card={card}
            version={`${turn.id}-${turn.version}`}
            filling={turn.filling}
            status={turn.status}
            pattern={turn.pattern}
            alternatives={turn.kind === 'digest' ? [] : turn.plan?.alternatives ?? []}
            engine={engineLabel(turn)}
            onPattern={(id) => session.setPattern(turn.id, id)}
            simple={turn.simple}
            onSimple={(v) => session.setSimple(turn.id, v)}
            onRegenerate={() => session.redesign(turn.id)}
          />
        </CardContext.Provider>
      )}

      {turn.refinements.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {turn.refinements.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"><CornerDownRight className="size-3" />{r}</span>
          ))}
        </div>
      )}

      {turn.kind === 'search' && turn.search && turn.search.results.length > 0 && (
        <Sources results={turn.search.results} engines={turn.search.engines} onDigest={(r) => session.digest(r, turn.id)} />
      )}
    </section>
  );
}
