'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { Badge, ErrorState, Skeleton } from '@/components/ui';
import { apiGet, toUserMessage } from '@/lib/api-client';
import { formatNumber, labelOf } from '@/lib/format';
import { qk } from '@/lib/query-keys';

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
import { EventActions } from '../../_components/event-actions';
import {
  EVENT_CLOSE_REASON_LABEL,
  EVENT_MODE_LABEL,
  EVENT_STATUS_LABEL,
  EVENT_STATUS_TONE,
  VENUE_STATUS_LABEL,
} from '../../_lib/labels';
import type { AdminEventDetail } from '../../_lib/types';

/**
 * 이벤트 운영 상세.
 *
 * ★ D-07 — 이 화면에도 **개별 금액과 순위는 없다.** 운영자는 권한상 볼 수 있지만
 *   그 값이 필요한 화면은 선정 라운드 하나뿐이고, 운영 화면에 금액을 실어 두면
 *   그 응답이 언젠가 다른 화면에 재사용된다. 여기서 보는 것은 "정원 대비 몇 건이
 *   살아 있는가" 하나다.
 */
export function EventOpsDetail({ eventId }: { eventId: string }) {
  const query = useQuery({
    queryKey: qk.admin.eventDetail(eventId),
    queryFn: () => apiGet<AdminEventDetail>(`/api/admin/events/ops/${eventId}`),
    // 정원·신청 수가 실시간으로 움직이는 화면이다. 낡은 숫자를 보고 취소를 누르면 안 된다.
    refetchInterval: 30_000,
  });

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <ErrorState
        title="이벤트를 불러오지 못했어요"
        description={toUserMessage(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const event = query.data;
  const extended = event.originalApplyEndAt && event.originalApplyEndAt !== event.applyEndAt;
  const overCapacity = event.liveApplicantCount > event.capacity;

  return (
    <AdminPage
      back={{ href: '/admin/events', label: '이벤트 운영 목록' }}
      title={event.title}
      description={`${labelOf(EVENT_MODE_LABEL, event.mode)} · ${event.venue?.name ?? '시설 없음'}`}
      actions={
        <>
          <Badge variant={EVENT_STATUS_TONE[event.status] ?? 'muted'}>
            {labelOf(EVENT_STATUS_LABEL, event.status)}
          </Badge>
          <Badge variant="outline">v{event.version}</Badge>
        </>
      }
    >
      {event.status === 'SUSPENDED' ? (
        <Notice tone="danger" title="정지 중">
          {event.suspendedReason ?? '사유가 기록되지 않았습니다.'}
          {event.statusBeforeSuspend ? (
            <> · 해제하면 {labelOf(EVENT_STATUS_LABEL, event.statusBeforeSuspend)} 상태로 돌아갑니다.</>
          ) : null}
        </Notice>
      ) : null}

      {event.status === 'CANCELED' ? (
        <Notice tone="danger" title="취소된 이벤트입니다">
          되돌릴 수 없습니다. 같은 내용으로 다시 열려면 파트너가 새 이벤트를 만들어야 합니다.
        </Notice>
      ) : null}

      {event.venue && event.venue.status !== 'ACTIVE' ? (
        <Notice tone="warning" title="이 이벤트의 시설이 공개 상태가 아닙니다">
          시설이 <strong>{labelOf(VENUE_STATUS_LABEL, event.venue.status)}</strong> 상태예요.{' '}
          <Link href={`/admin/venues/${event.venue.id}`} className="font-semibold underline">
            시설 확인하기
          </Link>
        </Notice>
      ) : null}

      {overCapacity ? (
        <Notice tone="info" title="정원을 넘겨 신청을 받고 있습니다">
          이건 정상입니다. 최종 명단은 마감 뒤에 파트너가 정하기 때문에, 신청 단계에서 정원을
          막지 않습니다. 소폭 초과는 파트너가 명단 화면에서 조정합니다.
        </Notice>
      ) : null}

      <Panel
        title="운영 조치"
        description={`강제 마감·연장·취소는 지금 보고 있는 버전(v${event.version})으로 나갑니다.`}
      >
        <EventActions
          eventId={event.id}
          status={event.status}
          version={event.version}
          applyEndAt={event.applyEndAt}
          liveApplicantCount={event.liveApplicantCount}
          onDone={() => void query.refetch()}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          다른 사람이 먼저 손댔다면 버전이 어긋나 조치가 거절됩니다. 그때는 화면을 새로 읽고
          다시 시도하세요 — 낡은 화면을 보고 내린 판단이 그대로 나가지 않게 하는 장치입니다.
        </p>
      </Panel>

      <Panel title="신청 현황">
        <KeyValueGrid>
          <KeyValue label="정원">{formatNumber(event.capacity)}명</KeyValue>
          <KeyValue label="살아 있는 신청">
            <strong className={overCapacity ? 'text-amber-600 dark:text-amber-400' : undefined}>
              {formatNumber(event.liveApplicantCount)}건
            </strong>
          </KeyValue>
          <KeyValue label="선착순 확정 수">
            {event.mode === 'INSTANT' ? (
              `${formatNumber(event.claimedCount)}건`
            ) : (
              <span className="text-muted-foreground">해당 없음 (금액 제안 모드)</span>
            )}
          </KeyValue>
          <KeyValue label="예약금">
            {event.depositRequired
              ? `필수 · 입금 기한 ${event.depositWindowMinutes}분`
              : '없음'}
          </KeyValue>
        </KeyValueGrid>

        <p className="mt-3 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          개별 신청 금액과 순위는 이 화면에 나오지 않습니다. 명단과 커트라인이 필요하면 마감 뒤
          선정 라운드에서 확인하세요 — 그 화면에서만 금액이 보입니다.
        </p>
      </Panel>

      <Panel title="일정">
        <KeyValueGrid>
          <KeyValue label="신청 시작">
            <TimeCell value={event.applyStartAt} />
          </KeyValue>
          <KeyValue label="신청 마감">
            <span className="inline-flex flex-col">
              <TimeCell value={event.applyEndAt} />
              {extended ? (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  원래 마감 {event.originalApplyEndAt ? <TimeCell value={event.originalApplyEndAt} relative={false} /> : null}
                </span>
              ) : null}
            </span>
          </KeyValue>
          <KeyValue label="순위 확정 시각">
            <TimeCell value={event.rankingLockAt} />
          </KeyValue>
          <KeyValue label="마감 처리">
            <TimeCell value={event.closedAt} />
            {event.closeReason ? (
              <span className="ml-2 text-xs text-muted-foreground">
                {labelOf(EVENT_CLOSE_REASON_LABEL, event.closeReason)}
              </span>
            ) : null}
          </KeyValue>
          <KeyValue label="취소 시각">
            <TimeCell value={event.canceledAt} />
          </KeyValue>
          <KeyValue label="정지 시각">
            <TimeCell value={event.suspendedAt} />
          </KeyValue>
        </KeyValueGrid>

        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          순위 확정은 <strong>마감 시각 + 예약금 기한</strong> 뒤에 일어납니다. 마감 직전에 신청한
          사람도 자기 몫의 입금 시간을 다 쓸 수 있어야 하기 때문이에요. 강제 마감은 새 신청만
          막고 이미 돌고 있는 예약금 시계는 건드리지 않습니다.
        </p>
      </Panel>

      <Panel title="마감 직전 연장 (소프트 클로즈)">
        {event.softCloseEnabled ? (
          <KeyValueGrid>
            <KeyValue label="설정">켜짐</KeyValue>
            <KeyValue label="지금까지 연장된 횟수">{event.softCloseExtensionCount}회</KeyValue>
            <KeyValue label="더 이상 못 미는 시각" full>
              <TimeCell value={event.softCloseHardEndAt} />
            </KeyValue>
          </KeyValueGrid>
        ) : (
          <p className="text-sm text-muted-foreground">
            꺼져 있습니다. 마감 직전에 신청이 몰려도 마감 시각이 자동으로 밀리지 않아요.
          </p>
        )}
      </Panel>

      <Panel title="소유 정보">
        <KeyValueGrid>
          <KeyValue label="파트너">
            <Link
              href={`/admin/partners/${event.partner.id}`}
              className="font-semibold hover:underline"
            >
              {event.partner.contactName}
            </Link>
          </KeyValue>
          <KeyValue label="시설">
            {event.venue ? (
              <Link href={`/admin/venues/${event.venue.id}`} className="font-semibold hover:underline">
                {event.venue.name}
              </Link>
            ) : (
              <Maybe value={null} />
            )}
          </KeyValue>
          <KeyValue label="이벤트 ID">
            <CopyableId value={event.id} />
          </KeyValue>
          <KeyValue label="정책 버전">v{event.policyVersion}</KeyValue>
          <KeyValue label="이 파트너의 다른 이벤트" full>
            <Link
              href={`/admin/events?partnerId=${event.partnerId}`}
              className="text-primary hover:underline"
            >
              같은 파트너의 이벤트만 보기
            </Link>
          </KeyValue>
        </KeyValueGrid>
      </Panel>

      {event.description ? (
        <Panel title="이벤트 설명">
          <p className="whitespace-pre-line text-sm leading-relaxed">{event.description}</p>
        </Panel>
      ) : null}

      <p className="text-xs text-muted-foreground">
        <Link
          href={`/admin/audit-logs?targetType=EVENT&targetId=${event.id}`}
          className="font-semibold text-primary hover:underline"
        >
          이 이벤트의 감사 로그 보기
        </Link>
      </p>
    </AdminPage>
  );
}
