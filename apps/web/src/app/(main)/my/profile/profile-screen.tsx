'use client';

import Link from 'next/link';

import { AppShell, TopBar } from '@/components/layout';
import {
  Avatar,
  Badge,
  Card,
  CardRow,
  ErrorState,
  Select,
  Separator,
  Skeleton,
  useToast,
} from '@/components/ui';
import { toUserMessage } from '@/lib/api-client';
import { PARTNER_APPROVAL_LABEL, labelOf } from '@/lib/format';
import { useAuth, useRequireAuth } from '@/providers/auth-provider';
import type { DigestMode, NotificationCategory } from '@/types/api';

import { ToggleSwitch } from '../../_components/toggle-switch';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '../../_lib/queries';

/**
 * 내 정보 · 알림 설정.
 *
 * 저장 버튼이 없다. 토글 하나를 바꾸면 그 자리에서 PUT 한 번이 나간다 —
 * 설정 화면에서 "저장을 안 눌러서 안 바뀐" 사고가 가장 흔하기 때문이다.
 * 응답이 최신 설정 전체라 화면은 그걸 그대로 다시 그린다.
 *
 * 예약금·결과·계정 범주는 서버가 항상 켠 채로 저장한다(필수). 화면에서는
 * 아예 못 끄게 막고 왜 그런지 적어 둔다 — 껐는데 계속 온다고 느끼는 게 최악이다.
 */

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  APPLICATION: '신청 접수 · 취소',
  DEPOSIT: '예약금 안내',
  RESULT: '당첨자 발표 결과',
  EVENT_CHANGE: '예약 변경 · 마감 연장',
  MESSAGE: '주최 측 쪽지',
  ACCOUNT: '계정 · 보안',
  PARTNER_OPS: '파트너 운영 소식',
  ANNOUNCEMENT: '서비스 공지',
  MARKETING: '혜택 · 이벤트 소식',
};

const DIGEST_OPTIONS: { value: DigestMode; label: string }[] = [
  { value: 'IMMEDIATE', label: '생기는 즉시 보내기' },
  { value: 'DAILY_DIGEST', label: '하루에 한 번 모아 보내기' },
];

export function ProfileScreen() {
  const { isReady } = useRequireAuth();
  const auth = useAuth();
  const toast = useToast();

  const preferences = useNotificationPreferences(isReady);
  const update = useUpdateNotificationPreferences();

  const save = (body: Parameters<typeof update.mutate>[0]) => {
    update.mutate(body, {
      onSuccess: () => toast.success('설정을 저장했어요'),
      onError: (error) => toast.error('설정을 저장하지 못했어요', toUserMessage(error)),
    });
  };

  const me = auth.me;
  const data = preferences.data;

  return (
    <AppShell header={<TopBar showBack backHref="/my" title="내 정보 · 알림 설정" />}>
      <section className="py-5">
        <div className="flex items-center gap-3">
          <Avatar name={me?.displayName ?? ''} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{me?.displayName ?? '—'}</p>
            <p className="truncate text-sm text-muted-foreground">
              {me?.email ?? '이메일 미등록'}
            </p>
          </div>
        </div>

        <Card className="mt-4">
          {/* CardRow 가 dt/dd 를 쓰므로 dl 로 감싼다. */}
          <dl className="divide-y px-4">
            <CardRow label="계정 상태" value={me?.status === 'ACTIVE' ? '정상' : (me?.status ?? '—')} />
            <CardRow
              label="역할"
              value={auth.isAdmin ? '운영자' : auth.isPartner ? '파트너' : '일반 이용자'}
            />
            {auth.isPartner ? (
              <CardRow
                label="파트너 승인"
                value={
                  <Badge variant={auth.isApprovedPartner ? 'success' : 'warning'}>
                    {labelOf(PARTNER_APPROVAL_LABEL, me?.partnerApprovalStatus, '심사 중')}
                  </Badge>
                }
              />
            ) : null}
            {data?.notificationEmail ? (
              <CardRow label="알림 받는 메일" value={data.notificationEmail} />
            ) : null}
          </dl>
        </Card>

        {!auth.isPartner ? (
          <Link
            href="/partner/apply"
            className="mt-3 inline-block text-sm font-semibold text-primary underline underline-offset-4"
          >
            파트너로 전환 신청하기
          </Link>
        ) : null}
      </section>

      <Separator />

      <section className="py-5">
        <h2 className="text-base font-bold">알림 설정</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          바꾸는 즉시 저장돼요. 예약금·결과·계정 알림은 꼭 필요해서 끌 수 없어요.
        </p>

        {!isReady || preferences.isPending ? (
          <div className="mt-4 space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : preferences.isError || !data ? (
          <ErrorState
            title="알림 설정을 불러오지 못했어요"
            onRetry={() => void preferences.refetch()}
          />
        ) : (
          <div className="mt-3">
            <div className="divide-y">
              <ToggleSwitch
                label="이메일 알림 받기"
                description="끄면 앱 안에서만 알림을 받아요."
                checked={data.emailGloballyEnabled}
                disabled={update.isPending}
                onChange={(next) => save({ emailGloballyEnabled: next })}
              />
            </div>

            <div className="py-3.5">
              <p className="mb-1.5 text-sm font-medium">이메일 보내는 방식</p>
              <Select
                aria-label="이메일 보내는 방식"
                options={DIGEST_OPTIONS}
                value={data.digestMode}
                disabled={!data.emailGloballyEnabled || update.isPending}
                onChange={(e) => save({ digestMode: e.target.value as DigestMode })}
              />
            </div>

            <Separator className="my-2" />

            <h3 className="pt-2 text-sm font-bold">알림 종류</h3>
            <ul className="divide-y">
              {data.categories.map((preference) => (
                <li key={preference.category}>
                  <ToggleSwitch
                    label={CATEGORY_LABEL[preference.category] ?? preference.category}
                    checked={preference.inAppEnabled}
                    disabled={preference.mandatory || update.isPending}
                    note={preference.mandatory ? '꼭 필요한 알림이라 끌 수 없어요.' : undefined}
                    onChange={(next) =>
                      save({
                        categories: [
                          {
                            category: preference.category,
                            inAppEnabled: next,
                            // 앱 알림을 끄면 이메일도 함께 끈다. 앱에서 안 보겠다는 사람에게
                            // 메일만 계속 가면 "껐는데 왜 오지" 가 된다.
                            emailEnabled: next ? preference.emailEnabled : false,
                          },
                        ],
                      })
                    }
                  />
                </li>
              ))}
            </ul>

            <Separator className="my-2" />

            <h3 className="pt-2 text-sm font-bold">광고성 정보</h3>
            <div className="divide-y">
              <ToggleSwitch
                label="혜택 · 이벤트 소식 받기"
                description="새로 열린 예약과 할인 소식을 보내드려요."
                checked={data.marketingConsent}
                disabled={update.isPending}
                onChange={(next) => save({ marketingConsent: next })}
              />
              <ToggleSwitch
                label="밤 9시~아침 8시에도 받기"
                description="광고성 정보 수신에 동의한 경우에만 설정할 수 있어요."
                checked={data.nightMarketingConsent}
                disabled={!data.marketingConsent || update.isPending}
                onChange={(next) => save({ nightMarketingConsent: next })}
              />
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}
