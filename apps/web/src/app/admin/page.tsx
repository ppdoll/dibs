'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { Badge, Button, EmptyState, Skeleton } from '@/components/ui';
import { apiGet } from '@/lib/api-client';
import { formatDateTime, formatRemainingKo, labelOf } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

import { AdminPage, Maybe, Notice, Panel, SlaBadge, StatTile, TimeCell } from './_components/console';
import { DEPOSIT_REASON_LABEL, EVENT_STATUS_LABEL } from './_lib/labels';
import type {
  AdminDashboardCounts,
  AdminExpiringHoldRow,
  AdminList,
  AdminOverduePartnerRow,
} from './_lib/types';

/**
 * 운영 대시보드.
 *
 * 여기 있는 숫자는 전부 **"지금 사람이 개입해야 하는가"** 를 답한다. 누적 지표(총 가입자,
 * 총 거래액)를 섞지 않는 것이 이 화면의 규칙이다 — 큰 숫자 옆에 놓이는 순간
 * "심사 3건 밀림"이 눈에 안 들어온다. 서버도 그 규칙대로 12개만 보낸다.
 *
 * 60초마다 다시 읽는다. SSE 는 엔드포인트가 없고(D-11 은 언급만 한다), 콘솔은
 * 사람이 보고 있는 동안만 열려 있으므로 폴링으로 충분하다.
 */
