import { Suspense } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { LoginChoice } from './login-choice';

export const metadata = {
  title: '로그인',
  description: 'Dibs 는 구글 계정으로 간편하게 시작할 수 있어요.',
};

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pb-10 pt-16">
      <header className="mb-10">
        <p className="text-3xl font-extrabold tracking-tight text-primary">Dibs</p>
        <h1 className="mt-4 text-2xl font-bold leading-snug">
          가고 싶던 그곳,
          <br />
          열리는 순간 먼저 찜하세요.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          구글 계정으로 3초 만에 시작할 수 있어요.
        </p>
      </header>

      <Suspense fallback={<LoginSkeleton />}>
        <LoginChoice />
      </Suspense>
    </main>
  );
}

function LoginSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="mt-6 h-14 w-full" />
    </div>
  );
}
