'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { isApiError } from '@/lib/api-client';
import {
  clearToken,
  defaultLandingPath,
  fetchMe,
  getToken,
  isAccountActive,
  isAdmin,
  isApprovedPartner,
  isPartner,
  isPartnerPending,
  requestServerLogout,
  startGoogleLogin,
  subscribeToken,
  type SignupIntent,
} from '@/lib/auth';
import { qk } from '@/lib/query-keys';
import type { Me } from '@/types/api';

export interface AuthContextValue {
  /** 로그인한 사용자. 비로그인이면 null. */
  me: Me | null;
  /** 토큰은 있는데 아직 /auth/me 응답이 오지 않은 상태 */
  isLoading: boolean;
  isAuthenticated: boolean;
  /** 계정이 정상 이용 가능한가 (정지·휴면이면 false) */
  isActive: boolean;
  /** 파트너 역할 보유 */
  isPartner: boolean;
  /** 파트너로 실제 활동 가능 (운영자 승인 완료) — 행동의 게이트는 이쪽이다 */
  isApprovedPartner: boolean;
  /** 파트너 심사 중 · 보완 요청 */
  isPartnerPending: boolean;
  isAdmin: boolean;
  /** 구글 로그인 시작. 현재 경로로 돌아온다. */
  login: (options?: { intent?: SignupIntent; redirect?: string }) => void;
  logout: () => Promise<void>;
  /** /auth/me 를 다시 읽는다. 파트너 신청 직후처럼 상태가 바뀌었을 때. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  /**
   * 토큰은 state 로 들고 있는다. 렌더 중에 localStorage 를 읽으면 서버 렌더
   * 결과(항상 비로그인)와 첫 클라이언트 렌더가 달라져 하이드레이션이 깨진다.
   * 그래서 마운트 후 effect 에서 처음 읽는다.
   */
  const [token, setTokenState] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    const sync = () => setTokenState(getToken());
    sync();
    setTokenReady(true);
    return subscribeToken(sync);
  }, []);

  const meQuery = useQuery({
    queryKey: qk.auth.me,
    queryFn: () => fetchMe(),
    enabled: tokenReady && token !== null,
    staleTime: 60_000,
    retry: (failureCount, error) => {
      // 401 은 토큰이 죽은 것이다. 다시 물어봐야 답이 같다.
      if (isApiError(error) && (error.isUnauthorized || error.isForbidden)) return false;
      if (isApiError(error) && error.isNetwork) return failureCount < 2;
      return false;
    },
  });

  // 토큰이 유효하지 않다고 판명되면 흔적을 지운다. 남겨두면 모든 요청이
  // 401 을 맞고, 사용자는 "로그인한 것 같은데 아무것도 안 되는" 상태에 갇힌다.
  useEffect(() => {
    if (meQuery.isError && isApiError(meQuery.error) && meQuery.error.isUnauthorized) {
      clearToken();
    }
  }, [meQuery.isError, meQuery.error]);

  const me = meQuery.data ?? null;

  const login = useCallback((options: { intent?: SignupIntent; redirect?: string } = {}) => {
    const here =
      options.redirect ??
      (typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}`
        : '/');
    startGoogleLogin({ ...(options.intent ? { intent: options.intent } : {}), redirect: here });
  }, []);

  const logout = useCallback(async () => {
    await requestServerLogout();
    clearToken();
    // 캐시를 통째로 비운다. 남겨두면 다음 사람이 이전 사용자의 신청 목록을 본다.
    queryClient.clear();
    router.replace('/');
  }, [queryClient, router]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: qk.auth.me });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      me,
      isLoading: !tokenReady || (token !== null && meQuery.isPending),
      isAuthenticated: me !== null,
      isActive: isAccountActive(me),
      isPartner: isPartner(me),
      isApprovedPartner: isApprovedPartner(me),
      isPartnerPending: isPartnerPending(me),
      isAdmin: isAdmin(me),
      login,
      logout,
      refresh,
    }),
    [me, tokenReady, token, meQuery.isPending, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth 는 AuthProvider 안에서만 쓸 수 있습니다.');
  }
  return context;
}

/**
 * 로그인이 필요한 화면에서 쓴다. 로딩이 끝난 뒤에도 비로그인이면 로그인으로 보낸다.
 * 반환값의 `isReady` 가 true 가 되기 전에는 내용 대신 스켈레톤을 그린다.
 */
export function useRequireAuth(): { isReady: boolean; me: Me | null } {
  const { me, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading || isAuthenticated) return;

    const here =
      typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}`
        : '/';
    router.replace(`/auth/login?redirect=${encodeURIComponent(here)}`);
  }, [isLoading, isAuthenticated, router]);

  return { isReady: !isLoading && isAuthenticated, me };
}

/** 로그인 후 이 사용자를 데려갈 기본 경로. */
export function useDefaultLanding(): string {
  const { me } = useAuth();
  return defaultLandingPath(me);
}