export default function AdminDashboardPage() {
  const { isAdmin } = useAuth();

  const stats = useQuery({
    queryKey: qk.admin.dashboard,
    queryFn: () => apiGet<AdminDashboardCounts>('/api/admin/dashboard/stats'),
    enabled: isAdmin,
    refetchInterval: 60_000,
  });

  const holds = useQuery({
    queryKey: qk.admin.expiringHolds,
    queryFn: () =>
      apiGet<AdminList<AdminExpiringHoldRow>>('/api/admin/dashboard/expiring-holds', {
        query: { limit: 20 },
      }),
    enabled: isAdmin,
    refetchInterval: 60_000,
  });

  const overdue = useQuery({
    queryKey: qk.admin.overduePartners,
    queryFn: () =>
      apiGet<AdminList<AdminOverduePartnerRow>>('/api/admin/dashboard/overdue-partners', {
        query: { limit: 10 },
      }),
    enabled: isAdmin,
    refetchInterval: 60_000,
  });

  const counts = stats.data;
  const loading = stats.isPending;

  const refreshAll = () => {
    void stats.refetch();
    void holds.refetch();
    void overdue.refetch();
  };

  return (
    <AdminPage
      title="운영 대시보드"
      description="지금 사람이 손대야 하는 것만 모아 둔 화면이에요. 60초마다 자동으로 새로고침됩니다."
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={refreshAll}
          loading={stats.isFetching || holds.isFetching || overdue.isFetching}
          leadingIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
        >
          새로고침
        </Button>
      }
    >
      {stats.isError ? (
        <Notice tone="danger" title="대시보드 숫자를 불러오지 못했어요">
          아래 목록은 따로 조회하므로 그대로 볼 수 있어요. 새로고침을 눌러 다시 시도해 주세요.
        </Notice>
      ) : null}

      {/* ── 심사 큐 ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-muted-foreground">심사 대기</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="파트너 심사"
            value={counts?.pendingPartners ?? 0}
            hint={
              counts && counts.overduePartners > 0
                ? `SLA 초과 ${counts.overduePartners}건`
                : 'SLA 초과 없음'
            }
            tone={counts && counts.overduePartners > 0 ? 'danger' : 'default'}
            href="/admin/partners"
            loading={loading}
          />
          <StatTile
            label="사업자 확인"
            value={counts?.pendingBusinesses ?? 0}
            hint="확인 대기 중인 사업자"
            href="/admin/businesses"
            loading={loading}
          />
          <StatTile
            label="시설 검수"
            value={counts?.pendingVenues ?? 0}
            hint="검수 요청된 시설"
            href="/admin/venues"
            loading={loading}
          />
          <StatTile
            label="격리된 이미지"
            value={counts?.quarantinedImages ?? 0}
            hint="복구 여부를 판단해야 함"
            tone={counts && counts.quarantinedImages > 0 ? 'warning' : 'default'}
            href="/admin/venues"
            loading={loading}
          />
        </div>
      </section>

      {/* ── 진행 중 ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-muted-foreground">진행 상황</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="신청 받는 중인 이벤트"
            value={counts?.openEvents ?? 0}
            hint={counts ? `24시간 내 마감 ${counts.closingSoonEvents}건` : undefined}
            href="/admin/events"
            loading={loading}
          />
          <StatTile
            label="오늘 들어온 신청"
            value={counts?.applicationsToday ?? 0}
            hint="한국시간 자정 기준"
            loading={loading}
          />
          <StatTile
            label="정지된 계정"
            value={counts?.suspendedUsers ?? 0}
            href="/admin/users?status=SUSPENDED"
            loading={loading}
          />
          <StatTile
            label="발송 중인 공지"
            value={counts?.sendingBroadcasts ?? 0}
            hint={
              counts && counts.sendingBroadcasts > 0 ? '이어서 발송이 필요할 수 있음' : undefined
            }
            tone={counts && counts.sendingBroadcasts > 0 ? 'warning' : 'default'}
            href="/admin/broadcasts"
            loading={loading}
          />
        </div>
      </section>

      {/* ── 예약금 스위퍼 ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-muted-foreground">예약금 홀드</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="30분 내 만료 예정"
            value={counts?.expiringHolds ?? 0}
            hint="정상 범위예요"
            loading={loading}
          />
          <StatTile
            label="만료 시각이 지난 홀드"
            value={counts?.overdueHolds ?? 0}
            hint="스위퍼가 아직 치우지 못한 건"
            tone={counts && counts.overdueHolds > 0 ? 'danger' : 'default'}
            loading={loading}
          />
        </div>
        {counts && counts.overdueHolds > 0 ? (
          <Notice tone="danger" title="만료 처리가 밀리고 있어요">
            만료 시각이 지났는데 정리되지 않은 홀드가 {counts.overdueHolds}건 있습니다. 만료
            스위퍼 크론(<code className="font-mono text-xs">/api/cron/expire-holds</code>)이 도는지
            확인해 주세요. 이 상태가 이어지면 순위 확정 시각에 유효하지 않은 신청이 섞입니다.
          </Notice>
        ) : null}
      </section>

      {/* ── SLA 초과 심사 ── */}
      <Panel
        title="SLA 를 넘긴 파트너 심사"
        description="가장 오래 밀린 순서입니다."
        bodyClassName="p-0"
        actions={
          <Link href="/admin/partners?overdue=1" className="text-xs font-semibold text-primary">
            전체 큐 보기
          </Link>
        }
      >
        {overdue.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
          </div>
        ) : (overdue.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            compact
            title="밀린 심사가 없어요"
            description="SLA 기한을 넘긴 파트너 신청이 하나도 없습니다."
          />
        ) : (
          <ul className="divide-y">
            {overdue.data?.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <Link
                  href={`/admin/partners/${item.id}`}
                  className="min-w-0 flex-1 font-semibold hover:underline"
                >
                  {item.contactName}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {item.contactEmail}
                  </span>
                </Link>
                {item.resubmitCount > 0 ? (
                  <Badge variant="secondary" size="sm">
                    재제출 {item.resubmitCount}회
                  </Badge>
                ) : null}
                <SlaBadge dueAt={item.slaDueAt} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ── 만료 임박 홀드 ── */}
      <Panel
        title="만료 임박 예약금 홀드"
        description="30분 안에 만료되는 홀드예요. 금액은 이 화면에 싣지 않습니다."
        bodyClassName="p-0"
      >
        {holds.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
          </div>
        ) : (holds.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            compact
            title="임박한 홀드가 없어요"
            description="30분 안에 만료될 예약금 홀드가 없습니다."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-2 font-semibold">
                    이벤트
                  </th>
                  <th scope="col" className="px-4 py-2 font-semibold">
                    사유
                  </th>
                  <th scope="col" className="px-4 py-2 font-semibold">
                    시작
                  </th>
                  <th scope="col" className="px-4 py-2 font-semibold">
                    만료까지
                  </th>
                  <th scope="col" className="px-4 py-2 font-semibold">
                    안내 발송
                  </th>
                </tr>
              </thead>
              <tbody>
                {holds.data?.items.map((hold) => {
                  const overdueHold = new Date(hold.dueAt).getTime() <= Date.now();

                  return (
                    <tr key={hold.id} className="border-b last:border-b-0">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/admin/events/${hold.eventId}`}
                          className="font-medium hover:underline"
                        >
                          <Maybe value={hold.event?.title} />
                        </Link>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {labelOf(EVENT_STATUS_LABEL, hold.event?.status)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {labelOf(DEPOSIT_REASON_LABEL, hold.reason)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-muted-foreground">
                        {formatDateTime(hold.openedAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        {overdueHold ? (
                          <Badge variant="destructive" size="sm">
                            만료 처리 대기
                          </Badge>
                        ) : (
                          <span className="tabular-nums" title={formatDateTime(hold.dueAt)}>
                            {formatRemainingKo(hold.dueAt)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {hold.reminderSentAt ? (
                          <TimeCell value={hold.reminderSentAt} relative={false} />
                        ) : (
                          <span className="text-muted-foreground">미발송</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {counts ? (
        <p className="text-xs text-muted-foreground">
          기준 시각 {formatDateTime(counts.generatedAt)}
        </p>
      ) : null}
    </AdminPage>
  );
}
