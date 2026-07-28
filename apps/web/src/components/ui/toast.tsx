'use client';

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { Portal } from './portal';

/**
 * 토스트. sonner 를 붙이는 대신 필요한 만큼만 손으로 썼다.
 *
 * 위치가 **하단 탭바 위**인 게 중요하다. 화면 맨 아래에 띄우면 탭바에 가려
 * 안 보이고, 맨 위에 띄우면 엄지에서 멀어 "닫기" 를 누를 수 없다.
 *
 * ★ D-07 — 토스트 문구에 남의 금액·순위·커트라인을 넣지 않는다.
 *   "8만원에 밀리셨습니다" 같은 문장은 커트라인을 그대로 알려주는 것과 같다.
 */

export type ToastVariant = 'default' | 'success' | 'error' | 'warning';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** ms. 0 이면 자동으로 사라지지 않는다. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: string;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
  /** 자주 쓰는 축약 */
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 4_000;
const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // 오래된 것부터 밀어낸다. 화면을 토스트로 덮어버리면 아무것도 못 읽는다.
      setItems((prev) => [...prev, { ...options, id }].slice(-MAX_VISIBLE));

      const duration = options.duration ?? DEFAULT_DURATION;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }

      return id;
    },
    [dismiss],
  );

  // 언마운트 시 남은 타이머 정리. 안 하면 개발 중 StrictMode 이중 마운트에서 샌다.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      dismiss,
      success: (title, description) =>
        toast({ title, variant: 'success', ...(description ? { description } : {}) }),
      error: (title, description) =>
        toast({ title, variant: 'error', ...(description ? { description } : {}) }),
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast 는 ToastProvider 안에서만 쓸 수 있습니다.');
  return context;
}

const VARIANT_STYLE: Record<ToastVariant, string> = {
  default: 'border-border bg-card text-card-foreground',
  success: 'border-emerald-500/30 bg-card text-card-foreground',
  error: 'border-destructive/40 bg-card text-card-foreground',
  warning: 'border-amber-500/40 bg-card text-card-foreground',
};

const VARIANT_ICON: Record<ToastVariant, React.ReactNode> = {
  default: <Info className="h-5 w-5 text-muted-foreground" aria-hidden="true" />,
  success: <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden="true" />,
  error: <XCircle className="h-5 w-5 text-destructive" aria-hidden="true" />,
  warning: <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />,
};

function Toaster({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: string) => void }) {
  if (items.length === 0) return null;

  return (
    <Portal>
      <div
        // 하단 탭바(56px) + 안전영역 위로 띄운다.
        className={cn(
          'pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4',
          'bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6 md:items-end md:px-6',
        )}
        role="region"
        aria-label="알림 메시지"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            aria-live={item.variant === 'error' ? 'assertive' : 'polite'}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-3.5 shadow-lg',
              'animate-in fade-in slide-in-from-bottom-2',
              VARIANT_STYLE[item.variant ?? 'default'],
            )}
          >
            <span className="mt-0.5 shrink-0">{VARIANT_ICON[item.variant ?? 'default']}</span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug">{item.title}</p>
              {item.description ? (
                <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              ) : null}
              {item.action ? (
                <button
                  type="button"
                  onClick={() => {
                    item.action?.onClick();
                    onDismiss(item.id);
                  }}
                  className="mt-2 text-sm font-semibold text-primary underline-offset-4 hover:underline"
                >
                  {item.action.label}
                </button>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => onDismiss(item.id)}
              aria-label="알림 닫기"
              className="-mr-1 -mt-1 shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </Portal>
  );
}
