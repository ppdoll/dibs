'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { sanitizeRedirect, setToken } from '@/lib/auth';
import { qk } from '@/lib/query-keys';

/**
 * 토큰을 받아 저장하고 주소창을 청소한다.
 *
 * ★ URL 을 지우는 게 이 화면의 존재 이유다.
 *   토큰이 쿼리스트링에 실려 오는데(서버리스라 세션이 없어서 이렇게 왕복한다),
 *   그대로 두면 브라우저 히스토리·리퍼러 헤더·공유된 링크에 액세스 토큰이
 *   남는다. history.replaceState 로 **현재 항목을 덮어써서** 뒤로가기로도
 *   토큰이 있는 주소로 돌아갈 수 없게 만든다.
 */
export function CallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  // StrictMode 의 이중 실행으로 라우팅이 두 번 일어나지 않게 잠근다.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const token = params?.get('token') ?? null;
    const redirectParam = params?.get('redirect') ?? null;
    const errorParam = params?.get('error') ?? null;

    // 무엇을 하든 주소창부터 청소한다. 실패했더라도 토큰이 남아 있으면 안 된다.
    scrubUrl();

    if (errorParam || !token) {
      setError(
        errorParam === 'access_denied'
          ? '구글 로그인을 취소하셨어요.'
          : '로그인을 완료하지 못했어요. 다시 시도해 주세요.',
      );
      return;
    }

    setToken(token);

    // 새 토큰으로 내 정보를 다시 읽게 한다. 이전 사용자의 캐시가 남아 있으면
    // 잠깐 남의 이름이 보인다.
    queryClient.removeQueries({ queryKey: qk.auth.me });

    const destination = sanitizeRedirect(redirectParam) ?? '/';
    router.replace(destination);
  }, [params, queryClient, router]);

  if (error) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-base font-semibold">{error}</p>
        <Link href="/auth/login" className={buttonVariants({ variant: 'primary' })}>
          로그인 화면으로
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6">
      <Spinner size="lg" />
      <p className="text-sm text-muted-foreground">로그인 중이에요…</p>
    </main>
  );
}

/**
 * 주소창에서 쿼리스트링을 걷어낸다.
 *
 * router.replace 로 이동시키기 **전에** 부른다. 이동 후에 지우려 하면
 * 이미 히스토리에 토큰이 붙은 항목이 하나 쌓인 뒤다.
 */
function scrubUrl(): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', window.location.pathname);
}
