'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * 파트너·운영자 콘솔의 공통 껍데기.
 *
 * 이용자 화면과 다르게 **데스크톱 우선**이다. 이벤트를 만들고 명단을
 * 확정하는 일은 표를 넓게 봐야 하는 작업이라 폰에서 하지 않는다.
 * 그래도 모바일에서 완전히 막지는 않는다 — 알림을 받고 상태만 확인하는
 * 용도는 있어서, 사이드 내비를 가로 스크롤 줄로 접어 보여준다.
 */

export interface ConsoleNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** 하위 경로까지 활성으로 볼지. 기본은 정확 일치 + 하위 경로. */
  exact?: boolean;
}

export interface ConsoleNavGroup {
  title?: string;
  items: ConsoleNavItem[];
}

function isActive(pathname: string, item: ConsoleNavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function ConsoleShell({
  /** 좌측 상단 브랜드 문구. 예: "파트너 센터" */
  brand,
  brandHref,
  groups,
  header,
  children,
  className,
}: {
  brand: string;
  brandHref: string;
  groups: ConsoleNavGroup[];
  /** 상단 우측 영역(계정 메뉴 등) */
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const pathname = usePathname() ?? '';
  const allItems = groups.flatMap((group) => group.items);

  return (
    <div className="flex min-h-dvh bg-muted/30">
      {/* 데스크톱 사이드 내비 */}
      <aside className="hidden w-60 shrink-0 border-r bg-background md:flex md:flex-col">
        <div className="flex h-14 items-center border-b px-5">
          <Link href={brandHref} className="text-base font-extrabold tracking-tight">
            {brand}
          </Link>
        </div>

        <nav aria-label={brand} className="flex-1 overflow-y-auto p-3">
          {groups.map((group, index) => (
            <div key={group.title ?? index} className={cn(index > 0 && 'mt-5')}>
              {group.title ? (
                <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.title}
                </p>
              ) : null}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(pathname, item);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                          active
                            ? 'bg-primary/10 font-semibold text-primary'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="flex h-14 items-center justify-between gap-3 px-4">
            <Link href={brandHref} className="text-base font-extrabold tracking-tight md:hidden">
              {brand}
            </Link>
            <div className="ml-auto flex items-center gap-1">{header}</div>
          </div>

          {/* 모바일: 사이드 내비를 가로 줄로 접는다 */}
          <nav
            aria-label={`${brand} 메뉴`}
            className="no-scrollbar flex gap-1 overflow-x-auto border-t px-2 py-1.5 md:hidden"
          >
            {allItems.map((item) => {
              const active = isActive(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className={cn('mx-auto w-full max-w-6xl flex-1 p-4 md:p-6', className)}>
          {children}
        </main>
      </div>
    </div>
  );
}
