'use client';

import { X } from 'lucide-react';
import { createContext, useContext, useEffect, useId, useRef } from 'react';

import { cn } from '@/lib/utils';
import { Portal, useEscapeKey, useLockBodyScroll } from './portal';

/**
 * 모달. shadcn 과 같은 조립 방식이라 화면 코드가 익숙하게 읽힌다.
 *
 *   <Dialog open={open} onOpenChange={setOpen}>
 *     <DialogContent>
 *       <DialogHeader>
 *         <DialogTitle>신청을 취소할까요?</DialogTitle>
 *         <DialogDescription>취소 후 10분간 다시 신청할 수 없어요.</DialogDescription>
 *       </DialogHeader>
 *       <DialogFooter>…</DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 *
 * radix 없이 손으로 쓴 것이라 포커스 트랩은 "열릴 때 안으로 넣고, 닫힐 때
 * 원래 자리로 돌려주는" 수준까지만 한다. 확인 모달 용도에는 충분하다.
 */

interface DialogContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titleId: string;
  descriptionId: string;
}

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialogContext(component: string): DialogContextValue {
  const context = useContext(DialogContext);
  if (!context) throw new Error(`${component} 는 <Dialog> 안에서만 쓸 수 있습니다.`);
  return context;
}

export function Dialog({
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
    <DialogContext.Provider
      value={{ open, onOpenChange, titleId: `${id}-title`, descriptionId: `${id}-desc` }}
    >
      {children}
    </DialogContext.Provider>
  );
}

export function DialogContent({
  className,
  children,
  /** 바깥을 눌러도 닫히지 않게. 처리 중인 요청이 있을 때 쓴다. */
  dismissible = true,
}: {
  className?: string;
  children: React.ReactNode;
  dismissible?: boolean;
}) {
  const { open, onOpenChange, titleId, descriptionId } = useDialogContext('DialogContent');
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useLockBodyScroll(open);
  useEscapeKey(open && dismissible, () => onOpenChange(false));

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    return () => {
      // 닫은 뒤 포커스를 원래 버튼으로 돌려준다. 키보드 사용자가 목록의
      // 처음으로 튕기지 않게 하는, 눈에 안 보이지만 큰 차이다.
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
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
            'relative z-10 w-full max-w-md bg-card text-card-foreground outline-none',
            // 모바일은 아래에서 올라오고, 데스크톱은 가운데에 뜬다.
            'rounded-t-2xl sm:rounded-2xl',
            'max-h-[90dvh] overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5',
            'animate-in slide-in-from-bottom-4 sm:zoom-in-95 sm:slide-in-from-bottom-0',
            className,
          )}
        >
          {children}
        </div>
      </div>
    </Portal>
  );
}

export function DialogHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('mb-4 flex flex-col gap-1.5 pr-8', className)}>{children}</div>;
}

export function DialogTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  const { titleId } = useDialogContext('DialogTitle');
  return (
    <h2 id={titleId} className={cn('text-lg font-bold leading-snug', className)}>
      {children}
    </h2>
  );
}

export function DialogDescription({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { descriptionId } = useDialogContext('DialogDescription');
  return (
    <p id={descriptionId} className={cn('text-sm leading-relaxed text-muted-foreground', className)}>
      {children}
    </p>
  );
}

export function DialogFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}>
      {children}
    </div>
  );
}

/** 오른쪽 위 X. DialogContent 안에 직접 넣는다. */
export function DialogClose({ className, label = '닫기' }: { className?: string; label?: string }) {
  const { onOpenChange } = useDialogContext('DialogClose');

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
