import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, CornerDownRight, Moon, Plus, Search, Sun, X } from 'lucide-react';
import type { AnswerCard, CardNode } from '../shared/card';
import { api } from './api';
import { AnswerCardView } from './card/AnswerCardView';
import { CardContext } from './card/context';
import { Icon } from './card/Icon';
import { LogoMark } from './Logo';
import { Sources } from './Sources';
import { type Turn, liveBody, useSession } from './useSession';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TooltipProvider } from '@/components/ui/tooltip';

const EXAMPLES = [
  { icon: 'cloud-sun', query: 'weather in Tokyo' },
  { icon: 'scale', query: 'iPhone 17 vs Pixel 10' },
  { icon: 'chef-hat', query: 'how to make sourdough bread' },
  { icon: 'atom', query: 'what is quantum computing' },
  { icon: 'landmark', query: 'history of the Roman Empire' },
  { icon: 'trophy', query: 'best budget running shoes' },
];

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
    const source = r.engine === 'reasoning' ? 'Answered by reasoning — not from live sources' : r.engine === 'deepseek' ? 'Designed by Jev + DeepSeek from sources' : 'Extracted from sources';
    return [source, r.pagesRead ? `${r.pagesRead} pages read` : '', r.removed ? `${r.removed} unverified removed` : '', r.ms ? `${(r.ms / 1000).toFixed(1)}s` : ''].filter(Boolean).join(' · ');
  }
  if (t.live?.nodes.length) return 'Designing…';
  if (t.search) return `${t.search.results.length} sources · reading`;
  return t.plan ? `${t.plan.engine === 'jev' ? 'Jev' : 'Auto'} layout · ${t.plan.ms}ms` : undefined;
}

export default function App() {
  const initial = useMemo(() => new URLSearchParams(location.search), []);
  const [dark, setDark] = useTheme();
  const session = useSession();
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
          session.search(note ? `${q.text} ${note}` : q.text, { reset: false });
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
      <div className="min-h-dvh">
        <header className={cn('z-30', home ? '' : 'sticky top-0 border-b bg-background/80 backdrop-blur-xl')}>
          <div className={cn('mx-auto flex max-w-2xl items-center gap-2.5 px-3 sm:px-4', home ? 'justify-end py-3' : 'h-14')}>
            {!home && (
              <>
                <button onClick={newChat} className="shrink-0" aria-label="Home">
                  <LogoMark className="size-7" />
                </button>
                <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">{title}</h1>
                <Button variant="outline" size="sm" className="h-8 shrink-0 rounded-full" onClick={newChat}>
                  <Plus className="size-3.5" />
                  <span className="hidden sm:inline">New chat</span>
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full" onClick={() => setDark(!dark)} aria-label="Toggle theme">
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
          </div>
        </header>

        {home ? (
          <main className="mx-auto flex min-h-[82dvh] max-w-xl flex-col items-center justify-center px-4 pb-16">
            <LogoMark className="mb-5 size-11" />
            <h1 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
              Search that <span className="text-brand-gradient">designs</span> the answer.
            </h1>
            <form onSubmit={onSearchSubmit} className="relative mt-7 w-full">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
              <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything" enterKeyHint="search" autoFocus className="h-14 rounded-full bg-card pl-12 pr-14 text-base shadow-xs md:text-base" />
              <Button type="submit" size="icon" className="absolute right-2 top-1/2 size-10 -translate-y-1/2 rounded-full" aria-label="Search">
                <ArrowUp className="size-4" />
              </Button>
            </form>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((ex) => (
                <Button key={ex.query} variant="outline" size="sm" className="rounded-full font-normal text-muted-foreground" onClick={() => startSearch(ex.query)}>
                  <Icon name={ex.icon} className="size-3.5" />
                  {ex.query}
                </Button>
              ))}
            </div>
          </main>
        ) : (
          <main ref={mainRef} className="mx-auto max-w-2xl space-y-8 px-3 pb-[60vh] pt-4 sm:px-4">
            {turns.map((t, i) => <TurnView key={t.id} turn={t} first={i === 0} session={session} />)}

            {last?.result && last.result.followups.length > 0 && !busy && (
              <div className="-mt-4 flex flex-wrap gap-1.5 animate-in fade-in">
                {last.result.followups.map((f) => (
                  <button key={f} onClick={() => session.followup(f, last.id)} className="rounded-full border bg-card px-3 py-1.5 text-left text-[13px] leading-snug text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground">
                    {f}
                  </button>
                ))}
              </div>
            )}
          </main>
        )}

        {!home && (
          <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-background via-background/90 to-transparent px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-8 sm:px-4">
            <form onSubmit={send} className="mx-auto max-w-2xl overflow-hidden rounded-3xl border bg-popover shadow-lg">
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
                      <ToggleGroupItem key={m.id} value={m.id} title={m.hint} className="h-7 shrink-0 rounded-full px-3 text-xs data-[state=on]:bg-foreground data-[state=on]:text-background">
                        <Icon name={m.icon} className="size-3.5" />
                        {m.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              )}
              <div className="flex items-center gap-1.5 p-1.5 pl-4">
                <input
                  ref={composerRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={quote ? (quoteMode === 'save' ? 'Press send to pin it' : 'Add a note (optional)') : 'Ask anything, or tell a card what to change…'}
                  enterKeyHint="send"
                  className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
                />
                <Button type="submit" size="icon" className="size-8 shrink-0 rounded-full" disabled={!quote && !message.trim()} aria-label="Send">
                  <ArrowUp className="size-4" />
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </TooltipProvider>
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
