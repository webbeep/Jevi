import { Fragment, type ReactNode } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { SearchResult } from '../shared/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

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
                <a key={i} className="mx-0.5 inline-grid size-4 place-items-center rounded bg-primary/15 text-[10px] font-bold text-primary no-underline hover:bg-primary hover:text-primary-foreground" href={r.url} target="_blank" rel="noreferrer" title={r.title}>{cite[1]}</a>
              ) : null;
            }
            return <Fragment key={i}>{part}</Fragment>;
          })}
        </p>
      ))}
    </>
  );
}

export function ThreadCard({ icon, title, body, bullets, url, loading, error, onClose }: {
  icon: string; title: string; body?: string; bullets?: string[]; url?: string;
  loading: boolean; error?: string; onClose: () => void;
}) {
  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          <Button size="icon" variant="ghost" className="ml-auto size-6" onClick={onClose}><X className="size-3.5" /></Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2"><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-[90%]" /><Skeleton className="h-3.5 w-[75%]" /></div>
        ) : error ? (
          <p className="text-xs text-muted-foreground">⚠️ {error}</p>
        ) : (
          <div className="text-sm leading-relaxed [&_p]:my-1.5 [&_strong]:font-semibold">
            {body && <RichText text={body} />}
            {bullets && <ul className="ml-4 list-disc space-y-1 text-xs">{bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
            {url && <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-primary hover:underline">Open page ↗</a>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PlaceholderCard({ kind, title }: { kind: string; title: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 animate-pulse text-primary/60" />
          <CardTitle className="text-sm font-semibold text-muted-foreground">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-[95%]" />
          <Skeleton className="h-3.5 w-[80%]" />
        </div>
      </CardContent>
    </Card>
  );
}
