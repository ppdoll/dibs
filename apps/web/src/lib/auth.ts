/**
 * 인증의 공개 진입점. (D-09)
 *
 * 로그인은 **구글 하나뿐**이고, 가입 시 일반 이용자 / 파트너를 고른다.
 * 파트너는 고른다고 바로 활동하는 게 아니라 운영자 승인이 있어야 한다 —
 * 그래서 "파트너 역할이 있는가(isPartner)" 와 "활동할 수 있는가
 * (isApprovedPartner)" 는 **다른 질문**이고, 화면 분기는 대부분 후자를 봐야 한다.
 *
 * 흐름:
 *   1. /auth/login 에서 intent 를 고르고 GET /api/auth/google 로 브라우저를 넘긴다
 *   2. 백엔드가 구글을 거쳐 /auth/callback?token=…&redirect=… 로 되돌려준다
 *   3. 콜백 화면이 토큰을 저장하고 **URL 에서 토큰을 지운 뒤** 목적지로 보낸다
 */

import { apiGet, apiPost } from './api-client';
import { API_BASE_URL } from './env';
import type { Me, UserRole } from '@/types/api';

export {
  AUTH_TOKEN_KEY,
  AUTH_TOKEN_EVENT,
  getToken,
  setToken,
  clearToken,
  subscribeToken,
} from './token';

/** 가입 시 고르는 계정 종류. 백엔드 SIGNUP_INTENTS 와 같아야 한다. */
export type SignupIntent = 'USER' | 'PARTNER';

// ─── 서버 호출 ────────────────────────────────────────────────────────

/**
 * 내 정보. 토큰이 죽었으면 401 이 오는데, 이때는 로그인 화면으로 튕기지 않는다 —
 * 비로그인 상태로 홈을 둘러보는 것도 정상적인 이용이기 때문이다.
 */
export function fetchMe(token?: string | null): Promise<Me> {
  return apiGet<Me>('/api/auth/me', { skipAuthRedirect: true, ...(token ? { token } : {}) });
}

/** 서버 세션까지 끊는다. 실패해도 로컬 토큰은 반드시 지운다. */
export async function requestServerLogout(): Promise<void> {
  try {
    await apiPost<void>('/api/auth/logout', undefined, { skipAuthRedirect: true });
  } catch {
    // 이미 만료된 토큰이면 401 이 온다. 로그아웃하려는 참이니 문제될 게 없다.
  }
}

// ─── 로그인 시작 ──────────────────────────────────────────────────────

/**
 * 열어 줄 구글 로그인 URL.
 *
 * redirect 는 **우리 도메인 내부 경로**만 넘긴다. 절대 URL 을 그대로 실으면
 * 로그인 직후 외부로 튕기는 오픈 리다이렉트가 된다. 여기서 한 번 거른다.
 */
export function buildGoogleLoginUrl(options: {
  intent?: SignupIntent;
  redirect?: string;
} = {}): string {
  const params = new URLSearchParams();
  if (options.intent) params.set('intent', options.intent);

  const redirect = sanitizeRedirect(options.redirect);
  if (redirect) params.set('redirect', redirect);

  const qs = params.toString();
  return `${API_BASE_URL}/api/auth/google${qs ? `?${qs}` : ''}`;
}

/**
 * 내부 경로만 통과시킨다.
 * `//evil.com` 은 브라우저가 프로토콜 상대 URL 로 읽으므로 함께 막는다.
 */
export function sanitizeRedirect(redirect: string | null | undefined): string | null {
  if (!redirect) return null;
  if (!redirect.startsWith('/')) return null;
  if (redirect.startsWith('//')) return null;
  if (redirect.startsWith('/auth/')) return null; // 로그인 → 로그인 루프 방지
  return redirect.slice(0, 300);
}

/** 브라우저를 구글로 넘긴다. SPA 라우팅이 아니라 실제 이동이어야 한다. */
export function startGoogleLogin(options: { intent?: SignupIntent; redirect?: string } = {}): void {
  if (typeof window === 'undefined') return;
  window.location.assign(buildGoogleLoginUrl(options));
}

// ─── 역할 판정 ────────────────────────────────────────────────────────

export function hasRole(me: Me | null | undefined, role: UserRole): boolean {
  return me?.roles?.includes(role) ?? false;
}

export function isAdmin(me: Me | null | undefined): boolean {
  return hasRole(me, 'ADMIN');
}

/** 파트너 **역할**이 있는가. 활동 가능 여부와는 별개다. */
export function isPartner(me: Me | null | undefined): boolean {
  return hasRole(me, 'PARTNER');
}

/**
 * 파트너로 **활동할 수 있는가**. (D-09)
 * 이벤트 생성·시설 등록 같은 실제 행동의 게이트는 전부 이 값이다.
 */
export function isApprovedPartner(me: Me | null | undefined): boolean {
  return isPartner(me) && (me?.partnerApproved ?? false);
}

/** 심사 중이거나 보완 요청을 받은 상태 — 안내 배너를 띄워야 하는 구간. */
export function isPartnerPending(me: Me | null | undefined): boolean {
  if (!isPartner(me) || isApprovedPartner(me)) return false;
  return (
    me?.partnerApprovalStatus === 'PENDING' ||
    me?.partnerApprovalStatus === 'RESUBMIT_REQUIRED' ||
    me?.partnerApprovalStatus === 'DRAFT'
  );
}

/** 계정이 정상 이용 가능한 상태인가. 정지·휴면이면 신청 자체가 막힌다. */
export function isAccountActive(me: Me | null | undefined): boolean {
  return me?.status === 'ACTIVE';
}

/** 로그인 후 기본으로 데려갈 곳. 역할에 따라 시작점이 다르다. */
export function defaultLandingPath(me: Me | null | undefined): string {
  if (isAdmin(me)) return '/admin';
  if (isPartner(me)) return '/partner';
  return '/';
}
