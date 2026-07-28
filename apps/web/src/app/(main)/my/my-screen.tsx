'use client';

import {
  Bell,
  ChevronRight,
  LogOut,
  Settings,
  Store,
  Ticket,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';

import { AppShell, TopBar } from '@/components/layout';
import { Avatar, Badge, Button, Card, Separator, Skeleton } from '@/components/ui';
import { PARTNER_APPROVAL_LABEL, labelOf } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';

/**
 * 내정보 허브.
 *
 * 설정을 한 화면에 다 밀어 넣지 않고 목록으로 나눈 이유: 모바일에서 긴
 * 설정 화면은 스크롤 중에 자기가 어디를 만지고 있는지 잃어버린다.
 * 여기서는 "어디로 갈지"만 고르고, 실제 조작은 각 화면에서 한다.
 */
export function MyScreen() {
  const auth = useAuth();

  if (auth.isLoading) {
    return (
      <AppShell header={<TopBar title="내정보" />}>
        <div className="space-y-4 py-6">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      </AppShell>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <AppShell header={<TopBar title="내정보" />}>
        <div className="py-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <UserRound className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          </div>
          <p className="mt-4 text-base font-semibold">로그인하고 예약을 관리하세요</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            신청 내역과 예약금 알림을 한곳에서 볼 수 있어요.
          </p>
          <Button className="mt-5" size="lg" onClick={() => auth.login()}>
            구글로 3초 만에 시작하기
          </Button>
        </div>
      </AppShell>
    );
  }

  const me = auth.me;

  return (
    <AppShell header={<TopBar title="내정보" />}>
      <section className="flex items-center gap-3 py-5">
        <Avatar name={me?.displayName ?? ''} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{me?.displayName}</p>
          <p className="truncate text-sm text-muted-foreground">{me?.email ?? '이메일 미등록'}</p>
        </div>
      </section>

      {/* 파트너 상태는 계정의 성격을 바꾸므로 목록보다 위에 둔다. */}
      {auth.isPartner ? (
        <Card className="mb-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold">파트너 계정</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {auth.isApprovedPartner
                  ? '승인 완료 — 예약을 만들고 운영할 수 있어요.'
                  : '운영자 승인 후에 예약을 만들 수 있어요.'}
              </p>
            </div>
            <Badge variant={auth.isApprovedPartner ? 'success' : 'warning'}>
              {labelOf(PARTNER_APPROVAL_LABEL, me?.partnerApprovalStatus, '심사 중')}
            </Badge>
          </div>

          {auth.isApprovedPartner ? (
            <Link
              href="/partner"
              className="mt-3 inline-block text-sm font-semibold text-primary underline underline-offset-4"
            >
              파트너 콘솔로 이동
            </Link>
          ) : null}
        </Card>
      ) : null}

      <nav className="rounded-lg border bg-card">
        <MenuLink href="/my/applications" icon={<Ticket className="h-5 w-5" />} label="내 신청 내역" />
        <Separator />
        <MenuLink href="/notifications" icon={<Bell className="h-5 w-5" />} label="알림 · 쪽지함" />
        <Separator />
        <MenuLink
          href="/my/profile"
          icon={<Settings className="h-5 w-5" />}
          label="내 정보 · 알림 설정"
        />
        {!auth.isPartner ? (
          <>
            <Separator />
            <MenuLink
              href="/partner/apply"
              icon={<Store className="h-5 w-5" />}
              label="파트너로 전환 신청"
              description="예약을 직접 열고 싶다면"
            />
          </>
        ) : null}
      </nav>

      <div className="py-6">
        <Button
          variant="ghost"
          full
          leadingIcon={<LogOut className="h-4 w-4" aria-hidden="true" />}
          onClick={() => void auth.logout()}
          className="text-muted-foreground"
        >
          로그아웃
        </Button>
      </div>
    </AppShell>
  );
}

function MenuLink({
  href,
  icon,
  label,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-4 transition-colors active:bg-accent"
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}
