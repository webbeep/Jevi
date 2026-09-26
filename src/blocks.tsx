import { useMemo, useState } from 'react';
import type {
  Comparison,
  Discussion,
  ImageResult,
  Knowledge,
  KeyPoint,
  SearchResult,
  Stat,
  SummaryLength,
  TimelineItem,
} from '../shared/types';
import { Block, Favicon, RichText, Skeleton, timeAgo } from './ui';

export function AnswerBlock({ answer }: { answer: KeyPoint & { confidence: number } }) {
  return (
    <section className="block answer">
      <div className="answer-label">Quick answer</div>
      <p className="answer-text">{answer.text}</p>
      {answer.url && (
        <a className="answer-src" href={answer.url} target="_blank" rel="noreferrer">
          {answer.domain && <Favicon domain={answer.domain} />} {answer.domain}
        </a>
      )}
      <div className="confidence" title="Jev confidence">
        <div style={{ width: `${Math.round(answer.confidence * 100)}%` }} />
      </div>
    </section>
  );
}

export function SummaryBlock(props: {
  text?: string;
  loading: boolean;
  length: SummaryLength;
  simple: boolean;
  results: SearchResult[];
  onLength: (l: SummaryLength) => void;
  onSimple: (s: boolean) => void;
}) {
  const { text, loading, length, simple, results, onLength, onSimple } = props;
  return (
    <Block
      icon="✨"
      title="Overview"
      className="summary"
      extra={
        <div className="controls">
          <div className="segmented" role="group" aria-label="Length">
            {(['short', 'medium', 'long'] as const).map((l) => (
              <button key={l} className={l === length ? 'on' : ''} onClick={() => onLength(l)}>
                {l === 'short' ? 'S' : l === 'medium' ? 'M' : 'L'}
              </button>
            ))}
          </div>
          <button className={`chip ${simple ? 'on' : ''}`} onClick={() => onSimple(!simple)}>
            🧸 Simple
          </button>
        </div>
      }
    >
      {loading || !text ? <Skeleton lines={4} /> : <div className="prose"><RichText text={text} results={results} /></div>}
    </Block>
  );
}

export function KnowledgeBlock({ k }: { k: Knowledge }) {
  return (
    <section className="block knowledge">
      {k.image && <img src={k.image} alt={k.title} className="knowledge-img" />}
      <div className="knowledge-body">
        <h2>{k.title}</h2>
        {k.description && <div className="muted">{k.description}</div>}
        <p>{k.extract.length > 480 ? `${k.extract.slice(0, 480)}…` : k.extract}</p>
        <a href={k.url} target="_blank" rel="noreferrer" className="link">Read more →</a>
      </div>
    </section>
  );
}

export function StatsBlock({ stats, fresh }: { stats: Stat[]; fresh?: string }) {
  return (
    <Block icon="📊" title="By the numbers">
      <div className="stats">
        {stats.map((s) => (
          <a key={s.value + s.label} className={`stat ${fresh === s.value ? 'flash' : ''}`} href={s.url} target="_blank" rel="noreferrer">
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </a>
        ))}
      </div>
    </Block>
  );
}

export function TimelineBlock({ items, fresh }: { items: TimelineItem[]; fresh?: string }) {
  return (
    <Block icon="🕰️" title="Timeline">
      <ol className="timeline">
        {items.map((t) => (
          <li key={t.when + t.text} className={fresh === t.text ? 'flash' : ''}>
            <span className="when">{t.when}</span>
            <span className="what">
              {t.text}
              {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="link"> ↗</a>}
            </span>
          </li>
        ))}
      </ol>
    </Block>
  );
}

