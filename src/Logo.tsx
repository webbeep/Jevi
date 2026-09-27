import { useId } from 'react';
import { cn } from '@/lib/utils';

/** Bento mark: an answer laid out as a designed card — one lead tile, two supporting tiles. */
export function LogoMark({ className, animated = false }: { className?: string; animated?: boolean }) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand)" />
          <stop offset="1" stopColor="var(--brand-2)" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="16" height="28" rx="6" fill={`url(#${id})`} className={cn(animated && 'origin-center animate-pulse')} />
      <rect x="20" y="2" width="10" height="13" rx="4.5" fill="currentColor" opacity="0.9" />
      <rect x="20" y="17" width="10" height="13" rx="4.5" fill="currentColor" opacity="0.28" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <LogoMark />
      <span className="text-lg font-semibold tracking-tight">jevi</span>
    </span>
  );
}
