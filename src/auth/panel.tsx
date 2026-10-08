import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { isLeaving } from './signin';

export function useMobileSheet() {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

/** Android back closes the panel. A normal close pops that history entry. */
export function useBackToClose(open: boolean, onOpenChange: (open: boolean) => void) {
  const closeRef = useRef(onOpenChange);
  closeRef.current = onOpenChange;
  useEffect(() => {
    if (!open) return;
    let fromBack = false;
    history.pushState({ zoSheet: 1 }, '');
    const onPop = () => {
      fromBack = true;
      closeRef.current(false);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      const sheet = (history.state as { zoSheet?: number } | null)?.zoSheet;
      if (!fromBack && !isLeaving() && sheet) history.back();
    };
  }, [open]);
}

export function CloseButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" aria-label="Close" onClick={onClick} className={cn('absolute top-2 right-2 flex size-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground', className)}>
      <X className="size-4" />
    </button>
  );
}

export function Panel({
  open,
  onOpenChange,
  title,
  desktop = 'center',
  maxWidth,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  desktop?: 'center' | 'right';
  maxWidth: string;
  children: ReactNode;
}) {
  const mobile = useMobileSheet();
  if (mobile || desktop === 'right') {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={mobile ? 'bottom' : 'right'}
          showCloseButton={false}
          className={cn('gap-3 p-4', mobile ? 'max-h-[90dvh] rounded-t-2xl pb-[max(16px,env(safe-area-inset-bottom))]' : 'w-full sm:max-w-sm')}
        >
          <SheetTitle className="pr-11 text-base">{title}</SheetTitle>
          {children}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className={cn('gap-3 p-4', maxWidth)}>
        <DialogTitle className="pr-11 text-base">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