export function GalleryBlock({ images }: { images: ImageResult[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const current = open === null ? undefined : images[open];
  return (
    <Block icon="🖼️" title="Pictures">
      <div className="gallery">
        {images.slice(0, 12).map((img, i) => (
          <button key={img.thumb} className="gallery-item" onClick={() => setOpen(i)}>
            <img src={img.thumb} alt={img.title} loading="lazy" onError={(e) => ((e.target as HTMLElement).parentElement!.style.display = 'none')} />
          </button>
        ))}
      </div>
      {current && (
        <div className="lightbox" onClick={() => setOpen(null)}>
          <img src={current.thumb} alt={current.title} />
          <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setOpen((open! - 1 + images.length) % images.length)}>‹</button>
            <a href={current.url} target="_blank" rel="noreferrer">{current.title || current.source} ↗</a>
            <button onClick={() => setOpen((open! + 1) % images.length)}>›</button>
          </div>
        </div>
      )}
    </Block>
  );
}

export function KeyPointsBlock({ points, fresh }: { points: KeyPoint[]; fresh?: string }) {
  return (
    <Block icon="📌" title="Key points">
      <ul className="keypoints">
        {points.map((p) => (
          <li key={p.text} className={fresh === p.text ? 'flash' : ''}>
            <span>{p.text}</span>
            {p.domain && p.url && (
              <a href={p.url} target="_blank" rel="noreferrer" className="kp-src">
                <Favicon domain={p.domain} />
              </a>
            )}
          </li>
        ))}
      </ul>
    </Block>
  );
}

export function ComparisonBlock({ data, loading }: { data?: Comparison; loading: boolean }) {
  const [highlight, setHighlight] = useState<number | null>(null);
  return (
    <Block icon="⚖️" title="Side by side">
      {loading || !data ? <Skeleton lines={5} /> : (
        <div className="table-wrap">
          <table className="compare">
            <thead>
              <tr>
                <th />
                {data.columns.map((c, i) => (
                  <th key={c} className={highlight === i ? 'hl' : ''} onClick={() => setHighlight(highlight === i ? null : i)}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.label}>
                  <th>{r.label}</th>
                  {r.values.map((v, i) => <td key={i} className={highlight === i ? 'hl' : ''}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Block>
  );
}

export function StepsBlock({ steps, loading }: { steps?: { title: string; detail: string }[]; loading: boolean }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setDone((d) => {
    const next = new Set(d);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });
  return (
    <Block icon="🪜" title="Step by step" extra={steps && <span className="muted">{done.size}/{steps.length} done</span>}>
      {loading || !steps ? <Skeleton lines={4} /> : (
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={s.title} className={done.has(i) ? 'done' : ''} onClick={() => toggle(i)}>
              <span className="step-num">{done.has(i) ? '✓' : i + 1}</span>
              <div><strong>{s.title}</strong><div className="muted">{s.detail}</div></div>
            </li>
          ))}
        </ol>
      )}
    </Block>
  );
}

export function ProsConsBlock({ pros, cons, loading }: { pros?: string[]; cons?: string[]; loading: boolean }) {
  return (
    <Block icon="🤔" title="Pros & cons">
      {loading || !pros ? <Skeleton lines={4} /> : (
        <div className="proscons">
          <ul className="pros">{pros.map((p) => <li key={p}>{p}</li>)}</ul>
          <ul className="cons">{(cons ?? []).map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
    </Block>
  );
}

export function DiscussionBlock({ items }: { items: Discussion[] }) {
  const max = Math.max(...items.map((d) => d.points), 1);
  return (
    <Block icon="💬" title="People are discussing">
      <ul className="discussion">
        {items.map((d) => (
          <li key={d.url}>
            <a href={d.url} target="_blank" rel="noreferrer">{d.title}</a>
            <div className="bar"><div style={{ width: `${(d.points / max) * 100}%` }} /></div>
            <span className="muted">▲ {d.points} · {d.comments} comments · {timeAgo(d.date)}</span>
          </li>
        ))}
      </ul>
    </Block>
  );
}

export function ResultsBlock({ results, onRead, onSearch }: {
  results: SearchResult[];
  onRead: (r: SearchResult) => void;
  onSearch: (q: string) => void;
}) {
  const [site, setSite] = useState<string | null>(null);
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const domains = useMemo(() => {
    const counts = new Map<string, number>();
    results.forEach((r) => counts.set(r.domain, (counts.get(r.domain) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([d]) => d);
  }, [results]);
  const shown = site ? results.filter((r) => r.domain === site) : results;

  return (
    <Block
      icon="🔗"
      title="Sources"
      extra={
        <div className="segmented">
          <button className={view === 'cards' ? 'on' : ''} onClick={() => setView('cards')} aria-label="Card view">▦</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')} aria-label="List view">☰</button>
        </div>
      }
    >
      <div className="chips scroll">
        <button className={`chip ${site === null ? 'on' : ''}`} onClick={() => setSite(null)}>All {results.length}</button>
        {domains.map((d) => (
          <button key={d} className={`chip ${site === d ? 'on' : ''}`} onClick={() => setSite(site === d ? null : d)}>
            <Favicon domain={d} /> {d}
          </button>
        ))}
      </div>
      <div className={view === 'cards' ? 'results-grid' : 'results-list'}>
        {shown.map((r) => (
          <article key={r.url} className="result">
            {view === 'cards' && r.image && <img className="result-img" src={r.image} alt="" loading="lazy" onError={(e) => ((e.target as HTMLElement).style.display = 'none')} />}
            <div className="result-meta">
              <Favicon domain={r.domain} /> <span>{r.domain}</span>
              {r.date && <span className="muted">· {timeAgo(r.date)}</span>}
              <span className="engines" title={`Found by ${r.engines.join(', ')}`}>{r.engines.length > 1 ? `×${r.engines.length}` : ''}</span>
            </div>
            <a className="result-title" href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
            <p className="result-snippet">{r.snippet}</p>
            <div className="result-actions">
              <button className="chip" onClick={() => onRead(r)}>📖 Digest page</button>
              <button className="chip" onClick={() => onSearch(`site:${r.domain} `)}>🔎 More from site</button>
            </div>
          </article>
        ))}
      </div>
    </Block>
  );
}
