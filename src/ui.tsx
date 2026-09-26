import { Fragment, type ReactNode } from 'react';
import type { SearchResult } from '../shared/types';

export function Favicon({ domain }: { domain: string }) {
  return <img className="favicon" src={`https://icons.duckduckgo.com/ip3/${domain}.ico`} alt="" loading="lazy" />;
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" aria-busy="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton-line" style={{ width: `${95 - i * 12}%` }} />
      ))}
    </div>
  );
}

/** Renders **bold** and [n] citations that link to the nth search result. */
export function RichText({ text, results = [] }: { text: string; results?: SearchResult[] }) {
  return (
    <>
      {text.split(/\n{2,}/).map((para, p) => (
        <p key={p}>
          {para.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((part, i): ReactNode => {
            const bold = part.match(/^\*\*(.+)\*\*$/);
            if (bold) return <strong key={i}>{bold[1]}</strong>;
            const cite = part.match(/^\[(\d+)\]$/);
            if (cite) {
              const r = results[Number(cite[1]) - 1];
              return r ? (
                <a key={i} className="cite" href={r.url} target="_blank" rel="noreferrer" title={r.title}>
                  {cite[1]}
                </a>
              ) : null;
            }
            return <Fragment key={i}>{part}</Fragment>;
          })}
        </p>
      ))}
    </>
  );
}

export function Block({ icon, title, extra, children, className = '' }: {
  icon: string;
  title: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`block ${className}`}>
      <header className="block-head">
        <span className="block-icon" aria-hidden>{icon}</span>
        <h2>{title}</h2>
        {extra && <div className="block-extra">{extra}</div>}
      </header>
      {children}
    </section>
  );
}

export function timeAgo(date: string): string {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return date;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
