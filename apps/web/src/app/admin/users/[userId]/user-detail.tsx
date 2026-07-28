'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { Badge, ErrorState, Skeleton } from '@/components/ui';
import { apiGet, toUserMessage } from '@/lib/api-client';
import { formatNumber, labelOf } from '@/lib/format';

import {
  AdminPage,
  CopyableId,
  KeyValue,
  KeyValueGrid,
  Maybe,
  Notice,
  Panel,
  TimeCell,
} from '../../_components/console';
import { UserActions, suspensionSummary } from '../../_components/user-actions';
import {
  ACCOUNT_STATUS_LABEL,
  ACCOUNT_STATUS_TONE,
  PARTNER_APPROVAL_LABEL,
  USER_ROLE_LABEL,
} from '../../_lib/labels';
import type { AdminUserDetail } from '../../_lib/types';

/**
 * 계정 상세.
 *
 * 목록과 달리 **원본 이메일·전화번호**가 나온다. 그래서 서버가 `PII_ACCESSED` 를
 * 남기고, 화면도 그 사실을 먼저 알린다. 캐시를 길게 잡아 둔 이유가 여기 있다 —
 * 재조회할 때마다 감사 행이 하나씩 늘면 로그에서 진짜 열람을 골라낼 수 없다.
 */
export function UserDetail({ userId }: { userId: string }) {
  const query = useQuery({
    queryKey: qkUserDetail(userId),
    queryFn: () => apiGet<AdminUserDetail>(`/api/admin/users/${userId}`),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <ErrorState
        title="계정을 불러오지 못했어요"
        description={toUserMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const user = query.data;
  const suspension = suspensionSummary(user);

  return (
    <AdminPage
      back={{ href: '/admin/users', label: '계정 목록' }}
      title={user.displayName}
      description={user.email ?? '이메일 없음'}
      actions={
        <Badge variant={ACCOUNT_STATUS_TONE[user.status] ?? 'muted'}>
          {labelOf(ACCOUNT_STATUS_LABEL, user.status)}
        </Badge>
      }
    >
      <Notice tone="warning" title="개인정보 열람이 기록되었습니다">
        이 화면에는 마스킹하지 않은 이메일·전화번호가 나옵니다. 연 시각과 계정이 감사 로그에{' '}
        <code className="font-mono text-xs">PII_ACCESSED</code> 로 남았습니다.
      </Notice>

      {suspension ? (
        <Notice tone="danger" title="정지 중">
          {suspension}
        </Notice>
      ) : null}

      {user.withdrawalRequestedAt ? (
        <Notice tone="warning" title="탈퇴를 신청한 계정입니다">
          탈퇴 진행 중인 계정에 조치를 하기 전에 처리 단계를 먼저 확인하세요.
        </Notice>
      ) : null}

      <Panel title="조치">
        <UserActions
          userId={user.id}
          status={user.status}
          roles={user.roles}
          onDone={() => void query.refetch()}
        />
      </Panel>

      <Panel title="계정 정보">
        <KeyValueGrid>
          <KeyValue label="닉네임">{user.displayName}</KeyValue>
          <KeyValue label="실명">
            <Maybe value={user.realName} />
          </KeyValue>
          <KeyValue label="이메일">
            <Maybe value={user.email} />
          </KeyValue>
          <KeyValue label="알림 수신 이메일">
            <Maybe value={user.notificationEmail} />
          </KeyValue>
          <KeyValue label="전화번호">
            <Maybe value={user.phone} />
            {user.phoneVerifiedAt ? (
              <Badge variant="success" size="sm" className="ml-2">
                인증됨
              </Badge>
            ) : null}
          </KeyValue>
          <KeyValue label="관심 지역 코드">
            <Maybe value={user.preferredRegionCode} />
          </KeyValue>
          <KeyValue label="역할">
            <span className="flex flex-wrap gap-1">
              {user.roles.map((role) => (
                <Badge key={role} variant={role === 'ADMIN' ? 'default' : 'outline'} size="sm">
                  {labelOf(USER_ROLE_LABEL, role)}
                </Badge>
              ))}
            </span>
          </KeyValue>
          <KeyValue label="계정 ID">
            <CopyableId value={user.id} />
          </KeyValue>
        </KeyValueGrid>
      </Panel>

      <Panel title="활동">
        <KeyValueGrid>
          <KeyValue label="가입">
            <TimeCell value={user.createdAt} />
          </KeyValue>
          <KeyValue label="마지막 로그인">
            <TimeCell value={user.lastLoginAt} />
          </KeyValue>
          <KeyValue label="로그인 횟수">{formatNumber(user.loginCount)}회</KeyValue>
          <KeyValue label="신청 건수">{formatNumber(user._count.applications)}건</KeyValue>
          <KeyValue label="받은 알림">{formatNumber(user._count.notifications)}건</KeyValue>
          <KeyValue label="탈퇴 신청">
            <TimeCell value={user.withdrawalRequestedAt} />
          </KeyValue>
          <KeyValue label="익명화">
            <TimeCell value={user.anonymizedAt} />
          </KeyValue>
        </KeyValueGrid>
        <p className="mt-2 text-xs text-muted-foreground">
          이 계정의 신청 내역은 운영자 화면에 목록으로 열지 않습니다 — 금액이 함께 나오는 화면이라,
          필요한 경우 해당 이벤트의 선정 라운드에서 확인하세요.{' '}
          <Link
            href={`/admin/audit-logs?targetType=USER&targetId=${user.id}`}
            className="font-semibold text-primary hover:underline"
          >
            이 계정의 감사 로그 보기
          </Link>
        </p>
      </Panel>

      {user.partnerProfile ? (
        <Panel title="파트너 신청서">
          <KeyValueGrid>
            <KeyValue label="담당자">
              <Link
                href={`/admin/partners/${user.partnerProfile.id}`}
                className="font-semibold hover:underline"
              >
                {user.partnerProfile.contactName}
              </Link>
            </KeyValue>
            <KeyValue label="심사 상태">
              {labelOf(PARTNER_APPROVAL_LABEL, user.partnerProfile.approvalStatus)}
            </KeyValue>
          </KeyValueGrid>
        </Panel>
      ) : null}
    </AdminPage>
  );
}

/**
 * 상세 캐시 키.
 *
 * `qk.admin.userDetail` 을 그대로 쓰면 조치 후의 `qk.admin.all` 무효화에 걸려
 * 화면이 다시 조회되고, 그때마다 `PII_ACCESSED` 감사 행이 하나 더 생긴다.
 * 그래서 admin 접두사 **바깥**에 둔다. 다시 읽는 경로는 두 개뿐이다 —
 * 이 화면에서 직접 조치를 실행했을 때(그때는 상태가 실제로 바뀌었으니 봐야 한다)와
 * 사용자가 새로고침했을 때.
 */
function qkUserDetail(userId: string) {
  return ['admin-pii', 'users', userId] as const;
}
