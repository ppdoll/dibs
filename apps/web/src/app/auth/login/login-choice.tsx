'use client';

import { Check, Store, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { sanitizeRedirect, startGoogleLogin, type SignupIntent } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';

/**
 * 일반 이용자 / 파트너 선택 + 구글 로그인. (D-09)
 *
 * 왜 로그인 전에 고르게 하는가: 로그인은 구글 하나뿐이라 계정 종류를 물을
 * 자리가 여기밖에 없다. 이미 가입한 사람에게는 이 선택이 무시되므로
 * (백엔드가 기존 계정을 그대로 쓴다) 잘못 골라도 되돌릴 일이 생기지 않는다.
 *
 * 파트너를 고른다고 바로 파트너가 되는 것도 아니다 — 운영자 승인이 남아 있고,
 * 그 사실을 카드 설명에 미리 적어 둔다. 승인 대기를 나중에 알면 배신감이 든다.
 */

const OPTIONS: Array<{
  intent: SignupIntent;
  icon: typeof User;
  title: string;
  description: string;
  points: string[];
}> = [
  {
    intent: 'USER',
    icon: User,
    title: '일반 이용자',
    description: '가고 싶은 곳을 찜하고 신청해요.',
    points: ['관심 있는 예약에 신청', '경쟁률 확인', '당첨자 발표 알림'],
  },
  {
    intent: 'PARTNER',
    icon: Store,
    title: '파트너 (업체)',
    description: '내 매장의 예약을 열고 손님을 받아요.',
    points: ['이벤트 등록 · 운영', '신청자 명단 관리', '운영자 승인 후 이용 가능'],
  },
];

export function LoginChoice() {
  const params = useSearchParams();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  const redirect = sanitizeRedirect(params?.get('redirect') ?? null) ?? '/';
  const intentParam = params?.get('intent');
  const initialIntent: SignupIntent = intentParam === 'PARTNER' ? 'PARTNER' : 'USER';

  const [intent, setIntent] = useState<SignupIntent>(initialIntent);
  const [pending, setPending] = useState(false);

  // 이미 로그인한 사람이 주소를 직접 쳐서 들어온 경우. 로그인 화면을
  // 다시 보여줄 이유가 없다.
  useEffect(() => {
    if (!isLoading && isAuthenticated) router.replace(redirect);
  }, [isLoading, isAuthenticated, redirect, router]);

  const onSubmit = () => {
    setPending(true);
    // 브라우저가 통째로 구글로 넘어간다. 되돌아올 때 이 컴포넌트는 새로 마운트된다.
    startGoogleLogin({ intent, redirect });
  };

  return (
    <div>
      <fieldset>
        <legend className="mb-3 text-sm font-semibold">어떤 계정으로 시작할까요?</legend>

        <div className="space-y-3">
          {OPTIONS.map((option) => {
            const selected = intent === option.intent;
            const Icon = option.icon;

            return (
              <button
                key={option.intent}
                type="button"
                onClick={() => setIntent(option.intent)}
                aria-pressed={selected}
                className={cn(
                  'flex w-full gap-3 rounded-xl border p-4 text-left transition-colors',
                  selected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:border-foreground/20',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                    selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                  )}
                  aria-hidden="true"
                >
                  <Icon className="h-5 w-5" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="font-bold">{option.title}</span>
                    {selected ? (
                      <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted-foreground">
                    {option.description}
                  </span>
                  <ul className="mt-2 space-y-0.5">
                    {option.points.map((point) => (
                      <li key={point} className="text-xs text-muted-foreground">
                        · {point}
                      </li>
                    ))}
                  </ul>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <Button
        size="xl"
        full
        className="mt-6"
        onClick={onSubmit}
        loading={pending}
        leadingIcon={<GoogleMark />}
      >
        구글로 시작하기
      </Button>

      <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
        이미 가입한 계정이면 위 선택과 관계없이 기존 계정으로 로그인돼요.
      </p>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        <Link href="/" className="underline underline-offset-4">
          로그인 없이 둘러보기
        </Link>
      </p>
    </div>
  );
}

/** 구글 G 로고. 외부 이미지를 받지 않도록 인라인 SVG 로 둔다. */
function GoogleMark() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
