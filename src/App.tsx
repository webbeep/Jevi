import { type FormEvent, type RefObject, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, CornerDownRight, CornerLeftUp, Moon, Pencil, Plus, RotateCw, Search, Shuffle, SlidersHorizontal, Sun, X } from 'lucide-react';
import type { AnswerCard, CardNode } from '../shared/card';
import type { SearchResponse, SearchResult } from '../shared/types';
import { api } from './api';
import { AnswerCardView } from './card/AnswerCardView';
import { CardContext, type CardContextValue } from './card/context';
import { Icon } from './card/Icon';
import { LogoMark, Wordmark } from './Logo';
import { type LibraryEntry, buildLibrary } from './library';
import { FaviconStack, Reader, SourcesRail, SourcesSheet } from './Sources';
import { type SessionActions, type Turn, liveBody, scrollToTurn, useSession } from './useSession';
import { useSuggestions } from './useSuggestions';
import { loadSnapshot, normalizeAnswerQuery, saveSnapshot } from '../shared/answerKey';
import { placeholderExamples } from '../shared/starters';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

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


const RECENTS_KEY = 'zo:recent';
const TAGLINE = 'Ask anything. Get answers you can compare, tweak and keep.';

function readAnswerCache(query: string): Turn[] | undefined {
  try {
    return loadSnapshot<Turn[]>(sessionStorage, query);
  } catch {
    return undefined;
  }
}

function writeAnswerCache(query: string, turns: Turn[]) {
  try {
    saveSnapshot(sessionStorage, query, turns);
  } catch {
    /* private mode */
  }
}

function readRecents(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function pushRecent(q: string): string[] {
  const next = [q, ...readRecents().filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 3);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
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
    const source = r.engine === 'reasoning' ? 'Reasoned answer — not from live sources' : r.engine === 'composed' ? 'Composed from sources' : 'Quoted from sources';
    const line = [source, r.pagesRead ? `${r.pagesRead} pages read` : '', r.removed ? `${r.removed} unverified removed` : '', r.ms ? `${(r.ms / 1000).toFixed(1)}s` : '', r.via ?? ''].filter(Boolean).join(' · ');
    return t.intent ? `${line}\nSearched: ${t.intent.queries.join(' · ')}` : line;
  }
  if (t.live?.nodes.length) return 'Composing…';
  if (t.search) return `${t.search.results.length} sources · reading`;
  return t.plan ? 'Planning the layout…' : undefined;
}

/** Overlays (sources sheet, reader) get a history entry so the back button closes them instead of leaving the chat. */
const overlayOpen = () => (history.state as { overlay?: boolean } | null)?.overlay === true;
const pushOverlay = () => {
  if (!overlayOpen()) history.pushState({ overlay: true }, '');
};
const popOverlay = () => {
  if (overlayOpen()) history.back();
};

