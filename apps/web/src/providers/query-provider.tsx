'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import { isApiError } from '@/lib/api-client';

/**
 * React Query 기본값.
 *
 * 재시도를 **네트워크 실패에만** 건 이유: 400/403/409 는 다시 보내도 같은
 * 답이 온다. 특히 신청 계열은 재시도가 곧 중복 요청 위험이라, 서버가 이미
 * 판단을 내린 실패는 그대로 화면에 올리는 게 맞다.
 *
 * refetchOnWindowFocus 를 끈 이유: 마감 카운트다운을 보며 탭을 오가는 사용이
 * 잦은 서비스다. 포커스마다 목록이 튀면 읽던 자리를 잃는다. 경쟁률처럼
 * 신선해야 하는 값은 화면별로 refetchInterval 을 명시해서 가져간다.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          if (isApiError(error) && error.isNetwork) return failureCount < 2;
          return false;
        },
      },
      mutations: {
        // 변경 요청은 절대 자동 재시도하지 않는다. 멱등키가 있어도
        // "언제 다시 보낼지" 는 사용자가 정하는 편이 안전하다.
        retry: false,
      },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // useState 로 한 번만 만든다. 모듈 최상단에 두면 서버에서 요청 간에
  // 캐시가 공유되어 다른 사용자의 데이터가 섞일 수 있다.
  const [client] = useState(createQueryClient);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
