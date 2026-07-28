'use client';

import { Bell, Compass, Home, Ticket, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { CountBadge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useUnreadCount } from './use-unread-count';

/**
 * 하단 탭바. 모바일 앱 경험의 뼈대다.
 *
 * 다섯 개로 고정한 이유: 엄지 하나로 누를 수 있는 폭이 대략 이 정도다.
 * 여섯 개부터는 아이콘이 좁아져서 옆 탭을 누르게 된다.
 *
 * md 이상에서는 감춘다 — 데스크톱에는 상단 내비게이션이 있다.
 */

interface TabItem {
  href: string;
  label: string;
  icon: typeof Home;
  /** 이 경로들로 시작하면 활성으로 본다 */
  match: string[];
  badge?: 'notifications';
}

const TABS: TabItem[] = [
  { href: '/', label: '홈', icon: Home, match: ['/'] },
  { href: '/search', label: '탐색', icon: Compass, match: ['/search', '/events'] },
  { href: '/my/applications', label: '내 신청', icon: Ticket, match: ['/my/applications'] },
  { href: '/notifications', label: '알림', icon: Bell, match: ['/notifications', '/messages'], badge: 'notifications' },
  { href: '/my', label: '내정보', icon: User, match: ['/my'] },
];

function isActive(pathname: string, tab: TabItem): boolean {
  // '/' 는 정확히 일치할 때만. 안 그러면 모든 경로에서 홈이 켜진다.
  return tab.match.some((prefix) =>
    prefix === '/' ? pathname === '/' : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function BottomTabBar({ className }: { className?: string }) {
  const pathname = usePathname() ?? '/';
  const { total } = useUnreadCount();

  // '/my' 가 '/my/applications' 도 잡아버리므로, 가장 긴 매치 하나만 활성으로 둔다.
  const activeHref = TABS.filter((tab) => isActive(pathname, tab))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav
      aria-label="주요 메뉴"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden',
        className,
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex h-14 max-w-3xl items-stretch">
        {TABS.map((tab) => {
          const active = tab.href === activeHref;
          const Icon = tab.icon;
          const badgeCount = tab.badge === 'notifications' ? total : 0;

          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex h-full flex-col items-center justify-center gap-0.5',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <span className="relative">
                  <Icon
                    className="h-[22px] w-[22px]"
                    strokeWidth={active ? 2.4 : 1.8}
                    aria-hidden="true"
                  />
                  {badgeCount > 0 ? (
                    <span className="absolute -right-2.5 -top-1.5">
                      <CountBadge count={badgeCount} />
                    </span>
                  ) : null}
                </span>
                <span className={cn('text-[11px]', active && 'font-bold')}>{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 탭바 높이만큼의 빈 공간. 내용이 탭바에 가리지 않게 페이지 끝에 둔다. */
export function BottomTabSpacer() {
  return <div className="h-14 md:hidden" style={{ height: 'calc(3.5rem + env(safe-area-inset-bottom))' }} aria-hidden="true" />;
}
