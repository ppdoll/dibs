'use client';

import { X } from 'lucide-react';
import { createContext, useContext, useEffect, useId, useRef } from 'react';

import { cn } from '@/lib/utils';
import { Portal, useEscapeKey, useLockBodyScroll } from './portal';

/**
 * 시트. 모바일에서는 아래에서 올라오는 바텀시트, 데스크톱에서는 옆에서 나오는 패널.
 *
 * 필터·정렬·옵션 선택처럼 "잠깐 고르고 돌아오는" 흐름은 페이지 이동보다
 * 시트가 낫다. 뒤 화면이 그대로 보여서 맥락을 잃지 않기 때문이다.
 * 확인/취소 같은 결정은 Dialog 를 쓴다.
 */

interface SheetContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titleId: string;
  descriptionId: string;
}

const SheetContext = createContext<SheetContextValue | null>(null);

function useSheetContext(component: string): SheetContextValue {
  const context = useContext(SheetContext);
  if (!context) throw new Error(`${component} 는 <Sheet> 안에서만 쓸 수 있습니다.`);
  return context;
}

export function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const id = useId();

  return (
    <SheetContext.Provider
      value={{ open, onOpenChange, titleId: `${id}-title`, descriptionId: `${id}-desc` }}
    >
      {children}
    </SheetContext.Provider>
  );
}

export type SheetSide = 'bottom' | 'right' | 'left';

const SIDE_CLASS: Record<SheetSide, string> = {
  bottom:
    'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl animate-in slide-in-from-bottom pb-[env(safe-area-inset-bottom)]',
  right: 'inset-y-0 right-0 w-full max-w-sm animate-in slide-in-from-right',
  left: 'inset-y-0 left-0 w-full max-w-sm animate-in slide-in-from-left',
};

export function SheetContent({
  side = 'bottom',
  className,
  children,
  dismissible = true,
}: {
  side?: SheetSide;
  className?: string;
  children: React.ReactNode;
  dismissible?: boolean;
}) {
  const { open, onOpenChange, titleId, descriptionId } = useSheetContext('SheetContent');
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useLockBodyScroll(open);
  useEscapeKey(open && dismissible, () => onOpenChange(false));

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => restoreFocusRef.current?.focus?.();
  }, [open]);

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50">
        <div
          className="absolute inset-0 bg-black/50 animate-in fade-in"
          onClick={dismissible ? () => onOpenChange(false) : undefined}
          aria-hidden="true"
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          className={cn(
            'absolute flex flex-col overflow-hidden bg-card text-card-foreground outline-none',
            SIDE_CLASS[side],
            className,
          )}
        >
          {side === 'bottom' ? (
            // 손잡이 바. 없어도 동작하지만, 있으면 "끌어내릴 수 있다" 는 신호가 된다.
            <div className="flex justify-center pt-2.5" aria-hidden="true">
              <span className="h-1 w-10 rounded-full bg-border" />
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </Portal>
  );
}

export function SheetHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex shrink-0 flex-col gap-1 border-b px-5 py-4 pr-12', className)}>
      {children}
    </div>
  );
}

export function SheetTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  const { titleId } = useSheetContext('SheetTitle');
  return (
    <h2 id={titleId} className={cn('text-base font-bold', className)}>
      {children}
    </h2>
  );
}

export function SheetDescription({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { descriptionId } = useSheetContext('SheetDescription');
  return (
    <p id={descriptionId} className={cn('text-sm text-muted-foreground', className)}>
      {children}
    </p>
  );
}

/** 내용 영역. 길어지면 여기만 스크롤되고 머리·발은 붙어 있는다. */
export function SheetBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex-1 overflow-y-auto px-5 py-4', className)}>{children}</div>;
}

export function SheetFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex shrink-0 gap-2 border-t px-5 py-4', className)}>{children}</div>
  );
}

export function SheetClose({ className, label = '닫기' }: { className?: string; label?: string }) {
  const { onOpenChange } = useSheetContext('SheetClose');

  return (
    <button
      type="button"
      onClick={() => onOpenChange(false)}
      aria-label={label}
      className={cn(
        'absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full',
        'text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      <X className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
