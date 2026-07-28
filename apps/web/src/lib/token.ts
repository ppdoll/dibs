/**
 * 액세스 토큰 보관소. **의존성이 하나도 없다.**
 *
 * api-client 는 요청마다 토큰이 필요하고, auth 는 로그인/로그아웃을 위해
 * api-client 가 필요하다. 둘을 직접 이으면 순환 import 가 된다.
 * 토큰이라는 가장 밑바닥 값만 여기로 내려서 의존 방향을 한 줄로 폈다.
 *
 *   token.ts  ←  api-client.ts  ←  auth.ts  ←  auth-provider.tsx
 *
 * 공개 진입점은 `lib/auth.ts` 다. 화면 코드는 여기를 직접 import 하지 말고
 * auth 가 다시 내보내는 것을 쓴다.
 */

import { isBrowser } from './env';

/** localStorage 키. 바꾸면 기존 사용자가 전부 로그아웃된다. */
export const AUTH_TOKEN_KEY = 'dibs.accessToken';

/**
 * 토큰이 바뀌었을 때 같은 탭에 알리는 이벤트 이름.
 *
 * `storage` 이벤트는 **다른 탭**에서만 발생한다. 로그인한 그 탭의 화면이
 * 갱신되지 않는 문제가 여기서 생기므로, 직접 쏘는 이벤트를 하나 더 둔다.
 */
export const AUTH_TOKEN_EVENT = 'dibs:auth-token';

export function getToken(): string | null {
  if (!isBrowser) return null;
  try {
    return window.localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    // 사파리 프라이빗 모드 등에서 localStorage 접근이 막힐 수 있다.
    // 로그인이 안 될 뿐이지 앱 전체가 죽을 일은 아니다.
    return null;
  }
}

export function setToken(token: string): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    /* 저장 실패는 조용히 넘긴다 */
  }
  notifyTokenChanged();
}

export function clearToken(): void {
  if (!isBrowser) return;
  try {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    /* 삭제 실패도 마찬가지 */
  }
  notifyTokenChanged();
}

function notifyTokenChanged(): void {
  if (!isBrowser) return;
  window.dispatchEvent(new Event(AUTH_TOKEN_EVENT));
}

/**
 * 토큰 변화 구독. 같은 탭(커스텀 이벤트)과 다른 탭(storage) 둘 다 잡는다.
 * 해제 함수를 돌려주므로 useEffect 의 cleanup 에 그대로 넣으면 된다.
 */
export function subscribeToken(listener: () => void): () => void {
  if (!isBrowser) return () => {};

  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === AUTH_TOKEN_KEY) listener();
  };

  window.addEventListener(AUTH_TOKEN_EVENT, listener);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(AUTH_TOKEN_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
