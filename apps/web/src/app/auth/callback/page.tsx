import { Suspense } from 'react';

import { Spinner } from '@/components/ui/spinner';
import { CallbackHandler } from './callback-handler';

export const metadata = {
  title: '로그인 중',
  robots: { index: false, follow: false },
};

/**
 * 구글 로그인 콜백 착지점.
 *
 * 백엔드가 `/auth/callback?token=…&redirect=…` 로 브라우저를 돌려보낸다.
 * 여기서 토큰을 저장하고, **주소창에서 토큰을 지운 뒤**, 원래 가려던 곳으로 보낸다.
 *
 * useSearchParams 를 쓰는 컴포넌트는 Suspense 로 감싸야 한다. 안 그러면
 * 이 페이지 전체가 클라이언트 렌더로 밀려난다.
 */
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<CallbackFrame />}>
      <CallbackHandler />
    </Suspense>
  );
}

function CallbackFrame() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6">
      <Spinner size="lg" />
      <p className="text-sm text-muted-foreground">로그인 중이에요…</p>
    </main>
  );
}
