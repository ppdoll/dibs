'use client';

import { Bell, ChevronLeft, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { CountBadge } from '@/components/ui/badge';
import { useAuth } from '@/providers/auth-provider';
import { cn } from '@/lib/utils';
import { AccountMenu } from './account-menu';
import { useUnreadCount } from './use-unread-count';

/**
 * 상단 바.
 *
 * catchtable 처럼 화면 성격에 따라 두 얼굴을 가진다.
 *  - 홈/탐색: 로고 + 검색 + 알림
 *  - 상세/폼: 뒤로가기 + 제목
 *
 * sticky 인 이유: 스크롤이 긴 상세 화면에서 뒤로가기가 화면 밖으로
 * 사라지면 사용자는 브라우저 제스처를 찾아 헤맨다.
 */
export function TopBar({
  title,
  showBack = false,
  /** 뒤로가기 대신 갈 곳. 새 탭으로 열린 상세처럼 history 가 없을 때 필요하다. */
  backHref,
  actions,
  /** 스크롤해도 배경이 비치지 않게 */
  solid = true,
  className,
  children,
}: {
  title?: React.ReactNode;
  showBack?: boolean;
  backHref?: string;
  actions?: React.ReactNode;
  solid?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();

  const onBack = () => {
    if (backHref) {
      router.push(backHref);
      return;
    }
    // history 가 없으면(직접 링크로 진입) 홈으로. 빈 화면에 갇히지 않게.
    if (window.history.length > 1) router.back();
    else router.push('/');
  };

  return (
    <header
      className={cn(
        'sticky top-0 z-30 w-full',
        solid ? 'border-b bg-background/95 backdrop-blur' : '',
        className,
      )}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-1 px-2">
        {showBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="뒤로 가기"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-accent"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden="true" />
          </button>
        ) : null}

        <div className={cn('min-w-0 flex-1', showBack ? 'px-1' : 'px-2')}>
          {typeof title === 'string' ? (
            <h1 className="truncate text-base font-bold">{title}</h1>
          ) : (
            title
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
      </div>
      {children}
    </header>
  );
}

/** 홈·탐색용 상단 바. 로고와 검색·알림 진입점. */
export function HomeTopBar({ className }: { className?: string }) {
  return (
    <TopBar
      className={className}
      title={
        <Link href="/" className="inline-block px-1 text-xl font-extrabold tracking-tight text-primary">
          Dibs
        </Link>
      }
      actions={
        <>
          <Link
            href="/search"
            aria-label="검색"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-accent"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </Link>
          {/* 알림은 로그인해야 의미가 있다. 비로그인 상태에서 종을 눌러 로그인 화면으로
              튕기는 것보다, 애초에 로그인 버튼만 보이는 편이 덜 혼란스럽다. */}
          <AuthedOnly>
            <NotificationBellLink />
          </AuthedOnly>
          <AccountMenu compact />
        </>
      }
    />
  );
}

/** 로그인한 사용자에게만 그린다. 판정 전에는 아무것도 그리지 않는다. */
function AuthedOnly({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading || !isAuthenticated) return null;
  return <>{children}</>;
}

/** 안 읽은 알림 수를 달고 있는 종 아이콘. */
export function NotificationBellLink({ className }: { className?: string }) {
  const { total } = useUnreadCount();

  return (
    <Link
      href="/notifications"
      aria-label={total > 0 ? `알림 ${total}건` : '알림'}
      className={cn(
        'relative inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-accent',
        className,
      )}
    >
      <Bell className="h-5 w-5" aria-hidden="true" />
      {total > 0 ? (
        <span className="absolute right-1.5 top-1.5">
          <CountBadge count={total} />
        </span>
      ) : null}
    </Link>
  );
}
