import { cn } from '@/lib/utils';

/** ZO mark: a half-disc (the O) and a wedge of equal area (the Z's diagonal), split along one wide cut. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} fill="currentColor" aria-hidden>
      <path d="M24.1 5.8A12.95 12.95 0 0 0 5.8 24.1Z" />
      <path d="M7.06 30H26.5A3.5 3.5 0 0 0 30 26.5V7.06Z" />
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
