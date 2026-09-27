import { ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Icon } from './card/Icon';
import { RichText } from './card/RichText';

export interface Thread {
  id: number;
  icon: string;
  title: string;
  body?: string;
  bullets?: string[];
  url?: string;
  loading: boolean;
  error?: string;
}

export function ThreadCard({ thread, onClose }: { thread: Thread; onClose: () => void }) {
  return (
    <Card className="gap-0 py-0 shadow-none animate-in fade-in slide-in-from-top-1">
      <div className="flex items-center gap-2.5 px-4 pt-3.5">
        <Icon name={thread.icon} className="text-muted-foreground" />
        <div className="min-w-0 flex-1 truncate text-sm font-medium">{thread.title}</div>
        {thread.url && (
          <Button asChild variant="ghost" size="icon" className="size-7"><a href={thread.url} target="_blank" rel="noreferrer" aria-label="Open page"><ExternalLink className="size-3.5" /></a></Button>
        )}
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close"><X className="size-3.5" /></Button>
      </div>
      <div className="px-4 pb-4 pt-2 text-sm leading-relaxed text-foreground/85">
        {thread.loading ? (
          <div className="space-y-2"><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-[88%]" /><Skeleton className="h-3.5 w-[70%]" /></div>
        ) : thread.error ? (
          <p className="text-muted-foreground">{thread.error}</p>
        ) : (
          <>
            {thread.body && <RichText text={thread.body} />}
            {thread.bullets && <ul className="mt-2 list-disc space-y-1 pl-5">{thread.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
          </>
        )}
      </div>
    </Card>
  );
}
