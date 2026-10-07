import { cn } from '@/lib/utils';

/** ZO mark: a half-disc (the O) and a wedge (the Z's diagonal) split along one cut. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} fill="currentColor" aria-hidden>
      <path d="M23.79 5.41A13 13 0 0 0 5.41 23.79Z" />
      <path d="M8.21 26.59L26.59 8.21V26.59Z" />
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
