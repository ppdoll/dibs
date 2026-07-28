'use client';

import { ToastProvider } from '@/components/ui/toast';
import { AuthProvider } from './auth-provider';
import { QueryProvider } from './query-provider';

/**
 * 앱 전체를 감싸는 프로바이더 묶음. root layout 에서 한 번만 마운트한다.
 *
 * 순서에 의미가 있다:
 *   QueryProvider → AuthProvider  (인증 상태를 React Query 로 들고 있다)
 *   AuthProvider  → ToastProvider (로그아웃 같은 동작이 토스트를 띄운다)
 *
 * 'use client' 가 여기 한 곳에만 있으면, layout.tsx 는 서버 컴포넌트로
 * 남고 metadata 를 그대로 내보낼 수 있다.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>
        <ToastProvider>{children}</ToastProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
