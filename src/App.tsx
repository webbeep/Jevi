import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, CornerDownRight, CornerLeftUp, Moon, Plus, Search, SlidersHorizontal, Sun, X } from 'lucide-react';
import type { AnswerCard, CardNode } from '../shared/card';
import { api } from './api';
import { AnswerCardView } from './card/AnswerCardView';
import { CardContext } from './card/context';
import { Icon } from './card/Icon';
import { LogoMark, Wordmark } from './Logo';
import { Sources } from './Sources';
import { type Turn, liveBody, scrollToTurn, useSession } from './useSession';
import { useSuggestions } from './useSuggestions';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TooltipProvider } from '@/components/ui/tooltip';

const LOADING: CardNode[] = [{ type: 'slot', hint: 'answer', shape: 'hero' }, { type: 'slot', hint: 'details', shape: 'block' }];

/** What to do with highlighted text. */
const QUOTE_MODES = [
  { id: 'explain', label: 'Explain', icon: 'lightbulb', hint: 'Explain it in plain words' },
  { id: 'expand', label: 'Expand', icon: 'list-plus', hint: 'Go deeper on it' },
  { id: 'search', label: 'Search', icon: 'search', hint: 'Search the web for it' },
  { id: 'save', label: 'Save', icon: 'pin', hint: 'Pin it to the card' },
] as const;
type QuoteMode = (typeof QUOTE_MODES)[number]['id'];

interface Quote {
  text: string;
  turnId: number;
}

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
    const source = r.engine === 'reasoning' ? 'Reasoned answer — not from live sources' : r.engine === 'deepseek' ? 'Composed from sources' : 'Quoted from sources';
    return [source, r.pagesRead ? `${r.pagesRead} pages read` : '', r.removed ? `${r.removed} unverified removed` : '', r.ms ? `${(r.ms / 1000).toFixed(1)}s` : ''].filter(Boolean).join(' · ');
  }
  if (t.live?.nodes.length) return 'Composing…';
  if (t.search) return `${t.search.results.length} sources · reading`;
  return t.plan ? 'Planning the layout…' : undefined;
}

