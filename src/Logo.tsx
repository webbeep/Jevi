import { cn } from '@/lib/utils';

/**
 * ZO mark: one rounded tile split into four cards; the last quarter is the search lens (the O).
 * Grid: tile 3–29 with 8 corner radius, 2.8 gutters, lens ring overshooting the tile by 0.3 so it reads the same size.
 */
const MARK = (
  <>
    <path d="M3 11A8 8 0 0 1 11 3H14.6V14.6H3ZM17.4 3H21A8 8 0 0 1 29 11V14.6H17.4ZM3 17.4H14.6V29H11A8 8 0 0 1 3 21Z" />
    <circle cx="23.05" cy="23.05" r="4.55" fill="none" stroke="currentColor" strokeWidth="3.4" />
  </>
);

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} fill="currentColor" aria-hidden>
      {MARK}
    </svg>
  );
}

/**
 * Mark + "zo" in Geist SemiBold, laid out in font units (1000/em, baseline at 0) from measured glyph ink:
 * mark ink = 1.3 × x-height, centred on the x-height (ink spans −614…80); ink gap to the z = 0.56 × x-height; z–o tracking −25.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 -622 2052 710" className={cn('h-[0.71em] w-auto overflow-visible', className)} fill="currentColor" role="img" aria-label="zo">
      <g transform="translate(-79.2 -693.2) scale(26.39)">{MARK}</g>
      <text x="942.8" fontSize="1000" fontWeight="600" aria-hidden>z</text>
      <text x="1485.2" fontSize="1000" fontWeight="600" aria-hidden>o</text>
    </svg>
  );
}
