import { COPY } from './copy';
import { GoogleMark } from './GoogleMark';
import { cn } from '@/lib/utils';

export function GoogleButton({ onClick, className, testId }: { onClick: () => void; className?: string; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'inline-flex h-11 shrink-0 items-center justify-center gap-3 rounded-md border px-4 text-sm font-medium',
        'border-[#747775] bg-white text-[#1f1f1f] hover:bg-neutral-50',
        'dark:border-[#8e918f] dark:bg-[#131314] dark:text-[#e3e3e3] dark:hover:bg-[#1f1f1f]',
        className,
      )}
    >
      <GoogleMark className="size-[18px]" />
      {COPY.continueGoogle}
    </button>
  );
}
