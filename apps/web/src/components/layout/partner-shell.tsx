'use client';

import {
  Building2,
  CalendarRange,
  LayoutDashboard,
  ListChecks,
  Store,
  UserCog,
} from 'lucide-react';
import Link from 'next/link';

import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonList } from '@/components/ui/skeleton';
import { PARTNER_APPROVAL_LABEL, labelOf } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';
import { ConsoleShell, type ConsoleNavGroup } from './console-shell';
import { AccountMenu } from './account-menu';

/**
 * 파트너 콘솔 껍데기. (D-09)
 *
 * 승인 게이트가 여기 있는 이유: 승인 전 파트너가 이벤트 생성 화면까지
 * 들어갔다가 저장 단계에서 403 을 맞는 게 최악이다. 폼을 다 채운 뒤에
 * "당신은 아직 승인 전입니다" 를 보는 셈이라, 아예 입구에서 막고
 * **지금 무슨 상태이고 다음에 뭘 해야 하는지**를 보여준다.
 *
 * 물론 진짜 방어는 서버다. 이건 사용자 경험을 위한 안내일 뿐이다.
 */

const NAV: ConsoleNavGroup[] = [
  {
    items: [
      { href: '/partner', label: '대시보드', icon: LayoutDashboard, exact: true },
      { href: '/partner/events', label: '이벤트', icon: CalendarRange },
      { href: '/partner/selections', label: '당첨자 발표', icon: ListChecks },
    ],
  },
  {
    title: '설정',
    items: [
      { href: '/partner/venues', label: '내 시설', icon: Store },
      { href: '/partner/businesses', label: '사업자 정보', icon: Building2 },
      { href: '/partner/profile', label: '파트너 정보', icon: UserCog },
    ],
  },
];

export function PartnerShell({
  children,
  /** 승인 전에도 볼 수 있는 화면(프로필·신청서)이면 true */
  allowUnapproved = false,
}: {
  children: React.ReactNode;
  allowUnapproved?: boolean;
}) {
  const { isLoading, isAuthenticated, isPartner, isApprovedPartner, me, login } = useAuth();

  return (
    <ConsoleShell brand="파트너 센터" brandHref="/partner" groups={NAV} header={<AccountMenu />}>
      {isLoading ? (
        <SkeletonList count={3} />
      ) : !isAuthenticated ? (
        <EmptyState
          title="로그인이 필요해요"
          description="파트너 센터는 로그인 후 이용할 수 있어요."
          action={<Button onClick={() => login({ intent: 'PARTNER' })}>구글로 로그인</Button>}
        />
      ) : !isPartner ? (
        <EmptyState
          title="파트너 계정이 아니에요"
          description="파트너로 활동하려면 신청서를 제출하고 운영자 승인을 받아야 해요."
          action={
            <Link href="/partner/apply" className={buttonVariants({ variant: 'primary' })}>
              파트너 신청하기
            </Link>
          }
        />
      ) : !isApprovedPartner && !allowUnapproved ? (
        <EmptyState
          title="아직 승인 전이에요"
          description={
            <>
              현재 상태: {labelOf(PARTNER_APPROVAL_LABEL, me?.partnerApprovalStatus)}
              <br />
              승인이 끝나면 알림으로 알려드릴게요. 이벤트 등록은 승인 후에 열려요.
            </>
          }
          action={
            <Link href="/partner/profile" className={buttonVariants({ variant: 'outline' })}>
              신청 상태 보기
            </Link>
          }
        />
      ) : (
        children
      )}
    </ConsoleShell>
  );
}
