import { cn } from '@/lib/utils';

/** ZO mark: a solid O with a Z cut through it. Monochrome; the generating aura carries the color. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden>
      <circle cx="16" cy="16" r="15" fill="currentColor" />
      <path d="M10.5 10.5h11l-11 11h11" fill="none" stroke="var(--background)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark className="size-[1.15em]" />
      <span className="font-semibold tracking-[-0.04em]">zo</span>
    </span>
  );
}