export default function App() {
  const initial = useMemo(() => new URLSearchParams(location.search), []);
  const [dark, setDark] = useTheme();
  const { turns, actions: session } = useSession();
  const { items: suggestions, shuffle, shuffleEnabled } = useSuggestions();
  const [recents, setRecents] = useState<string[]>(() => (typeof window !== 'undefined' ? readRecents() : []));
  const [phExamples] = useState(() => placeholderExamples());
  const [phIndex, setPhIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setPhIndex((i) => (i + 1) % phExamples.length), 4000);
    return () => window.clearInterval(id);
  }, [phExamples.length]);
  const [input, setInput] = useState(initial.get('q') ?? '');
  const [chat, setChat] = useState(0);
  const mainRef = useRef<HTMLDivElement>(null);
  const home = turns.length === 0;
  const root = turns[0];
  const last = [...turns].reverse().find((t) => t.result);
  const busy = turns.some((t) => t.filling);
  const title = root?.result?.card.title ?? root?.question ?? '';
  const railTurn = [...turns].reverse().find((t) => t.kind === 'search' && t.search?.results.length);
  const library = useMemo(() => buildLibrary(turns), [turns]);
  const [sheet, setSheet] = useState<{ open: boolean; scope?: number }>({ open: false });
  const [reading, setReading] = useState<LibraryEntry | null>(null);
  const scopeTurn = turns.find((t) => t.id === sheet.scope);
  const overlay = useRef(false);
  overlay.current = sheet.open || !!reading;
  const shown = useRef(initial.get('q') ?? '');

  const openSources = useCallback((scope?: number) => {
    pushOverlay();
    setSheet({ open: true, scope });
  }, []);
  const read = (e: LibraryEntry) => {
    pushOverlay();
    setReading(e);
  };
  const libraryRef = useRef(library);
  libraryRef.current = library;
  /** Opens a source a card points at in the reader, with whatever the conversation already knows about it. */
  const readSource = useCallback((result: SearchResult, searchId: number) => {
    pushOverlay();
    setReading(libraryRef.current.find((e) => e.result.url === result.url) ?? { result, searchId, citedBy: [] });
  }, []);
  const closeOverlays = () => {
    setSheet((s) => ({ ...s, open: false }));
    setReading(null);
  };
  /** Clears what belongs to the old conversation: open sheets, the reader and the composer's quote. */
  const resetUi = () => {
    closeOverlays();
    setChat((n) => n + 1);
  };

  const startSearch = (q: string) => {
    const query = q.trim();
    if (!query) return;
    shown.current = query;
    setRecents(pushRecent(query));
    history.pushState(null, '', `?${new URLSearchParams({ q: query })}`);
    session.search(query, { reset: true });
  };

  const editStarter = (text: string) => {
    setInput(text);
  };

  const newChat = () => {
    session.clear();
    resetUi();
    setInput('');
    shown.current = '';
    history.pushState(null, '', '/');
  };

  useEffect(() => {
    const openQuery = (q: string) => {
      const cached = readAnswerCache(q);
      if (cached) session.restore(cached);
      else session.search(q, { reset: true });
    };
    const q = initial.get('q');
    if (q) openQuery(q);
    const onPop = () => {
      if (overlay.current) return closeOverlays();
      const next = new URLSearchParams(location.search).get('q') ?? '';
      // Closing an overlay steps back onto the entry for the chat that's already showing.
      if (next === shown.current) return;
      shown.current = next;
      resetUi();
      if (next) openQuery(next);
      else session.clear();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (busy) return;
    const first = turns[0];
    if (!first || first.kind !== 'search' || !first.result) return;
    if (turns.some((t) => t.error)) return;
    const query = shown.current;
    if (!query) return;
    if (normalizeAnswerQuery(first.question) !== normalizeAnswerQuery(query)) return;
    writeAnswerCache(query, turns);
  }, [turns, busy]);

  const onSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    startSearch(input);
  };

  return (
    <>
      <div className="relative min-h-dvh">
        <div className="zo-wash" data-on={busy} aria-hidden />

        {home ? (
          <>
            <header className="flex h-14 items-center justify-end px-3 sm:px-5">
              <ThemeToggle dark={dark} onToggle={() => setDark(!dark)} />
            </header>
            <main className="relative mx-auto flex w-full max-w-[640px] flex-col px-4 pb-16 pt-[10dvh] sm:pt-[16dvh]">
              <h1 className="flex justify-center">
                <Wordmark className="text-[40px] sm:text-[48px]" />
                <span className="sr-only">ZO</span>
              </h1>
              <p className="mx-auto mt-3 max-w-[22rem] text-center text-[14px] leading-snug text-muted-foreground sm:mt-4 sm:max-w-none sm:text-[15px]">
                {TAGLINE}
              </p>
              <form onSubmit={onSearchSubmit} className="group relative mt-6 sm:mt-8">
                <Search className="pointer-events-none absolute left-5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={phExamples[phIndex]}
                  aria-label="Ask anything"
                  enterKeyHint="send"
                  autoFocus
                  className="h-14 rounded-2xl border-input bg-card pl-12 pr-14 text-base shadow-card transition-shadow focus-visible:shadow-float focus-visible:ring-0 md:text-base"
                />
                <Button type="submit" size="icon" className="absolute right-2 top-1/2 size-10 -translate-y-1/2 rounded-xl" disabled={!input.trim()} aria-label="Send">
                  <ArrowUp className="size-4" />
                </Button>
              </form>
              {recents.length > 0 && (
                <div className="mt-5 sm:mt-6">
                  <div className="mb-1.5 flex items-center justify-between px-1">
                    <h2 className="zo-label">Recent</h2>
                    <button
                      type="button"
                      className="text-[12px] text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        localStorage.removeItem(RECENTS_KEY);
                        setRecents([]);
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {recents.slice(0, 3).map((r, i) => (
                      <li key={r} className={cn(i >= 2 && 'hidden sm:block')}>
                        <button
                          type="button"
                          onClick={() => startSearch(r)}
                          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] leading-snug text-foreground/70 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
                        >
                          <RotateCw className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 break-words">{r}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-5 sm:mt-6">
                <div className="mb-1.5 flex items-center justify-between px-1">
                  <h2 className="zo-label">Try one</h2>
                  {shuffleEnabled && (
                    <button
                      type="button"
                      onClick={shuffle}
                      aria-label="Shuffle suggestions"
                      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-2 text-[12px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
                    >
                      <Shuffle className="size-3.5" />
                      Shuffle
                    </button>
                  )}
                </div>
                <ul className="flex flex-col gap-1 sm:grid sm:grid-cols-2 sm:gap-x-3 sm:gap-y-1">
                  {suggestions.map((s, i) => (
                    <li key={s.id} className="animate-in fade-in fill-mode-backwards duration-500" style={{ animationDelay: `${i * 40}ms` }}>
                      <div className="flex min-h-11 items-stretch gap-0.5 rounded-xl hover:bg-foreground/[0.04]">
                        <button
                          type="button"
                          onClick={() => startSearch(s.text)}
                          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] leading-snug text-foreground/80 transition-colors hover:text-foreground"
                        >
                          <Icon name={s.icon} fallback="sparkles" className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 break-words">{s.text}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => editStarter(s.text)}
                          aria-label={`Edit: ${s.text}`}
                          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
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
                {library.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-2 rounded-lg px-2 text-muted-foreground hover:text-foreground lg:hidden" onClick={() => openSources()} aria-label="Sources">
                    <FaviconStack domains={library.slice(0, 3).map((e) => e.result.domain)} />
                    <span className="zo-meta">{library.length}</span>
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-muted-foreground hover:text-foreground" onClick={newChat}>
                  <Plus className="size-4" />
                  <span className="hidden sm:inline">New chat</span>
                </Button>
                <ThemeToggle dark={dark} onToggle={() => setDark(!dark)} />
              </div>
            </header>

            <div className={cn(SHELL, GRID, 'relative pb-[50vh] pt-5 sm:pt-8')}>
              <main ref={mainRef} className="min-w-0 space-y-8 sm:space-y-10">
                {turns.map((t, i) => <TurnView key={t.id} turn={t} first={i === 0} search={session.searchOf(t)?.search} actions={session} onSources={openSources} onRead={readSource} />)}

                {last?.result && last.result.followups.length > 0 && !busy && (
                  <section className="-mt-2 px-4 animate-in fade-in sm:-mt-4 sm:px-6">
                    <h3 className="zo-label mb-0.5">Related</h3>
                    <ul className="divide-y">
                      {last.result.followups.map((f) => (
                        <li key={f}>
                          <button onClick={() => session.followup(f, last.id, 'ask')} className="group flex w-full items-center gap-3 py-3 text-left text-[14px] leading-snug text-foreground/80 transition-colors hover:text-foreground">
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
                {library.length > 0 && (
                  <div className="sticky top-[calc(5.5rem-10px)] -mt-2.5 pt-2.5 max-h-[calc(100dvh-7rem+10px)] overflow-y-auto no-scrollbar">
                    <SourcesRail entries={library} engines={railTurn?.search?.engines ?? []} onRead={read} onAll={() => openSources()} />
                  </div>
                )}
              </aside>
            </div>

            <SourcesSheet
              open={sheet.open}
              onOpenChange={(open) => {
                if (open) return;
                setSheet((s) => ({ ...s, open: false }));
                popOverlay();
              }}
              entries={library}
              scope={scopeTurn?.result ? { id: scopeTurn.id, title: scopeTurn.result.card.title } : undefined}
              onClearScope={() => setSheet({ open: true })}
              onRead={(e) => { setSheet((s) => ({ ...s, open: false })); setReading(e); }}
            />
            <Reader
              result={reading?.result ?? null}
              query={turns.find((t) => t.id === reading?.searchId)?.question ?? ''}
              onClose={() => {
                setReading(null);
                popOverlay();
              }}
              onDigest={(r) => reading && session.digest(r, reading.searchId)}
            />
          </>
        )}

        {!home && <Composer key={chat} actions={session} topic={root?.question ?? ''} mainRef={mainRef} />}
      </div>
    </>
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

/** The follow-up box. Its own component so typing doesn't re-render the conversation; remounted per chat. */
function Composer({ actions, topic, mainRef }: { actions: SessionActions; topic: string; mainRef: RefObject<HTMLDivElement | null> }) {
  const [message, setMessage] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteMode, setQuoteMode] = useState<QuoteMode>('explain');

  // Highlighting text inside a card turns it into a quote for the composer; it stays until sent or dismissed.
  useEffect(() => {
    const onSelect = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      const node = sel?.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      const turnEl = el?.closest<HTMLElement>('[data-turn]');
      if (text.length < 3 || !turnEl || !mainRef.current?.contains(turnEl)) return;
      const next = { text: text.slice(0, 600), turnId: Number(turnEl.dataset.turn) };
      setQuote((q) => (q?.text === next.text && q.turnId === next.turnId ? q : next));
    };
    document.addEventListener('selectionchange', onSelect);
    return () => document.removeEventListener('selectionchange', onSelect);
  }, [mainRef]);

  const save = async ({ text, turnId }: Quote) => {
    const pinText = () => actions.pin(turnId, { type: 'list', style: 'icon', items: [{ text, icon: 'pin' }] });
    try {
      const out = await api.slot(topic, text);
      switch (out.slot) {
        case 'stat': return out.stat ? actions.pin(turnId, { type: 'stat', label: out.stat.label, value: out.stat.value, icon: 'hash' }) : pinText();
        case 'timeline': return out.timeline ? actions.pin(turnId, { type: 'timeline', items: [{ when: out.timeline.when, title: out.timeline.text }] }) : pinText();
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
          void actions.followup(`Explain "${q.text}"${note ? ` — ${note}` : ''}`, q.turnId);
          break;
        case 'expand':
          void actions.followup(`Go deeper on "${q.text}"${note ? ` — ${note}` : ''}`, q.turnId);
          break;
        case 'search':
          void actions.followup(note ? `${q.text} — ${note}` : q.text, q.turnId, 'search');
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
      void actions.followup(note);
    } else return;
    setMessage('');
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-background via-background/85 to-transparent pb-[calc(env(safe-area-inset-bottom)+12px)] pt-10">
      <div className={cn(SHELL, GRID)}>
        <form onSubmit={send} className="pointer-events-auto overflow-hidden rounded-2xl border border-input bg-popover shadow-float">
          {quote && (
            <div className="space-y-2 border-b px-3 pb-2.5 pt-3 animate-in fade-in slide-in-from-bottom-1">
              <div className="flex items-start gap-2">
                <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <p className="line-clamp-2 flex-1 text-xs leading-relaxed text-muted-foreground">{quote.text}</p>
                <button type="button" onClick={() => { setQuote(null); window.getSelection()?.removeAllRanges(); }} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss quote">
                  <X className="size-3.5" />
                </button>
              </div>
              <ToggleGroup type="single" size="sm" value={quoteMode} onValueChange={(v) => v && setQuoteMode(v as QuoteMode)} className="no-scrollbar w-full justify-start overflow-x-auto overscroll-x-contain">
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
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={quote ? (quoteMode === 'save' ? 'Press send to pin it' : 'Add a note (optional)') : 'Ask a follow-up'}
              aria-label="Ask a follow-up"
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
  );
}

const TurnView = memo(function TurnView({ turn, first, search, actions, onSources, onRead }: {
  turn: Turn;
  first: boolean;
  /** Results of the search this turn builds on. */
  search?: SearchResponse;
  actions: SessionActions;
  onSources: (scope?: number) => void;
  onRead: (result: SearchResult, searchId: number) => void;
}) {
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
    (search?.images ?? []).forEach((i) => (out[i.thumb] = { credit: i.credit ?? i.source, link: i.url }));
    [...(turn.live?.credits ?? []), ...(card.credits ?? [])].forEach((c) => (out[c.src] = { credit: c.credit, link: c.link }));
    return out;
  }, [search?.images, turn.live?.credits, card.credits]);

  const id = turn.id;
  const pendingRefine = useRef<string | null>(null);
  useEffect(() => {
    if (!turn.filling && pendingRefine.current) {
      const value = pendingRefine.current;
      pendingRefine.current = null;
      void actions.followup(value, id, 'adjust');
    }
  }, [turn.filling, actions, id]);
  const context: CardContextValue = useMemo(() => ({
    results: search?.results ?? [],
    images: search?.images ?? [],
    credits,
    busy: turn.filling,
    onSearch: (q) => void actions.followup(q, id, 'search'),
    onAsk: (q) => void actions.followup(q, id, 'ask'),
    onRefine: (instruction) => {
      if (turn.filling) {
        pendingRefine.current = instruction;
        return;
      }
      void actions.followup(instruction, id, 'adjust');
    },
    onSources: () => onSources(id),
    onRead: (r) => onRead(r, turn.searchId),
  }), [search?.results, search?.images, credits, turn.filling, actions, id, onSources, onRead, turn.searchId]);

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
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>{turn.error}</p>
          {turn.retryable && (
            <button type="button" data-testid="retry" onClick={() => actions.retry(id)} className="mx-auto mt-4 inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-4 text-foreground transition-colors hover:bg-foreground/5">
              <RotateCw className="size-4" />
              Retry
            </button>
          )}
        </div>
      ) : (
        <CardContext.Provider value={context}>
          <AnswerCardView
            card={card}
            version={`${turn.id}-${turn.version}`}
            filling={turn.filling}
            streaming={streaming}
            status={turn.status ?? (turn.thinking && !streaming ? 'Thinking it through…' : undefined)}
            pattern={turn.pattern}
            alternatives={turn.kind === 'digest' ? [] : turn.plan?.alternatives ?? []}
            engine={engineLabel(turn)}
            onPattern={(p) => actions.setPattern(id, p)}
            simple={turn.simple}
            onSimple={(v) => actions.setSimple(id, v)}
            onRegenerate={() => actions.redesign(id)}
          />
        </CardContext.Provider>
      )}
    </section>
  );
});
