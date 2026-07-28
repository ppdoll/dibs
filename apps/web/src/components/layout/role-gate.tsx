'use client';

import { useAuth } from '@/providers/auth-provider';

export type GateRole = 'AUTHENTICATED' | 'USER' | 'PARTNER' | 'APPROVED_PARTNER' | 'ADMIN';

/**
 * 역할에 따라 조각을 보였다 감췄다 한다.
 *
 * **보안 장치가 아니다.** 감춘다고 접근이 막히지는 않는다 —
 * 진짜 방어는 서버의 가드다. 여기서 하는 일은 "눌러봐야 403 인 버튼"을
 * 안 보여주는 것뿐이다.
 *
 * 로딩 중에는 fallback 도 children 도 그리지 않는다(기본값). 잠깐 보였다가
 * 사라지는 로그인 버튼은 깜빡임으로 보인다.
 */
export function RoleGate({
  require: required,
  children,
  fallback = null,
  /** 로딩 중에 보여줄 것. 보통 스켈레톤. */
  loading = null,
}: {
  require: GateRole;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  loading?: React.ReactNode;
}) {
  const auth = useAuth();

  if (auth.isLoading) return <>{loading}</>;

  const allowed =
    required === 'AUTHENTICATED'
      ? auth.isAuthenticated
      : required === 'USER'
        ? auth.isAuthenticated
        : required === 'PARTNER'
          ? auth.isPartner
          : required === 'APPROVED_PARTNER'
            ? auth.isApprovedPartner
            : auth.isAdmin;

  return <>{allowed ? children : fallback}</>;
}
