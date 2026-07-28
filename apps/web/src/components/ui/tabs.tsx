'use client';

import { createContext, useContext, useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

/**
 * 탭.
 *
 *   <Tabs defaultValue="all">
 *     <TabsList>
 *       <TabsTrigger value="all">전체</TabsTrigger>
 *       <TabsTrigger value="open">신청 중</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="all">…</TabsContent>
 *   </Tabs>
 *
 * value/onValueChange 를 넘기면 제어 컴포넌트가 된다. 목록 필터를 URL
 * 쿼리스트링과 묶을 때 그 형태를 쓴다 — 뒤로가기로 탭이 복원되어야 한다.
 */

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) throw new Error(`${component} 는 <Tabs> 안에서만 쓸 수 있습니다.`);
  return context;
}

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  children,
}: {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultValue ?? '');
  const current = value ?? internal;

  const setValue = (next: string) => {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  };

  return (
    <TabsContext.Provider value={{ value: current, setValue, baseId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  className,
  children,
  /** 탭이 많아 가로로 넘칠 때. 스크롤바는 감춘다. */
  scrollable = false,
}: {
  className?: string;
  children: React.ReactNode;
  scrollable?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // 좌우 화살표로 탭 사이를 옮긴다. 탭 컴포넌트의 기본 접근성 요구사항이다.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;

    const triggers = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    const index = triggers.findIndex((el) => el === document.activeElement);
    if (index < 0) return;

    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = triggers[(index + delta + triggers.length) % triggers.length];
    next?.focus();
    next?.click();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn(
        'flex items-center gap-1 border-b',
        scrollable && 'no-scrollbar overflow-x-auto',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
  disabled,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const { value: current, setValue, baseId } = useTabsContext('TabsTrigger');
  const selected = current === value;

  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={() => setValue(value)}
      className={cn(
        'relative shrink-0 whitespace-nowrap px-3 py-3 text-sm font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:opacity-50',
        selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {children}
      {selected ? (
        <span
          className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: current, baseId } = useTabsContext('TabsContent');
  if (current !== value) return null;

  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      className={cn('outline-none', className)}
    >
      {children}
    </div>
  );
}

/**
 * 알약 모양 필터 칩 줄. 탭과 달리 패널이 없고 **선택 상태만** 있다.
 * 카테고리·지역 필터처럼 가로로 훑는 UI 에 쓴다.
 */
export function ChipGroup({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('no-scrollbar flex gap-2 overflow-x-auto py-1', className)}>{children}</div>
  );
}

export function Chip({
  selected,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
