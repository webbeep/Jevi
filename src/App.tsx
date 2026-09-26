import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type {
  AiResult,
  AiTask,
  ComponentKind,
  Freshness,
  HealthResponse,
  KeyPoint,
  Layout,
  SearchResponse,
  SearchResult,
  Stat,
  SummaryLength,
  TimelineItem,
} from '../shared/types';
import { api } from './api';
import {
  AnswerBlock,
  ComparisonBlock,
  DiscussionBlock,
  GalleryBlock,
  KeyPointsBlock,
  KnowledgeBlock,
  ProsConsBlock,
  ResultsBlock,
  StatsBlock,
  StepsBlock,
  SummaryBlock,
  TimelineBlock,
} from './blocks';
import { withBrowserFallback } from './fallback';
import { Block, RichText, Skeleton } from './ui';

interface Card {
  id: number;
  icon: string;
  title: string;
  body?: string;
  bullets?: string[];
  url?: string;
  loading: boolean;
  error?: string;
}

interface Pinned {
  keyPoints: KeyPoint[];
  stats: Stat[];
  timeline: TimelineItem[];
}

const EMPTY_PINS: Pinned = { keyPoints: [], stats: [], timeline: [] };

const FRESHNESS: { id: Freshness; label: string }[] = [
  { id: 'any', label: 'Any time' },
  { id: 'day', label: '24h' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];

const SUGGESTIONS = ['iPhone 17 vs Pixel 10', 'how to make sourdough bread', 'history of the Roman Empire', 'Tokyo', 'what is quantum computing', 'best budget running shoes'];

let cardSeq = 0;

export default function App() {
  const initial = new URLSearchParams(location.search);
  const [input, setInput] = useState(initial.get('q') ?? '');
  const [query, setQuery] = useState('');
  const [freshness, setFreshness] = useState<Freshness>((initial.get('t') as Freshness) || 'any');
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [ai, setAi] = useState<AiResult>({});
  const [aiPending, setAiPending] = useState<Set<AiTask>>(new Set());
  const [length, setLength] = useState<SummaryLength>('medium');
  const [simple, setSimple] = useState(false);
  const [pins, setPins] = useState<Pinned>(EMPTY_PINS);
  const [fresh, setFresh] = useState<string>();
  const [cards, setCards] = useState<Card[]>([]);
  const [phase, setPhase] = useState<'idle' | 'searching' | 'composing' | 'ready'>('idle');
  const [error, setError] = useState<string>();
  const [health, setHealth] = useState<HealthResponse>();
  const [selection, setSelection] = useState<string>('');
  const [followup, setFollowup] = useState('');
  const [asking, setAsking] = useState(false);
  const runId = useRef(0);
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => undefined);
  }, []);

  const runGenerate = useCallback(async (s: SearchResponse, tasks: AiTask[], len: SummaryLength, simpleMode: boolean, id: number) => {
    if (!tasks.length) return;
    setAiPending((p) => new Set([...p, ...tasks]));
    try {
      const out = await api.generate({ query: s.query, tasks, length: len, simple: simpleMode, results: s.results.slice(0, 10), knowledge: s.knowledge });
      if (id === runId.current) setAi((prev) => ({ ...prev, ...out }));
    } catch (err) {
      console.error(err);
    } finally {
      if (id === runId.current) setAiPending((p) => new Set([...p].filter((t) => !tasks.includes(t))));
    }
  }, []);

  const runSearch = useCallback(async (q: string, t: Freshness = freshness) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const id = ++runId.current;
    setInput(trimmed);
    setQuery(trimmed);
    setPhase('searching');
    setError(undefined);
    setSearch(null);
    setLayout(null);
    setAi({});
    setAiPending(new Set());
    setPins(EMPTY_PINS);
    setCards([]);
    setSimple(false);
    const params = new URLSearchParams({ q: trimmed });
    if (t !== 'any') params.set('t', t);
    history.pushState(null, '', `?${params}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const s = await withBrowserFallback(await api.search(trimmed, t));
      if (id !== runId.current) return;
      setSearch(s);
      if (!s.results.length) {
        setPhase('ready');
        setError('No results from any engine. Try rephrasing.');
        return;
      }
      setPhase('composing');
      const l = await api.compose(s);
      if (id !== runId.current) return;
      setLayout(l);
      setLength(l.summaryLength);
      setPhase('ready');
      void runGenerate(s, l.aiTasks, l.summaryLength, false, id);
    } catch (err) {
      if (id !== runId.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase('ready');
    }
  }, [freshness, runGenerate]);

  useEffect(() => {
    if (initial.get('q')) void runSearch(initial.get('q')!);
    const onPop = () => {
      const q = new URLSearchParams(location.search).get('q');
      if (q) void runSearch(q);
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

  const addCard = (card: Omit<Card, 'id'>) => {
    const id = ++cardSeq;
    setCards((c) => [{ ...card, id }, ...c]);
    return id;
  };
  const updateCard = (id: number, patch: Partial<Card>) => setCards((c) => c.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const flash = (key: string) => {
    setFresh(key);
    setTimeout(() => setFresh(undefined), 1600);
  };

  const pinKeyPoint = (text: string) => {
    setPins((p) => ({ ...p, keyPoints: [{ text }, ...p.keyPoints] }));
    flash(text);
  };

  const explain = async (text: string) => {
    if (!search) return;
    const id = addCard({ icon: '💡', title: `Explain: “${text.length > 60 ? `${text.slice(0, 60)}…` : text}”`, loading: true });
    try {
      const out = await api.ask({ query, question: `Explain this in plain words: "${text}"`, results: search.results.slice(0, 8) });
      if (out.kind === 'answer') updateCard(id, { body: out.answer, loading: false });
      else updateCard(id, { body: 'Not enough context in these results — searching for it instead.', loading: false });
      if (out.kind === 'search') void runSearch(out.query);
    } catch (err) {
      updateCard(id, { error: String(err), loading: false });
    }
  };

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelection('');
  };

  const autoPlace = async (text: string) => {
    clearSelection();
    try {
      const out = await api.slot(query, text);
      switch (out.slot) {
        case 'key_point':
          pinKeyPoint(text);
          break;
        case 'stat':
          if (out.stat) {
            setPins((p) => ({ ...p, stats: [out.stat!, ...p.stats] }));
            flash(out.stat.value);
          }
          break;
        case 'timeline':
          if (out.timeline) {
            setPins((p) => ({ ...p, timeline: [...p.timeline, out.timeline!] }));
            flash(out.timeline.text);
          }
          break;
        case 'search':
          void runSearch(text);
          break;
        case 'explain':
          void explain(text);
          break;
        default: {
          const unreachable: never = out.slot;
          throw new Error(`Unknown slot ${unreachable}`);
        }
      }
    } catch {
      pinKeyPoint(text);
    }
  };

  const digest = async (r: SearchResult) => {
    const id = addCard({ icon: '📖', title: r.title, url: r.url, loading: true });
    try {
      const out = await api.read(r.url, query);
      updateCard(id, { body: out.tldr, bullets: out.bullets, loading: false });
    } catch (err) {
      updateCard(id, { error: err instanceof Error ? err.message : String(err), loading: false });
    }
  };

  const askFollowup = async (question: string) => {
    if (!search || !question.trim()) return;
    setAsking(true);
    setFollowup('');
    const id = addCard({ icon: '🙋', title: question, loading: true });
    try {
      const out = await api.ask({ query, question, results: search.results.slice(0, 10) });
      if (out.kind === 'answer') updateCard(id, { body: out.answer, loading: false });
      else {
        setCards((c) => c.filter((x) => x.id !== id));
        void runSearch(out.query);
      }
    } catch (err) {
      updateCard(id, { error: err instanceof Error ? err.message : String(err), loading: false });
    } finally {
      setAsking(false);
    }
  };

  const regenSummary = (len: SummaryLength, simpleMode: boolean) => {
    setLength(len);
    setSimple(simpleMode);
    if (search) void runGenerate(search, ['summary'], len, simpleMode, runId.current);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void runSearch(input);
  };

  const blocks: ComponentKind[] = layout ? [...layout.blocks] : search ? ['results'] : [];
  const ensure = (kind: ComponentKind, has: boolean) => {
    if (has && !blocks.includes(kind)) blocks.splice(Math.max(blocks.indexOf('results'), 0), 0, kind);
  };
  ensure('key_points', pins.keyPoints.length > 0);
  ensure('stats', pins.stats.length > 0);
  ensure('timeline', pins.timeline.length > 0);

  const renderBlock = (kind: ComponentKind): ReactNode => {
    if (!search) return null;
    switch (kind) {
      case 'answer':
        return layout?.answer ? <AnswerBlock answer={layout.answer} /> : null;
      case 'summary':
        return (
          <SummaryBlock
            text={ai.summary}
            loading={aiPending.has('summary')}
            length={length}
            simple={simple}
            results={search.results}
            onLength={(l) => regenSummary(l, simple)}
            onSimple={(s) => regenSummary(length, s)}
          />
        );
      case 'knowledge':
        return search.knowledge ? <KnowledgeBlock k={search.knowledge} /> : null;
      case 'stats':
        return <StatsBlock stats={[...pins.stats, ...(layout?.stats ?? [])]} fresh={fresh} />;
      case 'timeline':
        return (
          <TimelineBlock
            items={[...(layout?.timeline ?? []), ...pins.timeline].sort((a, b) => Number(a.when) - Number(b.when))}
            fresh={fresh}
          />
        );
      case 'gallery':
        return <GalleryBlock images={search.images} />;
      case 'key_points':
        return <KeyPointsBlock points={[...pins.keyPoints, ...(layout?.keyPoints ?? [])]} fresh={fresh} />;
      case 'comparison':
        return <ComparisonBlock data={ai.comparison} loading={aiPending.has('comparison')} />;
      case 'steps':
        return <StepsBlock steps={ai.steps} loading={aiPending.has('steps')} />;
      case 'pros_cons':
        return <ProsConsBlock pros={ai.pros} cons={ai.cons} loading={aiPending.has('pros_cons')} />;
      case 'discussion':
        return <DiscussionBlock items={search.discussions} />;
      case 'results':
        return <ResultsBlock results={search.results} onRead={digest} onSearch={(prefix) => runSearch(prefix + query)} />;
      default: {
        const unreachable: never = kind;
        throw new Error(`Unknown block ${unreachable}`);
      }
    }
  };

  const home = phase === 'idle';

  return (
    <div className={`app ${home ? 'home' : ''}`}>
      <header className="top">
        <button className="brand" onClick={() => { runId.current++; setPhase('idle'); setSearch(null); setInput(''); history.pushState(null, '', '/'); }}>
          <span className="logo">🔮</span> <span>Jevi</span>
        </button>
        <form className="searchbar" onSubmit={onSubmit}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search anything, see it visually…"
            enterKeyHint="search"
            autoFocus={home}
          />
          <button type="submit" aria-label="Search">{phase === 'searching' ? <span className="spinner" /> : '→'}</button>
        </form>
        {home && (
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip" onClick={() => runSearch(s)}>{s}</button>
            ))}
          </div>
        )}
        {!home && (
          <div className="chips scroll">
            {FRESHNESS.map((f) => (
              <button key={f.id} className={`chip ${freshness === f.id ? 'on' : ''}`} onClick={() => { setFreshness(f.id); void runSearch(query, f.id); }}>
                {f.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {!home && (
        <main ref={areaRef} className="area">
          {layout && (
            <div className="meta">
              <span className="pill">{layout.engine === 'jev' ? '🧠 Jev' : '⚙️ Auto'} · {layout.intent.replace('_', ' ')} {layout.intentConfidence ? `${Math.round(layout.intentConfidence * 100)}%` : ''}</span>
              <span className="muted">{search?.results.length} results · {search?.engines.filter((e) => e.ok).length}/{search?.engines.length} engines</span>
            </div>
          )}

          {layout && layout.actions.length > 0 && (
            <div className="chips scroll actions">
              {layout.actions.map((a) => (
                <button key={a.id} className="chip action" onClick={() => runSearch(a.query)}>{a.label}</button>
              ))}
            </div>
          )}

          {error && <div className="block error">{error}</div>}

          {cards.map((c) => (
            <Block key={c.id} icon={c.icon} title={c.title} className="card-thread" extra={<button className="x" onClick={() => setCards((cs) => cs.filter((x) => x.id !== c.id))}>✕</button>}>
              {c.loading ? <Skeleton lines={3} /> : c.error ? <div className="muted">⚠️ {c.error}</div> : (
                <div className="prose">
                  {c.body && <RichText text={c.body} results={search?.results} />}
                  {c.bullets && <ul>{c.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
                  {c.url && <a className="link" href={c.url} target="_blank" rel="noreferrer">Open page ↗</a>}
                </div>
              )}
            </Block>
          ))}

          {phase === 'searching' && (
            <div className="loading-grid">
              <div className="block"><Skeleton lines={2} /></div>
              <div className="block"><Skeleton lines={4} /></div>
              <div className="block"><Skeleton lines={3} /></div>
            </div>
          )}
          {phase === 'composing' && <div className="composing">🧠 Jev is arranging your results…</div>}

          <div className="blocks">
            {blocks.map((k) => {
              const node = renderBlock(k);
              return node ? <div key={k} className={`slot slot-${k}`}>{node}</div> : null;
            })}
          </div>

          {search && search.results.length > 0 && (
            <>
              {(ai.followups?.length ?? 0) > 0 && (
                <div className="chips followups">
                  {ai.followups!.map((f) => (
                    <button key={f} className="chip" onClick={() => askFollowup(f)}>💭 {f}</button>
                  ))}
                </div>
              )}
              <div className="engines-status">
                {search.engines.map((e) => (
                  <span key={e.name} title={e.ok ? `${e.count} results in ${e.ms}ms` : e.error} className={e.ok && e.count ? 'ok' : 'bad'}>
                    {e.name}
                  </span>
                ))}
                {health && !health.deepseek && <span className="bad">deepseek off</span>}
                {health && !health.jev && <span className="bad">jev off</span>}
              </div>
              <div className="hint">Tip: highlight any text above to pin it, explain it, or search it.</div>
            </>
          )}
        </main>
      )}

      {!home && search && (
        <div className="dock">
          {selection ? (
            <div className="selection-bar" onMouseDown={(e) => e.preventDefault()}>
              <span className="sel-text">“{selection.length > 40 ? `${selection.slice(0, 40)}…` : selection}”</span>
              <button className="chip on" onClick={() => autoPlace(selection)}>🧠 Place it</button>
              <button className="chip" onClick={() => { pinKeyPoint(selection); clearSelection(); }}>📌</button>
              <button className="chip" onClick={() => { const t = selection; clearSelection(); void explain(t); }}>💡</button>
              <button className="chip" onClick={() => { const t = selection; clearSelection(); void runSearch(t); }}>🔎</button>
            </div>
          ) : (
            <form className="followup" onSubmit={(e) => { e.preventDefault(); void askFollowup(followup); }}>
              <input value={followup} onChange={(e) => setFollowup(e.target.value)} placeholder="Ask a follow-up…" enterKeyHint="send" />
              <button type="submit" disabled={asking || !followup.trim()}>{asking ? <span className="spinner" /> : '↑'}</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
