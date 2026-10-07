import { cn } from '@/lib/utils';

/**
 * ZO mark: a disc (the O) split along the Z's diagonal, its halves slid apart along the cut so the
 * ends step like a Z. The 2-unit round-joined stroke softens the four tips.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" aria-hidden>
      <path d="M24.07 4.12A12.6 12.6 0 0 0 6.66 21.52ZM25.34 10.48A12.6 12.6 0 0 1 7.93 27.88Z" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-[0.3em]', className)}>
      <LogoMark className="size-[0.86em] translate-y-[0.05em]" />
      <span className="font-semibold leading-none tracking-[-0.045em]">zo</span>
    </span>
  );
}
