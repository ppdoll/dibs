'use client';

import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';
import type { UnreadCount } from '@/types/api';

const EMPTY: UnreadCount = { notifications: 0, messages: 0, total: 0 };

/**
 * 하단 탭바·상단 종 아이콘의 배지 숫자.
 *
 * 두 곳에서 같은 값을 쓰므로 React Query 캐시로 요청을 한 번만 보낸다.
 * 60초 폴링인 이유: 예약금 만료·당첨 발표처럼 놓치면 안 되는 알림이 있어
 * 사용자가 새로고침하기를 기다릴 수 없다. 그렇다고 더 자주 찌르면
 * 서버리스 함수 호출만 늘어난다.
 *
 * 비로그인이면 아예 요청하지 않는다 — 401 을 만들어 낼 이유가 없다.
 */
export function useUnreadCount(): UnreadCount {
  const { isAuthenticated } = useAuth();

  const { data } = useQuery({
    queryKey: qk.notifications.unreadCount,
    queryFn: () => apiGet<UnreadCount>('/api/notifications/unread-count'),
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
    // 탭을 다시 켰을 때 오래된 숫자가 남아 있으면 안 된다.
    refetchOnWindowFocus: true,
  });

  return data ?? EMPTY;
}
