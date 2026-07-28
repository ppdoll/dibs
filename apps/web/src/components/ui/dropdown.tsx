'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { useEscapeKey } from './portal';

/**
 * 앵커에 붙는 작은 메뉴.
 *
 * Dialog 를 쓰지 않는 이유: 계정 메뉴처럼 항목이 서너 개인 것에 모달을 띄우면
 * 뒤 화면이 잠기고 배경이 어두워져서, 그냥 둘러보려던 사람에게 과한 반응이 된다.
 * Portal 도 쓰지 않는다 — 상단바는 sticky 지만 overflow 로 자르지 않아 제자리에
 * 그려도 잘리지 않고, 포털로 빼면 앵커 위치를 직접 계산해야 한다.
 *
 * 접근성으로 챙긴 것:
 *   - Escape 로 닫고, 닫으면 포커스를 트리거로 되돌린다(키보드 사용자가 길을 잃지 않게)
 *   - 바깥 클릭으로 닫는다. pointerdown 을 듣는 이유는 click 보다 먼저 와서,
 *     메뉴 밖 버튼을 눌렀을 때 "닫힘 + 그 버튼 동작"이 한 번에 자연스럽게 이어지기 때문이다
 *   - 트리거에 aria-expanded / aria-haspopup, 메뉴에 role="menu"
 */
export function DropdownMenu({
  trigger,
  children,
  align = 'end',
  className,
  menuLabel,
}: {
  /** open 상태를 받아 트리거를 그린다. 버튼 스타일은 호출부가 정한다. */
  trigger: (props: {
    ref: React.Ref<HTMLButtonElement>;
    onClick: () => void;
    'aria-expanded': boolean;
    'aria-haspopup': 'menu';
    'aria-controls': string;
  }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: 'start' | 'end';
  className?: string;
  menuLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    // 포커스를 되돌리지 않으면 다음 Tab 이 문서 맨 앞에서 다시 시작한다.
    triggerRef.current?.focus();
  }, []);

  useEscapeKey(open, close);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      // 바깥을 눌렀을 때는 포커스를 트리거로 되돌리지 않는다 —
      // 사용자가 이미 다른 곳을 가리켰는데 포커스를 뺏으면 그게 더 이상하다.
      setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div className="relative">
      {trigger({
        ref: triggerRef,
        onClick: () => setOpen((v) => !v),
        'aria-expanded': open,
        'aria-haspopup': 'menu',
        'aria-controls': menuId,
      })}

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          className={cn(
            'absolute z-50 mt-1 min-w-[13rem] overflow-hidden rounded-xl border bg-background p-1 shadow-lg',
            'animate-in fade-in-0 zoom-in-95',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

/** 메뉴 맨 위의 비대화형 영역. 누가 로그인했는지 보여준다. */
export function DropdownHeader({ children }: { children: React.ReactNode }) {
  return <div className="border-b px-3 pb-2 pt-2 text-sm">{children}</div>;
}

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-border" role="separator" />;
}

/**
 * 메뉴 항목. `href` 가 있으면 링크, 없으면 버튼으로 그린다.
 *
 * 링크를 button + router.push 로 만들지 않는 이유: 가운데 클릭으로 새 탭 열기와
 * "링크 주소 복사"가 사라진다. 운영자 콘솔처럼 여러 탭을 띄워 놓고 쓰는 화면에서
 * 그게 없으면 답답하다. next/link 는 <a> 로 렌더되므로 그 둘을 지키면서
 * 클라이언트 라우팅도 그대로 얻는다.
 */
export function DropdownItem({
  href,
  onClick,
  icon,
  children,
  description,
  tone = 'default',
}: {
  href?: string;
  onClick?: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
  description?: string;
  tone?: 'default' | 'danger';
}) {
  const className = cn(
    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent',
    tone === 'danger' ? 'text-destructive hover:bg-destructive/10' : 'text-foreground',
  );

  const body = (
    <>
      {icon ? <span className="shrink-0 opacity-70">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{children}</span>
        {description ? (
          <span className="block truncate text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </>
  );

  if (href) {
    return (
      <Link href={href} role="menuitem" onClick={onClick} className={className}>
        {body}
      </Link>
    );
  }

  return (
    <button type="button" role="menuitem" onClick={onClick} className={className}>
      {body}
    </button>
  );
}
