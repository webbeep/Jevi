import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, CornerDownRight, Lightbulb, Loader2, Moon, Pin, Search, Sun, Wand2 } from 'lucide-react';
import type { AnswerCard, CardNode } from '../shared/card';
import type { Freshness } from '../shared/types';
import { api } from './api';
import { AnswerCardView } from './card/AnswerCardView';
import { CardContext } from './card/context';
import { Icon } from './card/Icon';
import { LogoMark, Wordmark } from './Logo';
import { Sources } from './Sources';
import { type Turn, useSession } from './useSession';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TooltipProvider } from '@/components/ui/tooltip';

const FRESHNESS: { id: Freshness; label: string }[] = [
  { id: 'any', label: 'Any time' }, { id: 'day', label: 'Today' }, { id: 'week', label: 'This week' }, { id: 'month', label: 'This month' }, { id: 'year', label: 'This year' },
];

const EXAMPLES = [
  { icon: 'cloud-sun', label: 'Live readings', query: 'weather in Tokyo' },
  { icon: 'scale', label: 'Side by side', query: 'iPhone 17 vs Pixel 10' },
  { icon: 'chef-hat', label: 'Make it', query: 'how to make sourdough bread' },
  { icon: 'atom', label: 'Understand', query: 'what is quantum computing' },
  { icon: 'landmark', label: 'Timelines', query: 'history of the Roman Empire' },
  { icon: 'trophy', label: 'Decide', query: 'best budget running shoes' },
];

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
    return [r.engine === 'deepseek' ? 'Designed' : 'Extracted', r.pagesRead ? `${r.pagesRead} pages read` : '', r.removed ? `${r.removed} unverified removed` : '', r.ms ? `${(r.ms / 1000).toFixed(1)}s` : '']
      .filter(Boolean)
      .join(' · ');
  }
  if (t.live?.nodes.length) return 'Designing…';
  if (t.search) return `${t.search.results.length} sources · reading`;
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
  const searchRef = useRef<HTMLInputElement>(null);
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
    searchRef.current?.blur();
  };

  useEffect(() => {
    const q = initial.get('q');
    if (q) session.search(q, { reset: true });
    const onPop = () => {
      const next = new URLSearchParams(location.search).get('q');
      if (next) {
        setInput(next);
        session.search(next, { reset: true });
      } else session.clear();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
    };
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
        ref={searchRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={home ? 'Ask anything — get an answer you can see' : 'Search'}
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
          <div className={cn('mx-auto flex max-w-2xl items-center gap-2.5 px-3 sm:gap-3 sm:px-4', home ? 'justify-end py-3' : 'py-2')}>
            {!home && (
              <button onClick={() => { session.clear(); setInput(''); history.pushState(null, '', '/'); }} className="shrink-0" aria-label="Home">
                <LogoMark className="size-7 sm:hidden" />
                <Wordmark className="hidden sm:flex" />
              </button>
            )}
            {!home && searchBox}
            <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full" onClick={() => setDark(!dark)} aria-label="Toggle theme">
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </header>

        {home ? (
          <main className="mx-auto flex min-h-[82dvh] max-w-xl flex-col items-center justify-center px-4 pb-16">
            <LogoMark className="mb-6 size-12" />
            <h1 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
              Search that <span className="text-brand-gradient">designs</span> the answer.
            </h1>
            <p className="mt-3 max-w-md text-center text-sm leading-relaxed text-muted-foreground sm:text-base">
              Ask anything. Jevi reads the web and builds an interactive card for your question — live numbers, tables, steps, sliders — instead of a list of links.
            </p>
            <div className="mt-8 w-full">{searchBox}</div>
            <div className="mt-6 grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
              {EXAMPLES.map((ex) => (
                <button key={ex.query} onClick={() => startSearch(ex.query)} className="group flex flex-col gap-2 rounded-xl border bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-sm">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-brand/10 group-hover:text-brand">
                    <Icon name={ex.icon} className="size-4" />
                  </span>
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{ex.label}</span>
                  <span className="text-sm font-medium leading-snug">{ex.query}</span>
                </button>
              ))}
            </div>
            <p className="mt-6 hidden text-xs text-muted-foreground sm:block">Press <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">/</kbd> to search from anywhere</p>
          </main>
        ) : (
          <main ref={mainRef} className="mx-auto max-w-2xl space-y-8 px-3 pb-[60vh] pt-3 sm:px-4 sm:pt-4">
            {turns.map((t, i) => (
              <TurnView
                key={t.id}
                turn={t}
                first={i === 0}
                session={session}
                freshness={i === 0 && t.plan?.timeSensitive ? { value: freshness, onChange: (v) => { setFreshness(v); startSearch(t.question, v); } } : undefined}
              />
            ))}

            {last?.result && last.result.followups.length > 0 && !busy && (
              <div className="-mt-4 flex flex-col gap-0.5 animate-in fade-in">
                {last.result.followups.map((f) => (
                  <button key={f} onClick={() => session.followup(f, last.id)} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                    <Lightbulb className="size-3.5 shrink-0" />{f}
                  </button>
                ))}
              </div>
            )}
          </main>
        )}

        {!home && (
          <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-background via-background/90 to-transparent px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-8 sm:px-4">
            {selection ? (
              <div onMouseDown={(e) => e.preventDefault()} className="mx-auto flex max-w-2xl items-center gap-1 rounded-full border bg-popover p-1.5 shadow-lg animate-in fade-in slide-in-from-bottom-2">
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

function TurnView({ turn, first, session, freshness }: {
  turn: Turn;
  first: boolean;
  session: ReturnType<typeof useSession>;
  freshness?: { value: Freshness; onChange: (v: Freshness) => void };
}) {
  const ctx = session.searchOf(turn);
  const streaming = !!turn.live?.nodes.length;
  const card: AnswerCard = useMemo(() => {
    const skeleton = turn.plan?.skeleton ?? { title: turn.question, body: LOADING };
    let base: AnswerCard;
    if (streaming) base = { ...skeleton, ...turn.live!.head, body: [...turn.live!.nodes, ...(turn.filling ? [{ type: 'slot' as const, hint: 'more', shape: 'block' as const }] : [])] };
    else if (turn.result) base = turn.result.card;
    else base = { ...skeleton, ...turn.live?.head, body: skeleton.body };
    if (!turn.result && !turn.live?.head && turn.kind !== 'search') base = { ...base, title: turn.question };
    return turn.pins.length ? { ...base, body: [...base.body, { type: 'section', title: 'Pinned by you', icon: 'pin', children: turn.pins }] } : base;
  }, [streaming, turn.live, turn.result, turn.plan, turn.question, turn.kind, turn.pins, turn.filling]);

  return (
    <section id={`turn-${turn.id}`} data-turn={turn.id} className="scroll-mt-16 space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-500">
      {!first && (
        <div className="flex justify-end">
          <div className="flex max-w-[85%] items-center gap-2 rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-sm text-background">
            {turn.kind === 'search' && <Search className="size-3.5 shrink-0 opacity-70" />}
            {turn.question}
          </div>
        </div>
      )}

      {freshness && (
        <ToggleGroup type="single" size="sm" value={freshness.value} onValueChange={(v) => v && freshness.onChange(v as Freshness)} className="no-scrollbar -mx-3 w-auto justify-start overflow-x-auto px-3 animate-in fade-in sm:-mx-4 sm:px-4">
          {FRESHNESS.map((f) => (
            <ToggleGroupItem key={f.id} value={f.id} className="h-7 shrink-0 rounded-full px-3 text-xs data-[state=on]:bg-foreground data-[state=on]:text-background">{f.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
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
            streaming={streaming}
            status={turn.status}
            quick={!streaming && !turn.result ? turn.quick : undefined}
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
        <Sources results={turn.search.results} engines={turn.search.engines} query={turn.question} onDigest={(r) => session.digest(r, turn.id)} />
      )}
    </section>
  );
}