export default function App() {
  const initial = useMemo(() => new URLSearchParams(location.search), []);
  const [dark, setDark] = useTheme();
  const session = useSession();
  const suggestions = useSuggestions();
  const { turns } = session;
  const [input, setInput] = useState(initial.get('q') ?? '');
  const [message, setMessage] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteMode, setQuoteMode] = useState<QuoteMode>('explain');
  const mainRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const home = turns.length === 0;
  const root = turns[0];
  const last = [...turns].reverse().find((t) => t.result);
  const busy = turns.some((t) => t.filling);
  const title = root?.result?.card.title ?? root?.question ?? '';
  const railTurn = [...turns].reverse().find((t) => t.kind === 'search' && t.search?.results.length);

  const startSearch = (q: string) => {
    const query = q.trim();
    if (!query) return;
    history.pushState(null, '', `?${new URLSearchParams({ q: query })}`);
    session.search(query, { reset: true });
  };

  const newChat = () => {
    session.clear();
    setInput('');
    setMessage('');
    setQuote(null);
    history.pushState(null, '', '/');
  };

  useEffect(() => {
    const q = initial.get('q');
    if (q) session.search(q, { reset: true });
    const onPop = () => {
      const next = new URLSearchParams(location.search).get('q');
      if (next) session.search(next, { reset: true });
      else session.clear();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Highlighting text inside a card turns it into a quote for the composer; it stays until sent or dismissed.
  useEffect(() => {
    const onSelect = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      const node = sel?.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      const turnEl = el?.closest<HTMLElement>('[data-turn]');
      if (text.length >= 3 && turnEl && mainRef.current?.contains(turnEl)) setQuote({ text: text.slice(0, 600), turnId: Number(turnEl.dataset.turn) });
    };
    document.addEventListener('selectionchange', onSelect);
    return () => document.removeEventListener('selectionchange', onSelect);
  }, []);

  const save = async ({ text, turnId }: Quote) => {
    const pinText = () => session.pin(turnId, { type: 'list', style: 'icon', items: [{ text, icon: 'pin' }] });
    try {
      const out = await api.slot(root?.question ?? '', text);
      switch (out.slot) {
        case 'stat': return out.stat ? session.pin(turnId, { type: 'stat', label: out.stat.label, value: out.stat.value, icon: 'hash' }) : pinText();
        case 'timeline': return out.timeline ? session.pin(turnId, { type: 'timeline', items: [{ when: out.timeline.when, title: out.timeline.text }] }) : pinText();
        case 'key_point':
        case 'search':
        case 'explain':
          return pinText();
        default: {
          const unreachable: never = out.slot;
          return unreachable;
        }
      }
    } catch {
      pinText();
    }
  };

  const send = (e: FormEvent) => {
    e.preventDefault();
    const note = message.trim();
    if (quote) {
      const q = quote;
      switch (quoteMode) {
        case 'explain':
          void session.followup(`Explain "${q.text}"${note ? ` — ${note}` : ''}`, q.turnId);
          break;
        case 'expand':
          void session.followup(`Go deeper on "${q.text}"${note ? ` — ${note}` : ''}`, q.turnId);
          break;
        case 'search':
          void session.followup(note ? `${q.text} — ${note}` : q.text, q.turnId, 'search');
          break;
        case 'save':
          void save(q);
          break;
        default: {
          const unreachable: never = quoteMode;
          return unreachable;
        }
      }
      window.getSelection()?.removeAllRanges();
      setQuote(null);
    } else if (note) {
      void session.followup(note);
    } else return;
    setMessage('');
  };

  const onSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    startSearch(input);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="relative min-h-dvh">
        <div className="zo-wash" data-on={busy} aria-hidden />

        {home ? (
          <>
            <header className="flex h-14 items-center justify-end px-3 sm:px-5">
              <ThemeToggle dark={dark} onToggle={() => setDark(!dark)} />
            </header>
            <main className="relative mx-auto flex w-full max-w-[640px] flex-col px-4 pb-16 pt-[12dvh] sm:pt-[18dvh]">
              <h1 className="flex justify-center">
                <Wordmark className="text-[40px] sm:text-[48px]" />
                <span className="sr-only">ZO</span>
              </h1>
              <form onSubmit={onSearchSubmit} className="group relative mt-8 sm:mt-10">
                <Search className="pointer-events-none absolute left-5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask anything"
                  enterKeyHint="send"
                  autoFocus
                  className="h-14 rounded-2xl border-input bg-card pl-12 pr-14 text-base shadow-card transition-shadow focus-visible:shadow-float focus-visible:ring-0 md:text-base"
                />
                <Button type="submit" size="icon" className="absolute right-2 top-1/2 size-10 -translate-y-1/2 rounded-xl" disabled={!input.trim()} aria-label="Send">
                  <ArrowUp className="size-4" />
                </Button>
              </form>
              <ul className="mt-6 grid gap-0.5 sm:mt-8 sm:grid-cols-2 sm:gap-x-4">
                {suggestions.slice(0, 6).map((s, i) => (
                  <li key={s.text} className={cn('animate-in fade-in fill-mode-backwards duration-500', i >= 4 && 'hidden sm:block')} style={{ animationDelay: `${i * 40}ms` }}>
                    <button onClick={() => startSearch(s.text)} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] leading-snug text-foreground/75 transition-colors hover:bg-foreground/[0.04] hover:text-foreground">
                      <Icon name={s.icon} fallback="sparkles" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="line-clamp-2">{s.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </main>
          </>
        ) : (
          <>
            <header className="sticky top-0 z-30 border-b bg-background/75 backdrop-blur-xl backdrop-saturate-150">
              <div className={cn(SHELL, 'flex h-14 items-center gap-3')}>
                <button onClick={newChat} className="shrink-0 rounded-full" aria-label="Home">
                  <LogoMark className="size-7" />
                </button>
                <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium tracking-[-0.01em]">{title}</h1>
                <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-muted-foreground hover:text-foreground" onClick={newChat}>
                  <Plus className="size-4" />
                  <span className="hidden sm:inline">New chat</span>
                </Button>
                <ThemeToggle dark={dark} onToggle={() => setDark(!dark)} />
              </div>
            </header>

            <div className={cn(SHELL, GRID, 'relative pb-[50vh] pt-5 sm:pt-8')}>
              <main ref={mainRef} className="min-w-0 space-y-10">
                {turns.map((t, i) => <TurnView key={t.id} turn={t} first={i === 0} session={session} />)}

                {last?.result && last.result.followups.length > 0 && !busy && (
                  <section className="-mt-4 animate-in fade-in">
                    <h3 className="zo-label mb-1 px-1">Related</h3>
                    <ul className="divide-y">
                      {last.result.followups.map((f) => (
                        <li key={f}>
                          <button onClick={() => session.followup(f, last.id, 'ask')} className="group flex w-full items-center gap-3 px-1 py-3 text-left text-[14px] leading-snug text-foreground/80 transition-colors hover:text-foreground">
                            <CornerDownRight className="size-4 shrink-0 text-muted-foreground" />
                            <span className="flex-1">{f}</span>
                            <Plus className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </main>

              <aside className="hidden lg:block">
                {railTurn?.search && (
                  <div className="sticky top-[5.5rem] max-h-[calc(100dvh-7rem)] overflow-y-auto no-scrollbar">
                    <Sources key={railTurn.id} layout="rail" results={railTurn.search.results} engines={railTurn.search.engines} query={railTurn.question} onDigest={(r) => session.digest(r, railTurn.id)} />
                  </div>
                )}
              </aside>
            </div>
          </>
        )}

        {!home && (
          <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-background via-background/85 to-transparent pb-[calc(env(safe-area-inset-bottom)+12px)] pt-10">
            <div className={cn(SHELL, GRID)}>
            <form onSubmit={send} className="overflow-hidden rounded-2xl border border-input bg-popover shadow-float">
              {quote && (
                <div className="space-y-2 border-b px-3 pb-2.5 pt-3 animate-in fade-in slide-in-from-bottom-1">
                  <div className="flex items-start gap-2">
                    <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <p className="line-clamp-2 flex-1 text-xs leading-relaxed text-muted-foreground">{quote.text}</p>
                    <button type="button" onClick={() => { setQuote(null); window.getSelection()?.removeAllRanges(); }} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss quote">
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <ToggleGroup type="single" size="sm" value={quoteMode} onValueChange={(v) => v && setQuoteMode(v as QuoteMode)} className="no-scrollbar w-full justify-start overflow-x-auto">
                    {QUOTE_MODES.map((m) => (
                      <ToggleGroupItem key={m.id} value={m.id} title={m.hint} className="h-7 shrink-0 rounded-lg px-2.5 text-xs data-[state=on]:bg-foreground/[0.08] data-[state=on]:text-foreground">
                        <Icon name={m.icon} className="size-3.5" />
                        {m.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              )}
              <div className="flex items-center gap-2 p-2 pl-4">
                <input
                  ref={composerRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={quote ? (quoteMode === 'save' ? 'Press send to pin it' : 'Add a note (optional)') : 'Ask a follow-up'}
                  enterKeyHint="send"
                  className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
                />
                <Button type="submit" size="icon" className="size-9 shrink-0 rounded-xl" disabled={!quote && !message.trim()} aria-label="Send">
                  <ArrowUp className="size-4" />
                </Button>
              </div>
            </form>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

/** Shared page frame so header, feed, rail and composer line up on the same edges. */
const SHELL = 'mx-auto w-full max-w-[1120px] px-3 sm:px-6';
/** Single column; from lg a fixed-width sources rail sits beside a 720px reading column. */
const GRID = 'mx-auto max-w-[720px] lg:grid lg:max-w-[1120px] lg:grid-cols-[minmax(0,720px)_300px] lg:justify-center lg:gap-12';

function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <Button variant="ghost" size="icon" className="size-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground" onClick={onToggle} aria-label="Toggle theme">
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

function TurnView({ turn, first, session }: { turn: Turn; first: boolean; session: ReturnType<typeof useSession> }) {
  const ctx = session.searchOf(turn);
  const streaming = !!turn.live?.nodes.some(Boolean);
  const card: AnswerCard = useMemo(() => {
    const skeleton = turn.plan?.skeleton ?? { title: turn.question, body: LOADING };
    const live = turn.live;
    let base: AnswerCard;
    if (live && streaming) {
      const more = turn.filling && !live.regions.length ? [{ type: 'slot' as const, hint: 'more', shape: 'block' as const }] : [];
      base = { ...skeleton, ...live.head, body: [...liveBody(live, turn.filling), ...more] };
    } else if (turn.result) base = turn.result.card;
    else base = { ...skeleton, ...live?.head, body: live?.regions.length ? live.regions : skeleton.body };
    if (!turn.result && !live?.head && turn.kind !== 'search') base = { ...base, title: turn.question };
    return turn.pins.length ? { ...base, body: [...base.body, { type: 'section', title: 'Pinned by you', icon: 'pin', children: turn.pins }] } : base;
  }, [streaming, turn.live, turn.result, turn.plan, turn.question, turn.kind, turn.pins, turn.filling]);

  const credits = useMemo(() => {
    const out: Record<string, { credit: string; link: string }> = {};
    (ctx?.search?.images ?? []).forEach((i) => (out[i.thumb] = { credit: i.credit ?? i.source, link: i.url }));
    [...(turn.live?.credits ?? []), ...(card.credits ?? [])].forEach((c) => (out[c.src] = { credit: c.credit, link: c.link }));
    return out;
  }, [ctx?.search?.images, turn.live?.credits, card.credits]);

  return (
    <section id={`turn-${turn.id}`} data-turn={turn.id} className="scroll-mt-20 space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-500">
      {!first && (
        <div className="flex flex-col items-end gap-1.5">
          {turn.base && (
            <button onClick={() => scrollToTurn(turn.base!.id)} className="inline-flex max-w-[85%] items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
              <CornerLeftUp className="size-3.5 shrink-0" />
              <span className="truncate">From “{turn.base.title}”</span>
            </button>
          )}
          <div className="flex max-w-[85%] items-center gap-2 rounded-2xl rounded-br-md bg-foreground/[0.06] px-4 py-2.5 text-[15px] leading-snug dark:bg-foreground/[0.09]">
            {turn.kind === 'search' && <Search className="size-3.5 shrink-0 text-muted-foreground" />}
            {turn.origin === 'adjust' && <SlidersHorizontal className="size-3.5 shrink-0 text-muted-foreground" />}
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
            credits,
            busy: turn.filling,
            onSearch: (q) => void session.followup(q, turn.id, 'search'),
            onAsk: (q) => void session.followup(q, turn.id, 'ask'),
            onRefine: (instruction) => void session.followup(instruction, turn.id, 'adjust'),
          }}
        >
          <AnswerCardView
            card={card}
            version={`${turn.id}-${turn.version}`}
            filling={turn.filling}
            streaming={streaming}
            status={turn.status ?? (turn.thinking && !streaming ? 'Thinking it through…' : undefined)}
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

      {turn.kind === 'search' && turn.search && turn.search.results.length > 0 && (
        <div className="lg:hidden">
          <Sources layout="strip" results={turn.search.results} engines={turn.search.engines} query={turn.question} onDigest={(r) => session.digest(r, turn.id)} />
        </div>
      )}
    </section>
  );
}
