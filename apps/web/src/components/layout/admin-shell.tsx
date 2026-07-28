'use client';

import {
  BadgeCheck,
  Building2,
  CalendarRange,
  Gauge,
  Megaphone,
  ScrollText,
  Settings,
  Store,
  Tags,
  Users,
} from 'lucide-react';

import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonList } from '@/components/ui/skeleton';
import { useAuth } from '@/providers/auth-provider';
import { ConsoleShell, type ConsoleNavGroup } from './console-shell';
import { AccountMenu } from './account-menu';

/**
 * 운영자 콘솔 껍데기.
 *
 * 운영자 계정은 셀프 가입이 없다(D-09). 그래서 "권한 없음" 화면에
 * 신청 버튼을 두지 않는다 — 여기까지 잘못 들어온 사람에게 줄 수 있는
 * 안내는 "여긴 당신 자리가 아니다" 뿐이다.
 */

const NAV: ConsoleNavGroup[] = [
  {
    items: [{ href: '/admin', label: '대시보드', icon: Gauge, exact: true }],
  },
  {
    title: '심사',
    items: [
      { href: '/admin/partners', label: '파트너 심사', icon: BadgeCheck },
      { href: '/admin/venues', label: '시설 검수', icon: Store },
      { href: '/admin/businesses', label: '사업자 확인', icon: Building2 },
    ],
  },
  {
    title: '운영',
    items: [
      { href: '/admin/events', label: '이벤트 운영', icon: CalendarRange },
      { href: '/admin/users', label: '계정', icon: Users },
      { href: '/admin/broadcasts', label: '공지 발송', icon: Megaphone },
    ],
  },
  {
    title: '시스템',
    items: [
      // 실제 화면은 /admin/audit 에 있다. 예전 경로(/admin/audit-logs)로 걸린 상세 화면의
      // 링크는 그 경로의 리다이렉트가 받아 넘긴다 — 사이드바 활성 표시가 두 경로로
      // 갈라지지 않게 여기서는 정식 경로 하나만 가리킨다.
      // 업종은 이용자 홈의 카테고리 칩과 시설 등록 폼이 그대로 쓰는 마스터 데이터다.
      { href: '/admin/categories', label: '업종 관리', icon: Tags },
      { href: '/admin/audit', label: '감사 로그', icon: ScrollText },
      { href: '/admin/settings', label: '설정', icon: Settings },
    ],
  },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { isLoading, isAdmin } = useAuth();

  return (
    <ConsoleShell brand="운영자 콘솔" brandHref="/admin" groups={NAV} header={<AccountMenu />}>
      {isLoading ? (
        <SkeletonList count={3} />
      ) : !isAdmin ? (
        <EmptyState
          title="접근 권한이 없어요"
          description="운영자만 볼 수 있는 화면이에요."
        />
      ) : (
        children
      )}
    </ConsoleShell>
  );
}
