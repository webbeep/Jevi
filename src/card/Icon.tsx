import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { ICON_NAMES } from './iconNames';

const VALID = new Set(ICON_NAMES.split('|'));

/**
 * Renders any lucide icon by kebab-case name, or `fallback` for unknown names. Drawn as a mask over the text
 * color from the static SVGs in /icons, so the model can pick any icon without the bundle carrying them all.
 */
export function Icon({ name, className, fallback }: { name?: string; className?: string; fallback?: string }) {
  if (!name || !VALID.has(name)) name = fallback;
  if (!name || !VALID.has(name)) return null;
  const mask = `url(/icons/${name}.svg) center / contain no-repeat`;
  const style: CSSProperties = { mask, WebkitMask: mask };
  return <span aria-hidden className={cn('inline-block size-4 shrink-0 bg-current', className)} style={style} />;
}
