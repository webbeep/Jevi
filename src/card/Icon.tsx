import { Circle } from 'lucide-react';
import { DynamicIcon, type IconName, iconNames } from 'lucide-react/dynamic';
import { cn } from '@/lib/utils';

const VALID = new Set<string>(iconNames);

/** Renders any lucide icon by kebab-case name, or `fallback` for unknown names. */
export function Icon({ name, className, fallback }: { name?: string; className?: string; fallback?: string }) {
  if (!name || !VALID.has(name)) name = fallback;
  if (!name || !VALID.has(name)) return null;
  return <DynamicIcon name={name as IconName} className={cn('size-4 shrink-0', className)} fallback={() => <Circle className={cn('size-4 opacity-0', className)} />} />;
}
